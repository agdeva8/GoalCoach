# GoalCoach MongoDB Schema Discovery

**Date:** 2026-09-24  
**Source:** `backend/server.py` (FastAPI + Motor 3.3.1) + `backend/tests/test_migration_db.py`  
**Driver:** `motor.motor_asyncio.AsyncIOMotorClient` — async throughout

---

## 1. Collections

All documents use `{"_id": 0}` (MongoDB `_id` is always excluded from results).

### `users`
| Field | Type | Notes |
|---|---|---|
| `user_id` | string | Primary key, e.g. `user_<hex12>` |
| `email` | string | Unique per non-guest; nullable for guests |
| `name` | string | |
| `picture` | string | OAuth profile picture URL |
| `model_provider` | string | `"gemini"` \| `"openai"` \| `"anthropic"` |
| `is_guest` | bool | `True` for anonymous sessions |
| `created_at` | ISO8601 string | UTC |

**Indexes:** `email` (queried on every login), `user_id` (PK-like, queried on every request).  
**No compound indexes.**  
**Count:** O(users), likely small.

---

### `user_sessions`
| Field | Type | Notes |
|---|---|---|
| `user_id` | string | FK → `users.user_id` |
| `session_token` | string | Unique, used as cookie/bearer token |
| `expires_at` | ISO8601 string | 7 days from creation |
| `created_at` | ISO8601 string | |

**Indexes:** `session_token` (queried on every authenticated request via `get_current_user`).  
**Count:** O(sessions) ≈ O(users) × active session count.

---

### `goals`
| Field | Type | Notes |
|---|---|---|
| `id` | string | Primary key, e.g. `goal_<hex12>` |
| `user_id` | string | FK → `users.user_id` |
| `title` | string | Queried by exact/substring match in `find_goal_by_title` |
| `horizon` | string | `"weekly"` \| `"short"` \| `"medium"` \| `"long"` |
| `why` | string | Free text |
| `next_action` | string | |
| `start_date` | ISO date string | |
| `target_date` | ISO date string | |
| `status` | string | `"active"` \| `"paused"` \| `"dropped"` |
| `created_at` | ISO8601 string | |
| `updated_at` | ISO8601 string | |

**Indexes:** `(user_id)` — queried in every state load and dashboard.  
**Sort:** `created_at ASC` on load; `target_date ASC` on milestone load.  
**Suggested indexes:** `(user_id, status)` for `load_state` active-goal filter, `(user_id, created_at)` for the sort.  
**Count:** O(goals per user), likely 5–50.

---

### `commitments`
| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `commit_<hex12>` |
| `user_id` | string | FK |
| `goal_id` | string | Nullable FK → `goals.id` |
| `goal_title` | string | Denormalized goal title |
| `text` | string | Commitment statement; matched by substring search |
| `due` | ISO date string | |
| `status` | string | `"open"` \| `"done"` |
| `created_at` | ISO8601 string | |

**Indexes:** `(user_id)` — queried for all commitments and by text substring.  
**Sort:** `created_at ASC`.  
**Suggested indexes:** `(user_id, status)` for open-only queries.  
**Count:** O(commitments per user), typically 1–20.

---

### `milestones`
| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `mile_<hex12>` |
| `user_id` | string | FK |
| `goal_id` | string | Nullable FK → `goals.id` |
| `goal_title` | string | Denormalized |
| `title` | string | |
| `target_date` | ISO date string | |
| `status` | string | `"open"` (no other values seen in code) |
| `created_at` | ISO8601 string | |

**Indexes:** `(user_id)` — queried for all milestones per user.  
**Sort:** `target_date ASC`.  
**Suggested indexes:** `(user_id, goal_id)` for per-goal milestone listing.  
**Count:** O(milestones per user).

---

### `blockers`
| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `block_<hex12>` |
| `user_id` | string | FK |
| `title` | string | |
| `start_date` | ISO date string | |
| `end_date` | ISO date string | |
| `note` | string | |
| `created_at` | ISO8601 string | |

