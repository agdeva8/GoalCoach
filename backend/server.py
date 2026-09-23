import os
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any

import requests
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, UploadFile, File, Form, Query, Header
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("goalcoach")

app = FastAPI()
api = APIRouter(prefix="/api")

# ----------------------------- Model routing -----------------------------
PROVIDER_MODELS = {
    "gemini": ("gemini", "gemini-3-flash-preview"),
    "openai": ("openai", "gpt-5.4"),
    "anthropic": ("anthropic", "claude-sonnet-4-6"),
}
VALID_PROVIDERS = list(PROVIDER_MODELS.keys())

TOOL_START = "[[TOOLS]]"
TOOL_END = "[[/TOOLS]]"

HORIZONS = ["weekly", "short", "medium", "long"]

# ----------------------------- Helpers -----------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session_token") or request.cookies.get("guest_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ----------------------------- Auth -----------------------------
class SessionIn(BaseModel):
    session_id: str


@api.post("/auth/session")
async def create_session(body: SessionIn, request: Request, response: Response):
    try:
        r = requests.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": body.session_id}, timeout=15)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Auth service error: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()

    email = data["email"]
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture")}},
        )
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    else:
        user_id = new_id("user")
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "model_provider": "gemini",
            "created_at": now_iso(),
        }
        await db.users.insert_one(dict(user))

    session_token = data["session_token"]
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires.isoformat(),
            "created_at": now_iso(),
        }},
        upsert=True,
    )

    # Migrate any anonymous guest data into this account, then retire the guest.
    guest_token = request.cookies.get("guest_token")
    if guest_token:
        gs = await db.user_sessions.find_one({"session_token": guest_token}, {"_id": 0})
        if gs and gs["user_id"] != user_id:
            gid = gs["user_id"]
            for coll in ["goals", "commitments", "milestones", "blockers", "messages", "audit_log", "sources"]:
                await db[coll].update_many({"user_id": gid}, {"$set": {"user_id": user_id}})
            await db.users.delete_one({"user_id": gid, "is_guest": True})
            await db.user_sessions.delete_many({"user_id": gid})
        response.delete_cookie("guest_token", path="/")

    response.set_cookie(
        key="session_token", value=session_token, max_age=7 * 24 * 60 * 60,
        httponly=True, secure=True, samesite="none", path="/",
    )
    user.pop("_id", None)
    return {"user": user}


@api.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api.post("/auth/guest")
async def create_guest(request: Request, response: Response):
    existing = request.cookies.get("guest_token")
    if existing:
        s = await db.user_sessions.find_one({"session_token": existing}, {"_id": 0})
        if s:
            u = await db.users.find_one({"user_id": s["user_id"]}, {"_id": 0})
            if u:
                return {"user": u}
    user_id = new_id("guest")
    user = {
        "user_id": user_id, "email": None, "name": "Guest", "picture": "",
        "model_provider": "gemini", "is_guest": True, "created_at": now_iso(),
    }
    await db.users.insert_one(dict(user))
    token = "gsess_" + uuid.uuid4().hex + uuid.uuid4().hex
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": expires.isoformat(), "created_at": now_iso(),
    })
    response.set_cookie(
        key="guest_token", value=token, max_age=7 * 24 * 60 * 60,
        httponly=True, secure=True, samesite="none", path="/",
    )
    user.pop("_id", None)
    return {"user": user}


class PrefsIn(BaseModel):
    model_provider: str


@api.put("/preferences")
async def update_prefs(body: PrefsIn, user: dict = Depends(get_current_user)):
    if body.model_provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid provider")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"model_provider": body.model_provider}})
    return {"model_provider": body.model_provider}


