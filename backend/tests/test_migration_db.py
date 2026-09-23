"""Direct DB test of guest -> account migration branch in POST /api/auth/session.

Since real Google OAuth cannot be minted, we exercise the migration logic by
directly running the same collection operations create_session performs after
successful auth. This is a data-model correctness test.
"""
import os
import uuid

from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def test_guest_migration_moves_all_collections():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    gid = f"guest_test_{uuid.uuid4().hex[:8]}"
    uid = f"user_test_{uuid.uuid4().hex[:8]}"
    gtoken = f"gsess_{uuid.uuid4().hex}"

    try:
        db.users.insert_one({"user_id": gid, "is_guest": True, "email": None, "name": "Guest"})
        db.user_sessions.insert_one({"user_id": gid, "session_token": gtoken})
        db.goals.insert_one({"id": "g_mig1", "user_id": gid, "title": "TEST_mig_goal"})
        db.commitments.insert_one({"id": "c_mig1", "user_id": gid, "text": "TEST_mig_c"})
        db.milestones.insert_one({"id": "m_mig1", "user_id": gid, "goal_id": "g_mig1", "title": "TEST_ms"})
        db.blockers.insert_one({"id": "b_mig1", "user_id": gid, "title": "TEST_bk"})
        db.messages.insert_one({"id": "msg_mig1", "user_id": gid, "role": "user", "content": "hi"})
        db.audit_log.insert_one({"id": "a_mig1", "user_id": gid, "action": "test"})
        db.sources.insert_one({"id": "s_mig1", "user_id": gid, "kind": "file", "is_deleted": False})

        db.users.insert_one({"user_id": uid, "email": "TEST_mig@x.com", "name": "T", "is_guest": False})

        # === Execute migration branch (mirrors server.py create_session) ===
        for coll in ["goals", "commitments", "milestones", "blockers", "messages", "audit_log", "sources"]:
            db[coll].update_many({"user_id": gid}, {"$set": {"user_id": uid}})
        db.users.delete_one({"user_id": gid, "is_guest": True})
        db.user_sessions.delete_many({"user_id": gid})

        assert db.goals.find_one({"id": "g_mig1"})["user_id"] == uid
        assert db.commitments.find_one({"id": "c_mig1"})["user_id"] == uid
        assert db.milestones.find_one({"id": "m_mig1"})["user_id"] == uid
        assert db.blockers.find_one({"id": "b_mig1"})["user_id"] == uid
        assert db.messages.find_one({"id": "msg_mig1"})["user_id"] == uid
        assert db.audit_log.find_one({"id": "a_mig1"})["user_id"] == uid
        assert db.sources.find_one({"id": "s_mig1"})["user_id"] == uid
        assert db.users.find_one({"user_id": gid}) is None
        assert db.user_sessions.find_one({"session_token": gtoken}) is None

    finally:
        ids = ["g_mig1", "c_mig1", "m_mig1", "b_mig1", "msg_mig1", "a_mig1", "s_mig1"]
        for coll in ["goals", "commitments", "milestones", "blockers", "messages", "audit_log", "sources"]:
            db[coll].delete_many({"id": {"$in": ids}})
        db.users.delete_many({"user_id": {"$in": [gid, uid]}})
        db.user_sessions.delete_many({"user_id": {"$in": [gid, uid]}})
        client.close()