**Indexes:** `(user_id)` — queried for all blockers.  
**Sort:** `start_date ASC`.  
**Count:** small per user.

---

### `messages`
| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `msg_<hex12>` |
| `user_id` | string | FK |
| `role` | string | `"user"` \| `"assistant"` |
| `content` | string | Full message text |
| `proposals` | array | Tool-call proposals `[{id, action, status, result?}]` |
| `provider` | string | LLM provider used (e.g. `"gemini"`) — only on assistant messages |
| `created_at` | ISO8601 string | |

**Indexes:** `(user_id)` — queried for chat history and audit export.  
**Sort:** `created_at ASC`.  
**Suggested indexes:** `(user_id, role)` if filtering by role is added later.  
**Count:** O(conversation length per user) — grows indefinitely; largest collection by volume.

---

### `audit_log`
| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `audit_<hex12>` |
| `user_id` | string | FK |
| `type` | string | Event type, e.g. `"confirm:create_goal"` |
| `summary` | string | Human-readable summary |
| `payload` | dict | Full proposal/event detail |
| `created_at` | ISO8601 string | |

**Indexes:** `(user_id)` — queried for all audit events.  
**Sort:** `created_at ASC` (export) and `created_at DESC` (list view).  
**Suggested index:** `(user_id, created_at DESC)` for the list view.  
**Count:** O(audit events per user) — grows with tool confirmations/rejections.

---

### `sources`
| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `src_<hex12>` |
| `user_id` | string | FK |
| `goal_id` | string | Nullable FK → `goals.id` |
| `goal_title` | string | Denormalized |
| `kind` | string | `"file"` \| `"link"` |
| `storage_path` | string | Path in object store (files); empty for links |
| `original_filename` | string | |
| `content_type` | string | MIME type |
| `size` | int | Bytes |
| `url` | string | For links; empty for files |
| `text_excerpt` | string | Extracted text (up to 8000 chars); excluded from list queries |
| `is_deleted` | bool | Soft delete flag |
| `created_at` | ISO8601 string | |

**Indexes:** `(user_id, is_deleted)` — always filtered with `is_deleted: False`.  
**Sort:** `created_at DESC`.  
**Suggested index:** `(user_id, goal_id, is_deleted)` for per-goal source listing.  
**Count:** O(sources per user) — typically small (files/links attached to goals).

---

## 2. Indexes

### Existing (inferred from queries)
| Collection | Index | Reason |
|---|---|---|
| `users` | `email` | `find_one({email})` on login |
| `users` | `user_id` (implicit _id or explicit) | PK-like lookup on every request |
| `user_sessions` | `session_token` | Auth lookup on every request |
| `goals` | `user_id` | State load |
| `commitments` | `user_id` | State load |
| `milestones` | `user_id` | State load |
| `blockers` | `user_id` | State load |
| `messages` | `user_id` | Chat history |
| `audit_log` | `user_id` | Audit list |
| `sources` | `user_id, is_deleted` | Source list |

### Recommended (not present)
| Collection | Index | Purpose |
|---|---|---|
| `goals` | `(user_id, status)` | Filter active goals without full scan |
| `goals` | `(user_id, created_at)` | Matches sort in `load_state` |
| `commitments` | `(user_id, status)` | Filter open commitments |
| `milestones` | `(user_id, goal_id)` | Per-goal milestone lookup |
| `audit_log` | `(user_id, created_at DESC)` | List view (newest first) |
| `sources` | `(user_id, goal_id, is_deleted)` | Per-goal source list |

---

## 3. Relationships

```
users (1) ─── (N) user_sessions     [session.user_id → users.user_id]
users (1) ─── (N) goals             [goal.user_id → users.user_id]
users (1) ─── (N) commitments       [commit.user_id → users.user_id]
users (1) ─── (N) milestones        [milestone.user_id → users.user_id]
users (1) ─── (N) blockers          [blocker.user_id → users.user_id]
users (1) ─── (N) messages          [message.user_id → users.user_id]
users (1) ─── (N) audit_log         [audit.user_id → users.user_id]
users (1) ─── (N) sources           [source.user_id → users.user_id]

goals (1) ─── (N) milestones        [milestone.goal_id → goals.id]
goals (1) ─── (N) commitments       [commitment.goal_id → goals.id]
goals (1) ─── (N) sources           [source.goal_id → goals.id]

messages ─── proposals (embedded array of {id, action, status, result})
```

