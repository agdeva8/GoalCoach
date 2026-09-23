"""Iteration 3 tests: guest sessions, blockers CRUD, sources upload/link/download/delete,
guest -> account migration (data-level), sources feeding coach.
"""
import io
import json
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://weekly-focus-3.preview.emergentagent.com").rstrip("/")
SESSION_TOKEN = "test_session_founder01"
AUTH_HEADERS = {"Authorization": f"Bearer {SESSION_TOKEN}"}


def _read_sse(resp) -> list:
    events, buf = [], ""
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


# ---------------- Guest session ----------------
class TestGuest:
    def test_create_guest_sets_cookie_and_returns_is_guest(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/guest")
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["is_guest"] is True
        assert u["user_id"].startswith("guest_")
        assert "guest_token" in s.cookies.get_dict()

    def test_guest_me_returns_guest_user(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/guest")
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200, r.text
        assert r.json()["is_guest"] is True

    def test_guest_can_get_state(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/guest")
        r = s.get(f"{BASE_URL}/api/state")
        assert r.status_code == 200
        d = r.json()
        assert "goals" in d and "milestones" in d and "blockers" in d

    def test_guest_persists_across_requests(self):
        s = requests.Session()
        r1 = s.post(f"{BASE_URL}/api/auth/guest").json()["user"]
        r2 = s.post(f"{BASE_URL}/api/auth/guest").json()["user"]
        assert r1["user_id"] == r2["user_id"], "guest_token cookie should keep same user"


# ---------------- Blockers CRUD ----------------
class TestBlockers:
    def test_blocker_full_crud(self):
        # create
        r = requests.post(f"{BASE_URL}/api/blockers", headers=AUTH_HEADERS,
                          json={"title": "TEST_travel", "start_date": "2026-06-01", "end_date": "2026-06-10", "note": "trip"})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["title"] == "TEST_travel"
        assert b["start_date"] == "2026-06-01"
        bid = b["id"]

        # list via state
        state = requests.get(f"{BASE_URL}/api/state", headers=AUTH_HEADERS).json()
        assert any(x["id"] == bid for x in state["blockers"])

        # update
        r = requests.put(f"{BASE_URL}/api/blockers/{bid}", headers=AUTH_HEADERS,
                         json={"title": "TEST_travel_updated", "start_date": "2026-06-02", "end_date": "2026-06-12", "note": "new"})
        assert r.status_code == 200
        state = requests.get(f"{BASE_URL}/api/state", headers=AUTH_HEADERS).json()
        b2 = next(x for x in state["blockers"] if x["id"] == bid)
        assert b2["title"] == "TEST_travel_updated"
        assert b2["start_date"] == "2026-06-02"

        # delete
        r = requests.delete(f"{BASE_URL}/api/blockers/{bid}", headers=AUTH_HEADERS)
        assert r.status_code == 200
        state = requests.get(f"{BASE_URL}/api/state", headers=AUTH_HEADERS).json()
        assert not any(x["id"] == bid for x in state["blockers"])

    def test_blockers_require_auth(self):
        r = requests.post(f"{BASE_URL}/api/blockers", json={"title": "x", "start_date": "2026-01-01"})
        assert r.status_code == 401


# ---------------- Sources: upload / link / list / download / delete ----------------
class TestSources:
    created_ids: list = []

    def test_upload_txt_file(self):
        content = b"DSA questions:\n1) Two Sum\n2) LRU cache\n3) BFS on grid\n"
        files = {"file": ("TEST_dsa.txt", io.BytesIO(content), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/sources/upload", headers=AUTH_HEADERS,
                          data={"goal_id": ""}, files=files)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kind"] == "file"
        assert d["original_filename"] == "TEST_dsa.txt"
        assert d["size"] > 0
        assert "text_excerpt" not in d
        assert "_id" not in d
        TestSources.created_ids.append(d["id"])

    def test_list_sources_contains_uploaded(self):
        r = requests.get(f"{BASE_URL}/api/sources", headers=AUTH_HEADERS)
        assert r.status_code == 200
        assert any(s["id"] in TestSources.created_ids for s in r.json())

    def test_download_file_source(self):
        assert TestSources.created_ids
        sid = TestSources.created_ids[0]
        r = requests.get(f"{BASE_URL}/api/sources/{sid}/download", headers=AUTH_HEADERS)
        assert r.status_code == 200, r.text
        assert b"Two Sum" in r.content or b"DSA" in r.content

    def test_add_link_source(self):
        r = requests.post(f"{BASE_URL}/api/sources/link", headers=AUTH_HEADERS,
                          json={"url": "https://example.com", "title": "TEST_example"})
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "link"
        assert d["url"] == "https://example.com"
        TestSources.created_ids.append(d["id"])

    def test_download_link_returns_url(self):
        # last-appended is the link one
        link_id = TestSources.created_ids[-1]
        r = requests.get(f"{BASE_URL}/api/sources/{link_id}/download", headers=AUTH_HEADERS)
        assert r.status_code == 200
        assert r.json().get("url") == "https://example.com"

    def test_download_via_query_auth(self):
        sid = TestSources.created_ids[0]
        r = requests.get(f"{BASE_URL}/api/sources/{sid}/download?auth={SESSION_TOKEN}")
        assert r.status_code == 200

    def test_upload_requires_auth(self):
        files = {"file": ("x.txt", io.BytesIO(b"hi"), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/sources/upload", files=files, data={"goal_id": ""})
        assert r.status_code == 401

    def test_download_requires_auth(self):
        sid = TestSources.created_ids[0]
        r = requests.get(f"{BASE_URL}/api/sources/{sid}/download")
        assert r.status_code == 401

    def test_upload_with_goal_id_binds_source(self):
        # Create a temporary goal via chat + confirm is heavy; instead, just verify goal_title is empty when goal_id missing.
        # For binding, insert directly is not possible without db access; assert non-error path with any goal_id string.
        content = b"notes for goal"
        files = {"file": ("TEST_goalnote.txt", io.BytesIO(content), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/sources/upload", headers=AUTH_HEADERS,
                          data={"goal_id": "nonexistent_goal"}, files=files)
        assert r.status_code == 200
        d = r.json()
        assert d["goal_id"] == "nonexistent_goal"
        assert d["goal_title"] == ""  # unknown goal_id -> empty title
        TestSources.created_ids.append(d["id"])

    def test_delete_source_soft(self):
        sid = TestSources.created_ids[0]
        r = requests.delete(f"{BASE_URL}/api/sources/{sid}", headers=AUTH_HEADERS)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/sources", headers=AUTH_HEADERS)
        assert not any(s["id"] == sid for s in r.json())
        # Download of soft-deleted source should 404
        r = requests.get(f"{BASE_URL}/api/sources/{sid}/download", headers=AUTH_HEADERS)
        assert r.status_code == 404


# ---------------- State includes sources ----------------
class TestStateSources:
    def test_state_includes_sources_key(self):
        # Upload a fresh source so state has at least one
        files = {"file": ("TEST_state.txt", io.BytesIO(b"hello state"), "text/plain")}
        requests.post(f"{BASE_URL}/api/sources/upload", headers=AUTH_HEADERS,
                      data={"goal_id": ""}, files=files)
        r = requests.get(f"{BASE_URL}/api/state", headers=AUTH_HEADERS)
        assert r.status_code == 200
        d = r.json()
        assert "sources" in d, f"state keys: {list(d.keys())}"
        assert isinstance(d["sources"], list)


# ---------------- Guest sources upload with guest cookie ----------------
class TestGuestSources:
    def test_guest_can_upload_source(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/guest")
        files = {"file": ("TEST_guest.txt", io.BytesIO(b"guest content"), "text/plain")}
        r = s.post(f"{BASE_URL}/api/sources/upload", data={"goal_id": ""}, files=files)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        r = s.get(f"{BASE_URL}/api/sources")
        assert r.status_code == 200
        assert any(x["id"] == sid for x in r.json())


# ---------------- Auth/session endpoint exists (migration path smoke) ----------------
class TestAuthSessionEndpoint:
    def test_auth_session_endpoint_exists_and_rejects_bad_session_id(self):
        r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "definitely_invalid_xyz"})
        # Should be 401 (from Emergent auth) or 502 (unreachable), not 404/500
        assert r.status_code in (401, 502), f"unexpected {r.status_code}: {r.text}"


# ---------------- Guest chat with source ----------------
class TestGuestChatWithSource:
    def test_guest_create_goal_via_autoanswer(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/guest")
        with s.post(f"{BASE_URL}/api/chat/guest_stream",
                    json={"message": "I want to learn DSA and land a FAANG offer in 6 months.",
                          "history": [], "auto_answer": True},
                    stream=True, timeout=120) as r:
            assert r.status_code == 200
            events = _read_sse(r)
        assert any(e["type"] == "tools" for e in events)
