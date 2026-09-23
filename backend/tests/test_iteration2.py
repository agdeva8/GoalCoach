"""Iteration 2 tests: guest_stream (no auth), auto_answer flag, milestones/target_date.
"""
import json
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://weekly-focus-3.preview.emergentagent.com").rstrip("/")
SESSION_TOKEN = "test_session_founder01"
AUTH_HEADERS = {"Authorization": f"Bearer {SESSION_TOKEN}", "Content-Type": "application/json"}


def _read_sse(resp) -> list:
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


# ---------------- Guest chat (no auth) ----------------
class TestGuestChat:
    def test_guest_stream_no_auth_multi_goal_autoanswer(self):
        """With auto_answer=True the guest LLM should skip clarifying and propose."""
        prompt = ("I want to start three things: get a running habit going this quarter, "
                  "ship a side-project MVP in 2 months, and read 12 books this year.")
        with requests.post(
            f"{BASE_URL}/api/chat/guest_stream",
            json={"message": prompt, "history": [], "auto_answer": True},
            stream=True, timeout=120,
            headers={"Content-Type": "application/json"},
        ) as r:
            assert r.status_code == 200, r.text
            events = _read_sse(r)
        types = [e["type"] for e in events]
        assert "done" in types
        deltas = [e for e in events if e["type"] == "delta"]
        assert len(deltas) >= 1
        tools_evt = next((e for e in events if e["type"] == "tools"), None)
        assert tools_evt is not None, "guest multi-goal + auto_answer should get proposals"
        assert isinstance(tools_evt.get("proposals"), list) and len(tools_evt["proposals"]) >= 1
        assert tools_evt["message_id"] == "guest"

    def test_guest_stream_ignores_auth_context(self):
        """Even without cookies/bearer, guest_stream should work."""
        with requests.post(
            f"{BASE_URL}/api/chat/guest_stream",
            json={"message": "hi", "history": [], "auto_answer": False},
            stream=True, timeout=60,
        ) as r:
            assert r.status_code == 200

    def test_authed_stream_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/chat/stream", json={"message": "hi"})
        assert r.status_code == 401

    def test_tools_confirm_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/tools/confirm", json={"message_id": "x", "proposal_id": "y"})
        assert r.status_code == 401


# ---------------- Authed with auto_answer=true → target_date + milestones ----------------
class TestAutoAnswerFlow:
    proposals: list = []
    message_id: str = ""

    def test_auto_answer_produces_dated_plan(self):
        # Ensure clean-ish state
        prompt = ("Plan a full path: learn Spanish to B1, ship an indie SaaS MVP, and run a half marathon. "
                  "Give me realistic target dates and milestones.")
        with requests.post(
            f"{BASE_URL}/api/chat/stream",
            json={"message": prompt, "auto_answer": True},
            headers=AUTH_HEADERS, stream=True, timeout=120,
        ) as r:
            assert r.status_code == 200, r.text
            events = _read_sse(r)
        tools_evt = next((e for e in events if e["type"] == "tools"), None)
        assert tools_evt is not None, "expected tool proposals in auto-answer mode"
        proposals = tools_evt["proposals"]
        TestAutoAnswerFlow.proposals = proposals
        TestAutoAnswerFlow.message_id = tools_evt["message_id"]

        # At least one create_goal WITH target_date
        create_with_dates = [p for p in proposals
                             if p.get("action") == "create_goal" and p.get("target_date")]
        assert create_with_dates, f"expected create_goal proposals with target_date; got {proposals}"

        # Should also include add_milestone proposals
        milestones = [p for p in proposals if p.get("action") == "add_milestone"]
        assert milestones, f"expected add_milestone proposals; got actions={[p.get('action') for p in proposals]}"

    def test_confirm_goal_with_target_date_persists(self):
        if not TestAutoAnswerFlow.proposals:
            pytest.skip("no proposals from previous test")
        create_props = [p for p in TestAutoAnswerFlow.proposals
                        if p.get("action") == "create_goal" and p.get("target_date")]
        assert create_props
        prop = create_props[0]
        r = requests.post(
            f"{BASE_URL}/api/tools/confirm",
            json={"message_id": TestAutoAnswerFlow.message_id, "proposal_id": prop["id"]},
            headers=AUTH_HEADERS,
        )
        assert r.status_code == 200, r.text
        state = r.json()["state"]
        found = next((g for g in state["goals"] if g["title"] == prop["title"]), None)
        assert found is not None
        assert found.get("target_date") == prop["target_date"]

    def test_confirm_milestone_persists(self):
        if not TestAutoAnswerFlow.proposals:
            pytest.skip()
        ms_props = [p for p in TestAutoAnswerFlow.proposals if p.get("action") == "add_milestone"]
        if not ms_props:
            pytest.skip("no milestone proposals")
        # Find one whose goal_title matches a confirmed goal (or confirm the goal first)
        state = requests.get(f"{BASE_URL}/api/state", headers=AUTH_HEADERS).json()
        goal_titles = {g["title"] for g in state["goals"]}
        prop = next((p for p in ms_props if p.get("goal_title") in goal_titles), None)
        if prop is None:
            # Confirm the referenced goal first
            target = ms_props[0].get("goal_title")
            gp = next((p for p in TestAutoAnswerFlow.proposals
                       if p.get("action") == "create_goal" and p.get("title") == target), None)
            if gp is None:
                pytest.skip("cannot align milestone with a create_goal proposal")
            r = requests.post(f"{BASE_URL}/api/tools/confirm",
                              json={"message_id": TestAutoAnswerFlow.message_id, "proposal_id": gp["id"]},
                              headers=AUTH_HEADERS)
            assert r.status_code in (200, 409)
            prop = ms_props[0]

        r = requests.post(f"{BASE_URL}/api/tools/confirm",
                          json={"message_id": TestAutoAnswerFlow.message_id, "proposal_id": prop["id"]},
                          headers=AUTH_HEADERS)
        assert r.status_code == 200, r.text
        state = r.json()["state"]
        assert "milestones" in state
        titles = [m["title"] for m in state["milestones"]]
        assert prop["title"] in titles


# ---------------- State shape now includes milestones + blockers ----------------
class TestStateShapeV2:
    def test_state_has_milestones_key(self):
        r = requests.get(f"{BASE_URL}/api/state", headers=AUTH_HEADERS)
        assert r.status_code == 200
        d = r.json()
        assert "milestones" in d
        assert isinstance(d["milestones"], list)
        # humanized message on over_commitment
        assert "over_commitment" in d