**No MongoDB `$lookup` joins.** All joins are done in application code (Python) by loading related collections and joining in memory.

---

## 4. Estimated Document Count / Size

| Collection | Estimated Count | Notes |
|---|---|---|
| `users` | tens–hundreds | Small; 1 per registered user + 1 per guest |
| `user_sessions` | ~same as users | 1 per user + 1 per active guest |
| `goals` | 5–50 per user | Core domain object |
| `commitments` | 1–20 per user | Small |
| `milestones` | 2–10 per goal | Small |
| `blockers` | 0–10 per user | Small |
| `messages` | Largest — grows with conversation length | 2 msgs per chat round-trip |
| `audit_log` | O(tool confirmations) | Moderate |
| `sources` | 0–20 per user | Small |

**Size:** `messages` dominates. A user with 5000 messages × ~500 bytes/msg ≈ 2.5 MB. Most users are far smaller.

---

## 5. Migration Complexity

### `users` — LOW complexity
- Straight copy. Fields map 1:1.
- Guest accounts (`is_guest: True`) should be preserved or discarded depending on policy.
- `email: None` for guests — unique index needs handling.

### `user_sessions` — LOW complexity
- Straight copy. One document per session.
- `expires_at` is stored as ISO string; confirm target DB handles this format.

### `goals` — LOW complexity
- Straight copy. All fields map directly.
- No nested objects; no transformation needed.
- `(user_id, status)` and `(user_id, created_at)` indexes should be created post-migration.

### `commitments` — LOW complexity
- Straight copy.
- `(user_id, status)` index recommended.

### `milestones` — LOW complexity
- Straight copy.
- `(user_id, goal_id)` index recommended.

### `blockers` — LOW complexity
- Straight copy.
- No special handling.

### `messages` — MEDIUM complexity
- Straight copy structurally, but large volume.
- `proposals` array contains embedded dicts — confirm target DB handles arbitrary-shape embedded documents.
- Index on `(user_id, created_at)` is critical for chat history query performance post-migration.
- Consider chunked export/import for users with >10,000 messages.

### `audit_log` — LOW complexity
- Straight copy.
- `(user_id, created_at DESC)` index needed for list view.

### `sources` — MEDIUM complexity
- Straight copy structurally.
- `storage_path` references external object store (Emergent Integrations proxy) — no file migration needed.
- Soft-delete (`is_deleted`) is a boolean — copy as-is.
- `text_excerpt` can be large (up to 8000 chars); confirm field size limits.
- `(user_id, goal_id, is_deleted)` composite index recommended.

### Guest → Account Migration (handled in-app)
The `POST /api/auth/session` handler migrates guest data by reassigning `user_id` on all collections:

```python
for coll in ["goals", "commitments", "milestones", "blockers", "messages", "audit_log", "sources"]:
    await db[coll].update_many({"user_id": gid}, {"$set": {"user_id": user_id}})
await db.users.delete_one({"user_id": gid, "is_guest": True})
await db.user_sessions.delete_many({"user_id": gid})
```

This is an in-app migration, not a DB-level migration. It confirms all collections share the same `user_id` reassignment pattern.

---

## 6. Summary

GoalCoach uses a flat, denormalized schema with 9 MongoDB collections. There are no document references (`$lookup`) — all relationships are joined in Python by `user_id`. The schema is simple and迁移-friendly: every collection is a straight copy except `messages` (high volume) and `sources` (large text field). No collection-level transformations required. Index coverage is minimal — several composite indexes should be added post-migration for query performance, particularly on `(user_id, created_at)` for messages and audit_log, and `(user_id, status)` for goals and commitments.
