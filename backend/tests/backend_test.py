"""GoalCoach backend API tests (pytest).

Covers auth, state, chat streaming (SSE), tool confirm/reject, audit, preferences.
Uses seeded session token from /app/memory/test_credentials.md.
"""
import json
import os
import time
import uuid
from typing import Optional

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://weekly-focus-3.preview.emergentagent.com").rstrip("/")
SESSION_TOKEN = "test_session_founder01"
AUTH_HEADERS = {"Authorization": f"Bearer {SESSION_TOKEN}", "Content-Type": "application/json"}
USER_ID = "user_founder01"


# ---------------- fixtures ----------------
@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update(AUTH_HEADERS)
    return s


@pytest.fixture(scope="session", autouse=True)
def cleanup_before_tests():
    """Wipe test user's goals/commitments/messages/audit before running so state is deterministic."""
    try:
        import pymongo
        mc = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        dbn = os.environ.get("DB_NAME", "test_database")
        db = mc[dbn]
        db.goals.delete_many({"user_id": USER_ID})
        db.commitments.delete_many({"user_id": USER_ID})
        db.messages.delete_many({"user_id": USER_ID})
        db.audit_log.delete_many({"user_id": USER_ID})
    except Exception as e:
        print(f"cleanup skipped: {e}")
    yield