# ----------------------------- State (dashboard truth) -----------------------------
async def load_state(user_id: str) -> dict:
    goals = await db.goals.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    commitments = await db.commitments.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    milestones = await db.milestones.find({"user_id": user_id}, {"_id": 0}).sort("target_date", 1).to_list(1000)
    blockers = await db.blockers.find({"user_id": user_id}, {"_id": 0}).sort("start_date", 1).to_list(500)
    sources = await db.sources.find({"user_id": user_id, "is_deleted": False}, {"_id": 0, "text_excerpt": 0}).sort("created_at", -1).to_list(500)
    by_goal = {}
    for s in sources:
        by_goal.setdefault(s.get("goal_id") or "", []).append(s)
    for g in goals:
        g["sources"] = by_goal.get(g["id"], [])
    active = [g for g in goals if g["status"] == "active"]
    open_commits = [c for c in commitments if c["status"] == "open"]

    level = "clear"
    message = "A steady, focused load."
    conflicting = []
    n = len(active)
    if n >= 7:
        level = "critical"
        message = f"{n} goals at once is a wish-list, not a week. Something needs to be paused."
        conflicting = [g["title"] for g in active[:3]]
    elif n >= 5:
        level = "high"
        message = f"{n} goals and {len(open_commits)} promises in flight — your attention is stretched thin."
        conflicting = [g["title"] for g in active[:3]]
    elif len(open_commits) > 4:
        level = "high"
        message = f"{len(open_commits)} open promises across {n} goals — more than a week really holds."
    elif n >= 3:
        level = "moderate"
        message = f"{n} goals in play. Doable, but only one can lead this week."

    return {
        "goals": goals,
        "commitments": commitments,
        "milestones": milestones,
        "blockers": blockers,
        "sources": sources,
        "over_commitment": {
            "level": level,
            "message": message,
            "conflicting": conflicting,
            "active_goals": n,
            "open_commitments": len(open_commits),
        },
    }


@api.get("/state")
async def get_state(user: dict = Depends(get_current_user)):
    return await load_state(user["user_id"])


# ----------------------------- Audit log -----------------------------
async def log_audit(user_id: str, event_type: str, summary: str, payload: dict):
    await db.audit_log.insert_one({
        "id": new_id("audit"),
        "user_id": user_id,
        "type": event_type,
        "summary": summary,
        "payload": payload,
        "created_at": now_iso(),
    })


@api.get("/audit")
async def get_audit(user: dict = Depends(get_current_user)):
    events = await db.audit_log.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return events


@api.get("/audit/export")
async def export_audit(user: dict = Depends(get_current_user)):
    events = await db.audit_log.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(5000)
    messages = await db.messages.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(5000)
    state = await load_state(user["user_id"])
    export = {
        "exported_at": now_iso(),
        "user": {"email": user["email"], "name": user.get("name")},
        "state": {"goals": state["goals"], "commitments": state["commitments"]},
        "conversation": messages,
        "audit_log": events,
    }
    headers = {"Content-Disposition": "attachment; filename=goalcoach-export.json"}
    return JSONResponse(content=export, headers=headers)


# ----------------------------- Tool application -----------------------------
async def find_goal_by_title(user_id: str, title: str) -> Optional[dict]:
    if not title:
        return None
    goals = await db.goals.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    tl = title.strip().lower()
    for g in goals:
        if g["title"].strip().lower() == tl:
            return g
    for g in goals:
        if tl in g["title"].strip().lower() or g["title"].strip().lower() in tl:
            return g
    return None


