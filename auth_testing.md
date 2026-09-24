# Auth-Gated App Testing Playbook (Emergent Google OAuth + Postgres)

> **Replaces the legacy mongosh playbook.** The backend is now Next.js 16 +
> Drizzle + Postgres (Neon). MongoDB collections (`test_database.users`,
> `test_database.user_sessions`) no longer exist — use `psql` against the
> Postgres URL in `api/.env` instead.

## Auth model recap

- **Real users**: Google sign-in via Emergent OAuth → `POST /api/auth/session`
  exchanges a `session_id` for an HttpOnly `session_token` cookie
  (7-day lifetime). The cookie value is stored in the `user_sessions`
  Postgres table, linked to `users.id` via `user_id`.
- **Guests**: `POST /api/auth/guest` creates a `users` row with
  `is_guest = true` and sets an HttpOnly `guest_token` cookie (HMAC-signed
  via `AUTH_SECRET`, **10-minute TTL** — locked architecture decision #3).
- **Bare-bearer fallback** (test/dev only): route handlers in
  `api/lib/auth-route.ts` accept `Authorization: Bearer <user_id>` and
  treat the token as the `userId` directly. Useful for fast curl tests
  where you don't want to seed the DB — but does NOT exercise the cookie
  path. See `auth-route.ts:60-72` for the exact behaviour.

The Drizzle schema lives in `api/db/schema.ts`; the Auth.js v5 tables
(`accounts`, `sessions`, `verificationTokens`) exist for adapter
compatibility but the live session lookup goes through `user_sessions`
(via raw SQL in `lib/auth.ts`).

---

## Step 1 — Choose a test user

Pick a stable, recognizable id so you can re-find the row across runs:

```
USER_ID="user_test_$(date +%s)"
SESSION_TOKEN="test_session_$(date +%s)"
EXPIRES_AT="$(date -u -d '+7 days' '+%Y-%m-%d %H:%M:%S+00')"
```

Substitute these into every step below.

## Step 2 — Seed the user + session (Postgres via `psql`)

Get the connection string from `api/.env` (`DATABASE_URL_UNPOOLED` —
the unpooled URL is what `psql` should use):

```bash
export PGPASSWORD='...'   # or include in the URL
export DB_URL=$(grep -E '^DATABASE_URL_UNPOOLED=' api/.env | cut -d= -f2-)
```

Run:

```sql
INSERT INTO users (id, email, name, image, model_provider, is_guest)
VALUES ('user_test_<ts>', 'test.user.<ts>@example.com', 'Test User',
        'https://via.placeholder.com/150', 'gemini', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_sessions (session_token, user_id, expires_at, created_at)
VALUES ('test_session_<ts>', 'user_test_<ts>',
        NOW() + INTERVAL '7 days', NOW())
ON CONFLICT (session_token) DO UPDATE
  SET user_id   = EXCLUDED.user_id,
      expires_at = EXCLUDED.expires_at;
```

The `user_sessions` table is **not** in `api/db/schema.ts` (it's a
runtime-managed table that the Python collection was retired in
favour of — see `api/lib/auth.ts` for the raw-SQL upsert). It's
created lazily by the running app on first sign-in; if it doesn't
exist yet, `CREATE TABLE` it by hitting `POST /api/auth/session` once
with any Emergent-issued `session_id`, or run:

```sql
CREATE TABLE IF NOT EXISTS user_sessions (
  session_token TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Step 3 — Hit the backend API

Pick the approach that matches what you're testing:

```bash
URL="$REACT_APP_BACKEND_URL"   # typically http://localhost:3001 or http://localhost:3000

# (a) Cookie path — exercises real auth flow.
curl -sS "$URL/api/auth/me" \
  -H "Cookie: session_token=$SESSION_TOKEN"

# (b) Bearer path — fast, but skips the cookie lookup.
#     Use for "does this route work for this user?" smoke tests only.
curl -sS "$URL/api/state" \
  -H "Authorization: Bearer $USER_ID"

# (c) Full happy-path check — `/api/state` returns 200 with goals[].
curl -sS "$URL/api/state" \
  -H "Cookie: session_token=$SESSION_TOKEN"
```

Expected shapes (snake_case keys — preserved from the legacy FastAPI
contract so the frontend `api.me()` / `useState(d)` keep working):

- `GET /api/auth/me` → `200 { user_id, email, name, image, model_provider, is_guest }`
- `GET /api/state`   → `200 { goals: [...], commitments: [...], milestones: [...], blockers: [...], ... }`

## Step 4 — Browser testing (Playwright)

```js
await page.context.addCookies([{
  name: 'session_token',
  value: 'test_session_<ts>',
  domain: 'localhost',       // or your-app.com
  path: '/',
  httpOnly: true,
  secure: false,             // true in production
  sameSite: 'Lax',
}])
await page.goto('http://localhost:3000/coach')   // CRA dev server
```

If you're testing the guest flow instead, mint a `guest_token` via
`POST /api/auth/guest` (the response sets the cookie directly), or
sign one yourself with `AUTH_SECRET` from `api/.env` (see
`api/lib/guest-token.ts`).

## Notes / gotchas

- **No passwords.** Auth is Emergent-only; you cannot seed a "real"
  user without going through the Emergent OAuth handshake. For local
  testing, the Bearer path (3b) is fine — it bypasses the cookie
  lookup entirely.
- **Snake_case keys.** Responses use `user_id`, `model_provider`,
  `is_guest` (not `userId` / `modelProvider` / `isGuest`). This is
  preserved from the FastAPI contract; don't "fix" it without also
  updating the frontend.
- **Guest TTL is 10 minutes.** A signed guest cookie older than that
  is treated as stale by `verifyGuestToken()` and the request falls
  through to 401. Re-mint before each test if you need long sessions.
- **`user_sessions` is NOT in `db/schema.ts`.** It's a runtime table
  managed by `lib/auth.ts` via raw SQL. Don't add it to the Drizzle
  schema unless you also migrate every read/write — it would change
  the SQL surface.
- **Migration parity.** If you need to reproduce a real Emergent
  sign-in, the `api/lib/emergent/auth.ts` `exchangeSessionId()` calls
  `https://integrations.emergentagent.com` — you need a valid Emergent
  `session_id` to get a real cookie. For everything else, the Bearer
  path is faster.