# ---------------- Auth ----------------
class TestAuth:
    def test_me_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_bearer(self, client):
        r = client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["user_id"] == USER_ID
        assert data["email"] == "founder@goalcoach.dev"

    def test_me_cookie(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", cookies={"session_token": SESSION_TOKEN})
        assert r.status_code == 200
        assert r.json()["user_id"] == USER_ID

    def test_invalid_session(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer bogus_xxx"})
        assert r.status_code == 401


# ---------------- State ----------------
class TestState:
    def test_state_shape(self, client):
        r = client.get(f"{BASE_URL}/api/state")
        assert r.status_code == 200
        d = r.json()
        assert "goals" in d and "commitments" in d and "over_commitment" in d
        oc = d["over_commitment"]
        assert "level" in oc and oc["level"] in ("clear", "moderate", "high", "critical")
        assert isinstance(oc["active_goals"], int)


# ---------------- Preferences ----------------
class TestPreferences:
    def test_set_valid(self, client):
        for prov in ["anthropic", "openai", "gemini"]:
            r = client.put(f"{BASE_URL}/api/preferences", json={"model_provider": prov})
            assert r.status_code == 200
            assert r.json()["model_provider"] == prov
        # Verify persisted
        me = client.get(f"{BASE_URL}/api/auth/me").json()
        assert me["model_provider"] == "gemini"

    def test_set_invalid(self, client):
        r = client.put(f"{BASE_URL}/api/preferences", json={"model_provider": "nope"})
        assert r.status_code == 400


# ---------------- Chat SSE + Tools + Audit ----------------
def _read_sse(resp) -> list:
    """Parse an SSE response into list of json events."""
    events = []
    buf = ""
    for chunk in resp.iter_content(chunk_size=None, decode_unicode=True):
        if not chunk:
            continue
        buf += chunk
        while "\n\n" in buf:
            frame, buf = buf.split("\n\n", 1)
            for line in frame.splitlines():
                if line.startswith("data: "):
                    try:
                        events.append(json.loads(line[6:]))
                    except Exception:
                        pass
    return events


class TestChatFlow:
    """Integration flow: send message -> stream -> tools -> confirm -> state updates -> audit."""

    message_id: Optional[str] = None
    proposals: list = []

    def test_chat_stream_multi_goal(self, client):
        prompt = (
            "I want to start three things: get a running habit going this quarter, "
            "ship a side-project MVP in 2 months, and read 12 books this year. Where do I start?"
        )
        with client.post(f"{BASE_URL}/api/chat/stream", json={"message": prompt}, stream=True, timeout=60) as r:
            assert r.status_code == 200, r.text
            events = _read_sse(r)
        assert len(events) > 0
        types = [e["type"] for e in events]
        assert "done" in types
        deltas = [e for e in events if e["type"] == "delta"]
        assert len(deltas) >= 1, "expected token deltas"
        tools_evt = next((e for e in events if e["type"] == "tools"), None)
        assert tools_evt is not None, "expected tool proposals for multi-goal cold-start"
        assert tools_evt["proposals"], "proposals list not empty"
        TestChatFlow.message_id = tools_evt["message_id"]
        TestChatFlow.proposals = tools_evt["proposals"]

    def test_confirm_first_proposal_persists_goal(self, client):
        assert TestChatFlow.message_id and TestChatFlow.proposals
        # Pick first create_goal proposal
        prop = next((p for p in TestChatFlow.proposals if p.get("action") == "create_goal"), None)
        assert prop is not None, "expected at least one create_goal proposal"
        r = client.post(
            f"{BASE_URL}/api/tools/confirm",
            json={"message_id": TestChatFlow.message_id, "proposal_id": prop["id"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "state" in body
        # Goal must appear in state
        titles = [g["title"] for g in body["state"]["goals"]]
        assert prop["title"] in titles

        # GET /state to confirm persistence
        r2 = client.get(f"{BASE_URL}/api/state")
        titles2 = [g["title"] for g in r2.json()["goals"]]
        assert prop["title"] in titles2

    def test_reject_second_proposal(self, client):
        # find a still-pending create_goal we haven't confirmed
        confirmed_title = None
        try:
            state = client.get(f"{BASE_URL}/api/state").json()
            confirmed_title = state["goals"][0]["title"] if state["goals"] else None
        except Exception:
            pass
        remaining = [p for p in TestChatFlow.proposals if p.get("action") == "create_goal" and p.get("title") != confirmed_title]
        if not remaining:
            pytest.skip("no additional create_goal proposal to reject")
        prop = remaining[0]
        r = client.post(
            f"{BASE_URL}/api/tools/reject",
            json={"message_id": TestChatFlow.message_id, "proposal_id": prop["id"]},
        )
        assert r.status_code == 200
        # Verify goal NOT in state
        state = client.get(f"{BASE_URL}/api/state").json()
        titles = [g["title"] for g in state["goals"]]
        assert prop["title"] not in titles

    def test_double_confirm_conflict(self, client):
        # Confirming an already-resolved proposal should be 409
        if not TestChatFlow.proposals:
            pytest.skip()
        # try to confirm the first create_goal again
        prop = next((p for p in TestChatFlow.proposals if p.get("action") == "create_goal"), None)
        if prop is None:
            pytest.skip()
        r = client.post(
            f"{BASE_URL}/api/tools/confirm",
            json={"message_id": TestChatFlow.message_id, "proposal_id": prop["id"]},
        )
        assert r.status_code == 409

    def test_history_persisted(self, client):
        r = client.get(f"{BASE_URL}/api/chat/history")
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 2
        roles = [m["role"] for m in msgs]
        assert "user" in roles and "assistant" in roles

    def test_audit_logged(self, client):
        r = client.get(f"{BASE_URL}/api/audit")
        assert r.status_code == 200
        events = r.json()
        types = [e["type"] for e in events]
        assert any(t.startswith("confirm:") for t in types), f"no confirm audit entry: {types}"

    def test_audit_export(self, client):
        r = client.get(f"{BASE_URL}/api/audit/export")
        assert r.status_code == 200
        d = r.json()
        assert "state" in d and "conversation" in d and "audit_log" in d


# ---------------- Over-commitment escalation ----------------
class TestOverCommitment:
    def test_seed_goals_and_escalate(self, client):
        # Directly seed via chat is too slow; use Mongo insert to reach critical.
        try:
            import pymongo
            mc = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = mc[os.environ.get("DB_NAME", "test_database")]
            for i in range(8):
                db.goals.insert_one({
                    "id": f"goal_octest_{uuid.uuid4().hex[:6]}",
                    "user_id": USER_ID,
                    "title": f"TEST_over_commit_{i}",
                    "horizon": "medium",
                    "why": "", "next_action": "", "status": "active",
                    "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
                })
        except Exception as e:
            pytest.skip(f"pymongo unavailable: {e}")

        r = client.get(f"{BASE_URL}/api/state")
        assert r.status_code == 200
        oc = r.json()["over_commitment"]
        assert oc["active_goals"] >= 7
        assert oc["level"] == "critical"

        # cleanup TEST_ goals
        try:
            db.goals.delete_many({"user_id": USER_ID, "title": {"$regex": "^TEST_over_commit_"}})
        except Exception:
            pass