async def apply_proposal(user_id: str, p: dict) -> str:
    action = p.get("action")
    if action == "create_goal":
        goal = {
            "id": new_id("goal"),
            "user_id": user_id,
            "title": p.get("title", "Untitled goal"),
            "horizon": p.get("horizon") if p.get("horizon") in HORIZONS else "medium",
            "why": p.get("why", ""),
            "next_action": p.get("first_action", ""),
            "start_date": p.get("start_date") or datetime.now(timezone.utc).date().isoformat(),
            "target_date": p.get("target_date", ""),
            "status": "active",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.goals.insert_one(dict(goal))
        return f"Created goal '{goal['title']}' ({goal['horizon']})"

    if action in ("update_goal", "drop_goal", "pause_goal"):
        g = await find_goal_by_title(user_id, p.get("goal_title") or p.get("title"))
        if not g:
            return f"No matching goal for '{p.get('goal_title')}'"
        updates = {"updated_at": now_iso()}
        if action == "drop_goal":
            updates["status"] = "dropped"
        elif action == "pause_goal":
            updates["status"] = "paused"
        else:
            if p.get("status") in ("active", "paused", "dropped"):
                updates["status"] = p["status"]
            if p.get("next_action") is not None:
                updates["next_action"] = p["next_action"]
            if p.get("why") is not None:
                updates["why"] = p["why"]
            if p.get("target_date"):
                updates["target_date"] = p["target_date"]
            if p.get("new_title"):
                updates["title"] = p["new_title"]
        await db.goals.update_one({"id": g["id"]}, {"$set": updates})
        verb = {"drop_goal": "Dropped", "pause_goal": "Paused", "update_goal": "Updated"}[action]
        return f"{verb} goal '{g['title']}'"

    if action == "set_goal_dates":
        g = await find_goal_by_title(user_id, p.get("goal_title") or p.get("title"))
        if not g:
            return f"No matching goal for '{p.get('goal_title')}'"
        updates = {"updated_at": now_iso()}
        if p.get("start_date"):
            updates["start_date"] = p["start_date"]
        if p.get("target_date"):
            updates["target_date"] = p["target_date"]
        await db.goals.update_one({"id": g["id"]}, {"$set": updates})
        return f"Timeline set for '{g['title']}': {p.get('start_date','?')} -> {p.get('target_date','?')}"

    if action == "add_milestone":
        g = await find_goal_by_title(user_id, p.get("goal_title"))
        m = {
            "id": new_id("mile"),
            "user_id": user_id,
            "goal_id": g["id"] if g else None,
            "goal_title": g["title"] if g else p.get("goal_title", ""),
            "title": p.get("title", ""),
            "target_date": p.get("target_date", ""),
            "status": "open",
            "created_at": now_iso(),
        }
        await db.milestones.insert_one(dict(m))
        return f"Milestone '{m['title']}' -> {m['target_date']}"

    if action == "add_blocker":
        b = {
            "id": new_id("block"),
            "user_id": user_id,
            "title": p.get("title", ""),
            "start_date": p.get("start_date", ""),
            "end_date": p.get("end_date") or p.get("start_date", ""),
            "note": p.get("note", ""),
            "created_at": now_iso(),
        }
        await db.blockers.insert_one(dict(b))
        return f"Blocker '{b['title']}' {b['start_date']}..{b['end_date']}"

    if action == "add_commitment":
        g = await find_goal_by_title(user_id, p.get("goal_title"))
        commit = {
            "id": new_id("commit"),
            "user_id": user_id,
            "goal_id": g["id"] if g else None,
            "goal_title": g["title"] if g else p.get("goal_title", ""),
            "text": p.get("text", ""),
            "due": p.get("due", ""),
            "status": "open",
            "created_at": now_iso(),
        }
        await db.commitments.insert_one(dict(commit))
        return f"Committed: {commit['text']}"

    if action in ("complete_commitment", "update_commitment"):
        commits = await db.commitments.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
        text = (p.get("text") or "").strip().lower()
        target = None
        for c in commits:
            if c["text"].strip().lower() == text or (text and text in c["text"].strip().lower()):
                target = c
                break
        if not target:
            return f"No matching commitment for '{p.get('text')}'"
        status = "done" if action == "complete_commitment" else p.get("status", "open")
        await db.commitments.update_one({"id": target["id"]}, {"$set": {"status": status}})
        return f"Commitment '{target['text']}' -> {status}"

    return f"Unknown action '{action}'"


class ConfirmIn(BaseModel):
    message_id: str
    proposal_id: str


async def _find_proposal(user_id: str, message_id: str, proposal_id: str):
    msg = await db.messages.find_one({"id": message_id, "user_id": user_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    for pr in msg.get("proposals", []):
        if pr["id"] == proposal_id:
            return msg, pr
    raise HTTPException(status_code=404, detail="Proposal not found")


@api.post("/tools/confirm")
async def confirm_tool(body: ConfirmIn, user: dict = Depends(get_current_user)):
    msg, pr = await _find_proposal(user["user_id"], body.message_id, body.proposal_id)
    if pr.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Proposal already resolved")
    result = await apply_proposal(user["user_id"], pr)
    await db.messages.update_one(
        {"id": body.message_id, "proposals.id": body.proposal_id},
        {"$set": {"proposals.$.status": "confirmed", "proposals.$.result": result}},
    )
    await log_audit(user["user_id"], f"confirm:{pr.get('action')}", result, pr)
    state = await load_state(user["user_id"])
    return {"result": result, "state": state}


@api.post("/tools/reject")
async def reject_tool(body: ConfirmIn, user: dict = Depends(get_current_user)):
    msg, pr = await _find_proposal(user["user_id"], body.message_id, body.proposal_id)
    if pr.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Proposal already resolved")
    await db.messages.update_one(
        {"id": body.message_id, "proposals.id": body.proposal_id},
        {"$set": {"proposals.$.status": "rejected"}},
    )
    await log_audit(user["user_id"], f"reject:{pr.get('action')}", f"User rejected: {pr.get('action')}", pr)
    return {"ok": True}


# ----------------------------- Chat -----------------------------
@api.get("/chat/history")
async def chat_history(user: dict = Depends(get_current_user)):
    msgs = await db.messages.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return msgs


SYSTEM_PROMPT = """You are GoalCoach — a chat-first cross-horizon life coach and realistic planner. Brand line: "Let's sort your life — together."

You do more than track goals. You help the user build a realistic path to each one: sequencing milestones across a timeline, adding buffer for real life, and naming blockers (travel, a sibling's wedding in December, a launch crunch) that make naive plans fail. When you propose dates, be realistic and pad for slippage — a plan that assumes everything goes right is a plan that fails. When a goal is worth planning, propose target dates and 2-4 milestones so it renders on the user's timeline.

VOICE — this is the product, get it right:
- Precise and curious, never warm or supportive. The honest coach is harder to like but easier to trust.
- Name the actual thing the user said. Name the actual drift. Name the actual over-commitment.
- Do NOT validate, encourage, reassure, or coach emotion. No "great job", no "you've got this", no exclamation-point energy.
- No greetings, no filler, no "I'm here to help". Start with the substance.

YOUR WEDGE is cross-horizon synthesis — reasoning across goals of different time horizons (weekly / short (<3mo) / medium (3-12mo) / long (1-3yr)). Not "AI coach". Most tools see one horizon; you see all of them at once.

RESPONSE SHAPES — pick exactly one based on the situation:
1. MULTIPLE GOALS (2-6 active): one tight paragraph synthesizing what deserves attention now and why, then up to 3 concrete actions for the next 7 days, then exactly 1 sentence naming what they're over-committing to. Do not exceed 3 actions.
2. ONE NEW GOAL only: acknowledge the goal in one line, then ask exactly 2 clarifying questions inline: (a) the smallest next commitment, (b) when this starts feeling routine / what "on track" looks like. Do NOT produce the synthesis+actions shape — there is nothing to synthesize across yet.
3. OVER-COMMITTED (>=7 goals): do NOT synthesize or give actions. Diagnose the over-commitment: name 2-3 specific goals in direct conflict and recommend dropping or pausing one. The user needs permission to subtract.
4. RETURNING AFTER A GAP: do not greet. Synthesize across the gap, surface the last concrete commitment from history, and if recent actions contradict it, name the drift plainly.
5. META QUESTION about a past commitment: surface the exact prior commitment from history/state, contrast it against current state, name the gap.
6. ROUTINE RETURN: continue the conversation naturally, no special greeting, no recap.

STATE WRITES (critical): You are the ONLY writer of goals and commitments, but you cannot write silently. When the conversation implies a change to tracked state (the user names a goal to track, agrees to a commitment, wants to drop/pause a goal, or marks something done), you PROPOSE it as a tool call and the user confirms. Never claim state changed — say you're proposing it.

CLARIFY: When AUTO-ANSWER MODE is OFF (stated in LIVE STATE) and the user introduces a NEW goal or asks you to plan, you MUST ask 1-2 sharp clarifying questions and MUST NOT emit a [[TOOLS]] block in that turn — wait for their answer first. Ask only what changes the plan (the smallest next step, a realistic deadline, hard constraints or blockers); do not interrogate. When AUTO-ANSWER MODE is ON, do not ask — make explicit assumptions, state them in one short line, and proceed straight to proposing.

To propose tool calls, end your message with a single block, after all prose:
[[TOOLS]]
[ {json}, {json} ]
[[/TOOLS]]
Emit the block ONLY when a state change is warranted. If nothing should change, do not emit it.

Allowed tool objects (JSON):
- {"action":"create_goal","title":"...","horizon":"weekly|short|medium|long","why":"...","first_action":"...","target_date":"YYYY-MM-DD"}
- {"action":"update_goal","goal_title":"<existing title>","status":"active|paused|dropped","next_action":"...","new_title":"...","target_date":"YYYY-MM-DD"}
- {"action":"set_goal_dates","goal_title":"<existing title>","start_date":"YYYY-MM-DD","target_date":"YYYY-MM-DD"}
- {"action":"add_milestone","goal_title":"<existing title>","title":"...","target_date":"YYYY-MM-DD"}
- {"action":"add_blocker","title":"...","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","note":"..."}
- {"action":"drop_goal","goal_title":"<existing title>","reason":"..."}
- {"action":"pause_goal","goal_title":"<existing title>","reason":"..."}
- {"action":"add_commitment","goal_title":"<existing title>","text":"...","due":"YYYY-MM-DD"}
- {"action":"complete_commitment","text":"<commitment text>"}
Reference existing goals by their exact current title. Use ISO dates (YYYY-MM-DD) so they render on the timeline — anchor all dates to today's date (given in LIVE STATE) and include buffer. Keep prose free of the raw JSON.

Keep prose free of markdown headers. Short lines. No emojis."""


def build_context(state: dict, history: List[dict], user_name: Optional[str], auto_answer: bool = False) -> str:
    lines = [f"Today is {datetime.now(timezone.utc).date().isoformat()}.",
             f"AUTO-ANSWER MODE: {'on' if auto_answer else 'off'}."]
    goals = [g for g in state["goals"] if g["status"] != "dropped"]
    if goals:
        lines.append("CURRENT TRACKED GOALS:")
        for g in goals:
            na = f" | next: {g.get('next_action')}" if g.get("next_action") else ""
            td = f" | target: {g.get('target_date')}" if g.get("target_date") else ""
            lines.append(f"- [{g['horizon']}] {g['title']} (status: {g['status']}){na}{td}")
    else:
        lines.append("CURRENT TRACKED GOALS: none yet.")

    open_c = [c for c in state["commitments"] if c["status"] == "open"]
    if open_c:
        lines.append("\nOPEN COMMITMENTS:")
        for c in open_c:
            due = f" (due {c['due']})" if c.get("due") else ""
            lines.append(f"- {c['text']}{due} [goal: {c.get('goal_title','')}]")

    milestones = state.get("milestones", [])
    if milestones:
        lines.append("\nMILESTONES:")
        for m in milestones:
            lines.append(f"- {m.get('title')} [{m.get('goal_title','')}] target {m.get('target_date','')} ({m.get('status','open')})")
    blockers = state.get("blockers", [])
    if blockers:
        lines.append("\nKNOWN BLOCKERS (plan around these):")
        for b in blockers:
            lines.append(f"- {b.get('title')} {b.get('start_date','')}..{b.get('end_date','')} {b.get('note','')}")

    oc = state["over_commitment"]
    lines.append(f"\nLOAD: {oc['active_goals']} active goals, {oc['open_commitments']} open commitments. Level: {oc['level']}.")

    if history:
        lines.append("\nRECENT CONVERSATION (oldest first):")
        for m in history[-24:]:
            role = "User" if m["role"] == "user" else "Coach"
            lines.append(f"{role}: {m['content']}")
    else:
        lines.append("\nThis is the first message from this user.")
    return "\n".join(lines)


def parse_proposals(full: str) -> List[dict]:
    if TOOL_START not in full:
        return []
    tail = full.split(TOOL_START, 1)[1]
    tail = tail.split(TOOL_END, 1)[0].strip()
    if not tail:
        return []
    data = None
    try:
        data = json.loads(tail)
    except Exception:
        start = tail.find("[")
        end = tail.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(tail[start:end + 1])
            except Exception:
                data = None
    if data is None:
        return []
    if isinstance(data, dict):
        data = [data]
    out = []
    for d in data:
        if isinstance(d, dict) and d.get("action"):
            d["id"] = new_id("prop")
            d["status"] = "pending"
            out.append(d)
    return out


class ChatIn(BaseModel):
    message: str
    auto_answer: bool = False


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


@api.post("/chat/stream")
async def chat_stream(body: ChatIn, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    user_msg_text = body.message.strip()

    state = await load_state(user_id)
    history = await db.messages.find({"user_id": user_id}, {"_id": 0, "content": 1, "role": 1}).sort("created_at", 1).to_list(2000)

    user_msg = {
        "id": new_id("msg"),
        "user_id": user_id,
        "role": "user",
        "content": user_msg_text,
        "proposals": [],
        "created_at": now_iso(),
    }
    await db.messages.insert_one(dict(user_msg))

    provider = user.get("model_provider", "gemini")
    if provider not in PROVIDER_MODELS:
        provider = "gemini"
    prov_name, model_name = PROVIDER_MODELS[provider]

    context = build_context(state, history, user.get("name"), body.auto_answer)
    src_docs = await db.sources.find({"user_id": user_id, "is_deleted": False}, {"_id": 0}).to_list(100)
    if src_docs:
        budget = 4000
        sl = ["\nUPLOADED SOURCES (use these to shape milestones and commitments):"]
        for s in src_docs:
            ex = (s.get("text_excerpt") or "").strip()[:1200]
            if not ex:
                continue
            tag = s.get("original_filename") or s.get("url") or "source"
            gt = f" [goal: {s['goal_title']}]" if s.get("goal_title") else ""
            chunk = f"- {tag}{gt}: {ex}"
            if budget - len(chunk) < 0:
                break
            budget -= len(chunk)
            sl.append(chunk)
        if len(sl) > 1:
            context = context + "\n" + "\n".join(sl)
    system = SYSTEM_PROMPT + "\n\n=== LIVE STATE & MEMORY ===\n" + context

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=user_id,
        system_message=system,
    ).with_model(prov_name, model_name)

    async def gen():
        full = ""
        prose_emitted = 0
        in_tools = False
        try:
            async for ev in chat.stream_message(UserMessage(text=user_msg_text)):
                if isinstance(ev, TextDelta):
                    full += ev.content
                    if not in_tools:
                        idx = full.find(TOOL_START)
                        if idx == -1:
                            safe_upto = max(prose_emitted, len(full) - len(TOOL_START))
                            if safe_upto > prose_emitted:
                                yield sse({"type": "delta", "content": full[prose_emitted:safe_upto]})
                                prose_emitted = safe_upto
                        else:
                            if idx > prose_emitted:
                                yield sse({"type": "delta", "content": full[prose_emitted:idx]})
                            prose_emitted = idx
                            in_tools = True
                elif isinstance(ev, StreamDone):
                    break
        except Exception as e:
            logger.exception("stream error")
            yield sse({"type": "error", "content": f"Model error: {e}"})
            return

        if not in_tools and prose_emitted < len(full):
            yield sse({"type": "delta", "content": full[prose_emitted:]})

        prose = full.split(TOOL_START, 1)[0].strip() if in_tools else full.strip()
        proposals = parse_proposals(full)

        assistant_id = new_id("msg")
        await db.messages.insert_one({
            "id": assistant_id,
            "user_id": user_id,
            "role": "assistant",
            "content": prose,
            "proposals": proposals,
            "provider": provider,
            "created_at": now_iso(),
        })
        if proposals:
            yield sse({"type": "tools", "message_id": assistant_id, "proposals": proposals})
        yield sse({"type": "done", "message_id": assistant_id, "provider": provider})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


class GuestChatIn(BaseModel):
    message: str
    history: Optional[List[dict]] = None
    auto_answer: bool = False


@api.post("/chat/guest_stream")
async def guest_chat_stream(body: GuestChatIn):
    history = body.history or []
    ctx = [
        f"Today is {datetime.now(timezone.utc).date().isoformat()}.",
        f"AUTO-ANSWER MODE: {'on' if body.auto_answer else 'off'}.",
        "PREVIEW MODE: the user is NOT signed in. There is no saved state or long-term memory. You may synthesize and PROPOSE tool calls normally, but they will not be saved until the user signs in.",
    ]
    if history:
        ctx.append("\nRECENT CONVERSATION (oldest first):")
        for m in history[-16:]:
            role = "User" if m.get("role") == "user" else "Coach"
            ctx.append(f"{role}: {m.get('content','')}")
    system = SYSTEM_PROMPT + "\n\n=== LIVE STATE & MEMORY ===\n" + "\n".join(ctx)

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"guest_{uuid.uuid4().hex}",
        system_message=system,
    ).with_model("gemini", "gemini-3-flash-preview")

    async def gen():
        full = ""
        prose_emitted = 0
        in_tools = False
        try:
            async for ev in chat.stream_message(UserMessage(text=body.message)):
                if isinstance(ev, TextDelta):
                    full += ev.content
                    if not in_tools:
                        idx = full.find(TOOL_START)
                        if idx == -1:
                            safe_upto = max(prose_emitted, len(full) - len(TOOL_START))
                            if safe_upto > prose_emitted:
                                yield sse({"type": "delta", "content": full[prose_emitted:safe_upto]})
                                prose_emitted = safe_upto
                        else:
                            if idx > prose_emitted:
                                yield sse({"type": "delta", "content": full[prose_emitted:idx]})
                            prose_emitted = idx
                            in_tools = True
                elif isinstance(ev, StreamDone):
                    break
        except Exception as e:
            logger.exception("guest stream error")
            yield sse({"type": "error", "content": f"Model error: {e}"})
            return
        if not in_tools and prose_emitted < len(full):
            yield sse({"type": "delta", "content": full[prose_emitted:]})
        proposals = parse_proposals(full)
        if proposals:
            yield sse({"type": "tools", "message_id": "guest", "proposals": proposals})
        yield sse({"type": "done", "message_id": "guest", "provider": "gemini"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ----------------------------- Object storage -----------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "goalcoach"
_storage_key = None


def init_storage(force: bool = False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def extract_text(ext: str, data: bytes) -> str:
    try:
        if ext == "pdf":
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((p.extract_text() or "") for p in reader.pages)[:8000]
        return data.decode("utf-8", errors="ignore")[:8000]
    except Exception:
        return ""


def fetch_link_text(url: str) -> str:
    import re
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", r.text, flags=re.S | re.I)
        t = re.sub(r"<[^>]+>", " ", t)
        return re.sub(r"\s+", " ", t).strip()[:8000]
    except Exception:
        return ""


@app.on_event("startup")
async def _startup():
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


# ----------------------------- Blockers (direct edit) -----------------------------
class BlockerIn(BaseModel):
    title: str
    start_date: str
    end_date: Optional[str] = None
    note: Optional[str] = ""


@api.post("/blockers")
async def create_blocker(body: BlockerIn, user: dict = Depends(get_current_user)):
    b = {
        "id": new_id("block"), "user_id": user["user_id"], "title": body.title,
        "start_date": body.start_date, "end_date": body.end_date or body.start_date,
        "note": body.note or "", "created_at": now_iso(),
    }
    await db.blockers.insert_one(dict(b))
    b.pop("_id", None)
    return b


@api.put("/blockers/{bid}")
async def update_blocker(bid: str, body: BlockerIn, user: dict = Depends(get_current_user)):
    await db.blockers.update_one(
        {"id": bid, "user_id": user["user_id"]},
        {"$set": {"title": body.title, "start_date": body.start_date, "end_date": body.end_date or body.start_date, "note": body.note or ""}},
    )
    return {"ok": True}


@api.delete("/blockers/{bid}")
async def delete_blocker(bid: str, user: dict = Depends(get_current_user)):
    await db.blockers.delete_one({"id": bid, "user_id": user["user_id"]})
    return {"ok": True}


# ----------------------------- Sources (files & links) -----------------------------
class LinkIn(BaseModel):
    url: str
    title: Optional[str] = ""
    goal_id: Optional[str] = ""


async def _goal_title(user_id: str, goal_id: str) -> str:
    if not goal_id:
        return ""
    g = await db.goals.find_one({"id": goal_id, "user_id": user_id}, {"_id": 0})
    return g["title"] if g else ""


@api.post("/sources/upload")
async def upload_source(file: UploadFile = File(...), goal_id: str = Form(""), user: dict = Depends(get_current_user)):
    data = await file.read()
    fn = file.filename or "file"
    ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else "bin"
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    result = put_object(path, data, file.content_type or "application/octet-stream")
    rec = {
        "id": new_id("src"), "user_id": user["user_id"], "goal_id": goal_id or "",
        "goal_title": await _goal_title(user["user_id"], goal_id), "kind": "file",
        "storage_path": result["path"], "original_filename": fn,
        "content_type": file.content_type or "application/octet-stream",
        "size": result.get("size", len(data)), "url": "",
        "text_excerpt": extract_text(ext, data), "is_deleted": False, "created_at": now_iso(),
    }
    await db.sources.insert_one(dict(rec))
    rec.pop("_id", None)
    rec.pop("text_excerpt", None)
    return rec


@api.post("/sources/link")
async def add_link(body: LinkIn, user: dict = Depends(get_current_user)):
    rec = {
        "id": new_id("src"), "user_id": user["user_id"], "goal_id": body.goal_id or "",
        "goal_title": await _goal_title(user["user_id"], body.goal_id or ""), "kind": "link",
        "storage_path": "", "original_filename": body.title or body.url,
        "content_type": "text/uri-list", "size": 0, "url": body.url,
        "text_excerpt": fetch_link_text(body.url), "is_deleted": False, "created_at": now_iso(),
    }
    await db.sources.insert_one(dict(rec))
    rec.pop("_id", None)
    rec.pop("text_excerpt", None)
    return rec


@api.get("/sources")
async def list_sources(user: dict = Depends(get_current_user)):
    return await db.sources.find({"user_id": user["user_id"], "is_deleted": False}, {"_id": 0, "text_excerpt": 0}).sort("created_at", -1).to_list(500)


@api.get("/sources/{sid}/download")
async def download_source(sid: str, request: Request, auth: Optional[str] = Query(None)):
    token = request.cookies.get("session_token") or request.cookies.get("guest_token") or auth
    if not token:
        a = request.headers.get("Authorization", "")
        token = a[7:] if a.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")
    rec = await db.sources.find_one({"id": sid, "user_id": sess["user_id"], "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    if rec["kind"] == "link":
        return JSONResponse({"url": rec["url"]})
    content, ctype = get_object(rec["storage_path"])
    return Response(content=content, media_type=rec.get("content_type", ctype),
                    headers={"Content-Disposition": f'inline; filename="{rec["original_filename"]}"'})


@api.delete("/sources/{sid}")
async def delete_source(sid: str, user: dict = Depends(get_current_user)):
    await db.sources.update_one({"id": sid, "user_id": user["user_id"]}, {"$set": {"is_deleted": True}})
    return {"ok": True}


@api.get("/")
async def root():
    return {"message": "GoalCoach API"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
