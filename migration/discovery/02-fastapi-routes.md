# FastAPI Route Surface — GoalCoach Backend

**File:** `/Users/deva/Documents/Projects/GoalCoach/backend/server.py`
**Source:** Direct code analysis + graph query confirmation
**Graph:** `graphify-out/graph.json` (968 nodes, pre-#1504 schema)

---

## 1. All Routes (Method + Path + Auth + Request/Response Shape)

### Auth Domain

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| POST | `/api/auth/session` | None | `SessionIn { session_id: str }` | `{ user: User }` |
| GET | `/api/auth/me` | Required | — | `User` dict |
| POST | `/api/auth/logout` | Required | — | `{ ok: true }` |
| POST | `/api/auth/guest` | None | — | `{ user: User }` |

**MongoDB collections touched:** `users`, `user_sessions`

### Preferences Domain

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| PUT | `/api/preferences` | Required | `PrefsIn { model_provider: str }` | `{ model_provider: str }` |

**Valid providers:** `gemini`, `openai`, `anthropic`
**MongoDB collections touched:** `users`

### State / Dashboard Domain

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| GET | `/api/state` | Required | — | Full state object (see below) |

**MongoDB collections touched:** `goals`, `commitments`, `milestones`, `blockers`, `sources`

State response shape:
```json
{
  "goals": [...],
  "commitments": [...],
  "milestones": [...],
  "blockers": [...],
  "sources": [...],
  "over_commitment": {
    "level": "clear|moderate|high|critical",
    "message": "...",
    "conflicting": [...],
    "active_goals": N,
    "open_commitments": N
  }
}
```

### Audit Domain

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| GET | `/api/audit` | Required | — | `AuditEvent[]` |
| GET | `/api/audit/export` | Required | — | JSON file download |

**MongoDB collections touched:** `audit_log`, `messages`, `goals`, `commitments`

### Chat / LLM Domain (HIGHEST MIGRATION COST)

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| GET | `/api/chat/history` | Required | — | `Message[]` |
| POST | `/api/chat/stream` | Required | `ChatIn { message: str, auto_answer: bool }` | SSE stream |
| POST | `/api/chat/guest_stream` | None | `GuestChatIn { message: str, history?, auto_answer: bool }` | SSE stream |

**MongoDB collections touched:** `messages`, `goals`, `commitments`, `milestones`, `blockers`, `sources`

**LLM Providers (via Emergent Integrations):**
- `gemini` → `gemini-3-flash-preview`
- `openai` → `gpt-5.4`
- `anthropic` → `claude-sonnet-4-6`

Both chat endpoints use `emergentintegrations.llm.chat.LlmChat` with `stream_message()`.
The system prompt is a ~60-line multi-section coaching charter (lines 477–519).
Tool calls are proposed via `[[TOOLS]]...[[/TOOLS]]` blocks parsed from the stream.

### Tool Confirm/Reject Domain

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| POST | `/api/tools/confirm` | Required | `ConfirmIn { message_id: str, proposal_id: str }` | `{ result: str, state: FullState }` |
| POST | `/api/tools/reject` | Required | `ConfirmIn { message_id: str, proposal_id: str }` | `{ ok: true }` |

**MongoDB collections touched:** `messages`, `goals`, `commitments`, `milestones`, `blockers`, `audit_log`

### Blockers Domain

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| POST | `/api/blockers` | Required | `BlockerIn { title, start_date, end_date?, note? }` | `Blocker` |
| PUT | `/api/blockers/{bid}` | Required | `BlockerIn { ... }` | `{ ok: true }` |
| DELETE | `/api/blockers/{bid}` | Required | — | `{ ok: true }` |

**MongoDB collections touched:** `blockers`

### Sources / File Storage Domain

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| POST | `/api/sources/upload` | Required | `multipart/form-data` (file + goal_id) | `Source` |
| POST | `/api/sources/link` | Required | `LinkIn { url, title?, goal_id? }` | `Source` |
| GET | `/api/sources` | Required | — | `Source[]` |
| GET | `/api/sources/{sid}/download` | Token param or cookie | — | File or `{ url: str }` |
| DELETE | `/api/sources/{sid}` | Required | — | `{ ok: true }` |

**Storage:** Emergent Object Storage API (`https://integrations.emergentagent.com/objstore/api/v1/storage`)
**MongoDB collections touched:** `sources`
**Allowed file types:** `pdf`, `md`, `txt`, `csv`, `json`, `png`, `jpg`, `jpeg`, `docx`
**Max file size:** 20MB

### Root

| Method | Path | Auth | Request Shape | Response Shape |
|--------|------|------|---------------|---------------|
| GET | `/` | None | — | `{ message: "GoalCoach API" }` |

---

## 2. Pydantic Models (Request/Response Shapes)

| Model | Fields | Used In |
|-------|--------|---------|
| `SessionIn` | `session_id: str` | POST `/api/auth/session` |
| `PrefsIn` | `model_provider: str` | PUT `/api/preferences` |
| `ChatIn` | `message: str`, `auto_answer: bool = False` | POST `/api/chat/stream` |
| `GuestChatIn` | `message: str`, `history?: List[dict]`, `auto_answer: bool = False` | POST `/api/chat/guest_stream` |
| `ConfirmIn` | `message_id: str`, `proposal_id: str` | POST `/api/tools/confirm`, POST `/api/tools/reject` |
| `BlockerIn` | `title: str`, `start_date: str`, `end_date?: str`, `note?: str` | POST/PUT `/api/blockers` |
| `LinkIn` | `url: str`, `title?: str`, `goal_id?: str` | POST `/api/sources/link` |

**No separate response models** — endpoints return plain dicts or inline Pydantic-instantiated objects. Responses are implicit.

---

## 3. MongoDB Collections Touched

| Collection | Read | Write | Notes |
|-----------|------|-------|-------|
| `users` | Yes | Yes | User records, model_provider preference |
| `user_sessions` | Yes | Yes | Session tokens with 7-day expiry |
| `goals` | Yes | Yes | Goals with horizon, status, target_date |
| `commitments` | Yes | Yes | Time-bound promises linked to goals |
| `milestones` | Yes | Yes | Date targets linked to goals |
| `blockers` | Yes | Yes | Time ranges with title/note |
| `messages` | Yes | Yes | Full chat history, role, proposals, provider |
| `sources` | Yes | Yes | File/link metadata, text_excerpt, storage_path |
| `audit_log` | Yes | Yes | Event log with type, summary, payload |
| `integrations` | — | — | Not directly accessed in routes |

**Key MongoDB patterns:**
- `_id` is always excluded (`{"_id": 0}`) — custom `id` field used instead
- IDs are prefixed (`user_`, `goal_`, `msg_`, `prop_`, `block_`, `src_`, `mile_`, `commit_`, `audit_`)
- Soft delete on `sources` (`is_deleted: True`)

---

## 4. LLM-Touching Routes (Most Expensive to Migrate)

These routes call `emergentintegrations.llm.chat.LlmChat` and are the highest-cost migration items:

| Route | LLM Call Type | Provider Config | System Prompt |
|-------|--------------|----------------|--------------|
| `POST /api/chat/stream` | `chat.stream_message()` (SSE) | Provider from `user.model_provider`, maps to `PROVIDER_MODELS` | 60-line coaching charter + live state |
| `POST /api/chat/guest_stream` | `chat.stream_message()` (SSE) | Always `gemini/gemini-3-flash-preview` | 60-line coaching charter + preview-mode context |

**LLM stack:** `emergentintegrations.llm.chat.LlmChat` wrapping `litellm` under the hood.
**Key dependencies:** `EMERGENT_LLM_KEY`, `EMERGENT_AUTH_URL`
**Object storage init:** `init_storage()` on startup, `put_object()`/`get_object()` for sources

---

## 5. WebSocket / SSE Endpoints

Both chat endpoints return `StreamingResponse` (SSE), NOT WebSockets:

```
POST /api/chat/stream      → text/event-stream
POST /api/chat/guest_stream → text/event-stream
```

SSE event types emitted:
- `delta` — text chunks from the LLM stream
- `tools` — parsed `[[TOOLS]]` block with `proposal_id`, `message_id`
- `done` — final message metadata
- `error` — LLM error

**No WebSocket upgrade** — pure SSE polling over HTTP.

---

## 6. Middleware / CORS / Auth Dependency Structure

### Auth Dependency

```python
async def get_current_user(request: Request) -> dict
```

- Checks `session_token` or `guest_token` cookie first
- Falls back to `Authorization: Bearer <token>` header
- Queries `user_sessions` then `users` collection
- Validates 7-day expiry
- Returns full user dict to route handlers

**Applied to:** all routes except:
- `POST /api/auth/session` (no auth — validates via Emergent OAuth)
- `POST /api/auth/guest` (no auth — creates anonymous session)
- `POST /api/chat/guest_stream` (no auth — preview mode only)
- `GET /` (health check)
- `GET /api/sources/{sid}/download` (token in cookie or `?auth=` query param)

### CORS Middleware

```python
CORSMiddleware(
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Startup / Shutdown

- `@app.on_event("startup")` — calls `init_storage()` to initialize Emergent object storage
- `@app.on_event("shutdown")` — closes `AsyncIOMotorClient`

### Key Infrastructure Dependencies

| Component | Library | Env Vars |
|-----------|---------|---------|
| MongoDB async driver | `motor.motor_asyncio.AsyncIOMotorClient` | `MONGO_URL`, `DB_NAME` |
| LLM integration | `emergentintegrations.llm.chat.LlmChat` | `EMERGENT_LLM_KEY` |
| OAuth validation | `requests.get(EMERGENT_AUTH_URL)` | `EMERGENT_AUTH_URL` |
| Object storage | Emergent objstore API | `INTEGRATION_PROXY_URL` (optional fallback) |

---

## 7. Migration Complexity Summary

| Domain | Routes | Complexity | Notes |
|--------|--------|------------|-------|
| Auth | 4 | Medium | OAuth token exchange, cookie handling, guest→user migration |
| State | 1 | Low | Read-heavy MongoDB aggregation |
| Audit | 2 | Low | Simple read + JSON export |
| Chat (LLM) | 3 | **HIGH** | SSE streaming, multi-provider LLM, tool proposal parsing |
| Tools | 2 | Medium | State mutation with proposal resolution |
| Blockers | 3 | Low | Simple CRUD |
| Sources | 5 | Medium | File upload + external object storage |
| Preferences | 1 | Low | User preference write |
| **Total** | **21** | | |

**Highest-risk routes for migration:**
1. `POST /api/chat/stream` — LLM streaming, multi-provider routing, tool parsing, SSE
2. `POST /api/chat/guest_stream` — LLM streaming, guest context, no auth
3. `POST /api/auth/session` — OAuth token exchange with Emergent, guest data migration
4. `POST /api/sources/upload` — Object storage integration, PDF extraction
