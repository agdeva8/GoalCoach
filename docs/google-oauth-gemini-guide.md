# Sign in with Google → user-pays Gemini API

**Reference guide for OAuth-based Gemini API access in Sutra.**

> Complements `docs/plans/2026-09-22-gemini-oauth-swap.md` (the active implementation plan). This doc is the *why* and the *reference* — read it once to understand the flow; refer back to it when wiring new code.

---

## TL;DR

Google's OAuth flow lets each end-user grant Sutra permission to call the Gemini API **on their behalf**, billed against **their** Google account/quota (typically free tier). When a user has `users.llm_provider = 'gemini-oauth'`, the `@sutra/llm` factory uses **their** Google access/refresh tokens instead of the server's API key.

This is the only major LLM that supports a true "Sign in with X" per-user flow today (Anthropic: API keys only; OpenAI: ChatGPT OAuth doesn't grant API access).

---

## Status check — is it deprecated?

**No, OAuth is not deprecated.** Google has, however, split API keys into two tiers, and that's where the real change is:

| Method | Status as of Sep 2026 |
|--------|----------------------|
| Standard API key (unrestricted) | Already rejected by Gemini API |
| Standard API key (with restrictions) | Still works |
| **Auth API key** (bound to GCP service account) | **Required after Sept 2026** — new keys default to this since May 28, 2026 |
| OAuth with Google Account | Still supported; pick when you need per-user access |

**Which should you use?**

- **API key (auth-tier)** → simplest path, server-to-server, no per-user identity. Default for most apps.
- **OAuth** → when you need per-user quotas/audit, fine-grained access control, or on-behalf-of-end-user flows.

Sutra chat uses OAuth so the user pays (free tier) instead of us paying the $5 Anthropic credit.

---

## Required OAuth scopes

The Gemini API endpoints accept tokens with these scopes:

```
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/generative-language.retriever
```

Plus identity scopes if you also want basic profile info:

```
openid
email
profile
```

Request only what you need — adding more triggers a wider Google security review.

---

## Architecture overview

```
┌──────────────┐    ① click "Sign in with Google"    ┌──────────────────────┐
│  Browser UI  │ ──────────────────────────────────► │ /api/auth/google/start │
└──────────────┘                                     └────────┬─────────────┘
       ▲ │ 302 │ ② Google consent screen
       │ ┌──────────────────────┐
       │ │                                          │  Google OAuth        │
       │ │                                          │  consent screen      │
       │ │                                          └────────┬─────────────┘
       │④ redirect back │ ③ user approves
       ▼ ▼
┌──────────────┐    ⑤ code in URL ┌────────────────────────────────────────┐
│  Browser UI  │ ◄───────────────── │ /api/auth/google/callback?code=...      │
└──────────────┘                    └────────┬───────────────────────────────┘
                                            │ ⑥ exchange code → tokens
                                            ▼
                                   ┌─────────────────────┐
                                   │ users table         │
                                   │   gemini_access     │  (encrypted)
                                   │   gemini_refresh    │  (encrypted)
                                   │   gemini_expires_at │
                                   │   llm_provider      │
                                   │   gemini_scopes     │
                                   └─────────────────────┘
```

---

## Implementation

### ① — Start OAuth

```ts
// apps/web/src/pages/api/auth/google/start.ts
import type { APIRoute } from 'astro';
import { google } from 'googleapis';

export const GET: APIRoute = async ({ url, locals }) => {
  const user = locals.user; // your auth middleware
  if (!user) return new Response('Sign in first', { status: 401 });

  const oauth2 = new google.auth.OAuth2(
    import.meta.env.GOOGLE_OAUTH_CLIENT_ID,
    import.meta.env.GOOGLE_OAUTH_CLIENT_SECRET,
    `${url.origin}/api/auth/google/callback`
  );

  const url2 = oauth2.generateAuthUrl({
    access_type: 'offline',     // ⭐ required to get refresh_token
    prompt: 'consent',          // ⭐ forces refresh_token on re-auth
    scope: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/generative-language.retriever',
      'openid',
      'email',
      'profile',
    ],
    state: signState(user.id),  // CSRF protection
  });

  return Response.redirect(url2, 302);
};
```

> ⚠️ **Critical:** `access_type: 'offline'` + `prompt: 'consent'` is the only way to get a `refresh_token`. Google's default `prompt: 'select_account'` will *not* return one for returning users and you'll silently lose token refresh.

### ② — Callback

```ts
// apps/web/src/pages/api/auth/google/callback.ts
import type { APIRoute } from 'astro';
import { google } from 'googleapis';
import { db } from '@/lib/db';

export const GET: APIRoute = async ({ url, locals }) => {
  const { code, state, error } = Object.fromEntries(url.searchParams);
  if (error) return new Response(`Google: ${error}`, { status: 400 });
  if (!verifyState(state, locals.user?.id)) {
    return new Response('Bad state', { status: 400 });
  }

  const oauth2 = new google.auth.OAuth2(
    import.meta.env.GOOGLE_OAUTH_CLIENT_ID,
    import.meta.env.GOOGLE_OAUTH_CLIENT_SECRET,
    `${url.origin}/api/auth/google/callback`
  );

  const { tokens } = await oauth2.getToken(code); // exchange code → tokens

  await db.user.update({
    where: { id: locals.user.id },
    data: {
      llm_provider: 'gemini-oauth',
      gemini_access_token:  encrypt(tokens.access_token),
      gemini_refresh_token: encrypt(tokens.refresh_token), // null on re-auth w/o prompt=consent!
      gemini_token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      gemini_scopes: tokens.scope,
    },
  });

  return Response.redirect('/settings/connected', 302);
};
```

### ③ — Token refresh helper

```ts
// packages/llm/src/google-refresh.ts
import { google } from 'googleapis';
import { decrypt, encrypt } from '@/lib/crypto';

export async function getValidGoogleTokens(userId: string, db: Db) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.llm_provider !== 'gemini-oauth') throw new Error('not-google-oauth');

  // Refresh 5 min early to avoid races
  if (
    u.gemini_token_expires_at &&
    u.gemini_token_expires_at.getTime() > Date.now() + 5 * 60_000
  ) {
    return decrypt(u.gemini_access_token);
  }
  if (!u.gemini_refresh_token) throw new Error('NO_REFRESH_TOKEN_REAUTH_REQUIRED');

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: decrypt(u.gemini_refresh_token) });

  const { credentials } = await oauth2.refreshAccessToken();
  await db.user.update({
    where: { id: userId },
    data: {
      gemini_access_token: encrypt(credentials.access_token!),
      gemini_token_expires_at: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : null,
      // refresh_token is NOT returned on refresh; keep the old one
    },
  });
  return credentials.access_token!;
}
```

### ④ — Wire into `@sutra/llm` factory

```ts
// packages/llm/src/factory.ts — sketch of the patch
import { getValidGoogleTokens } from './google-refresh';

export async function getLlmClient(opts: { userId: string; db: Db }) {
  const user = await opts.db.user.findUniqueOrThrow({ where: { id: opts.userId } });

  if (user.llm_provider === 'gemini-oauth') {
    const accessToken = await getValidGoogleTokens(opts.userId, opts.db);
    // google-auth-library or REST:
    //   The REST endpoint accepts `Authorization: Bearer <oauth-access-token>`
    //   The @google/genai SDK accepts the same via `googleAuthOptions`.
    return wrapGeminiClient({ accessToken });
  }

  // existing fallback path (server-side key, other providers, etc.)
  // ...
}
```

### ⑤ — UI: "Connect Google" button

```tsx
// apps/web/src/components/ConnectGoogleButton.tsx
export function ConnectGoogleButton() {
  return (
    <a href="/api/auth/google/start" className="btn-primary">
      <GoogleLogo /> Sign in with Google to use your Gemini API
    </a>
  );
}
```

Place it on `/settings/llm` next to the existing `llm_provider` admin flip.

---

## Google Cloud Console — one-time setup

1. **Enable the API** → [Google Generative Language API](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com) in your GCP project.
2. **OAuth consent screen** → External → add your email as a *test user* (only required while in "Testing" status; once you submit for verification, anyone can use it).
3. **Credentials → Create OAuth client ID** → Application type: **Web application** → Authorized redirect URIs:
   - `https://yourdomain.com/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback` (dev)
4. **Scopes:** request only the two listed above. Adding more triggers a wider security review.

---

## Test plan (TDD-first)

Write these **before** implementation:

| Test | Asserts |
|------|---------|
| `start.test.ts` | 302 to `accounts.google.com` with `access_type=offline` + `prompt=consent` + both scopes |
| `callback.test.ts` | given valid code → stores encrypted tokens + sets `llm_provider='gemini-oauth'` |
| `callback.test.ts` | invalid `state` → 400, no DB write |
| `callback.test.ts` | Google error (`error=access_denied`) → 400, no DB write |
| `google-refresh.test.ts` | expired token + refresh_token present → calls `refreshAccessToken`, persists new access token |
| `google-refresh.test.ts` | valid token within 5 min → returns cached, no network call |
| `google-refresh.test.ts` | missing refresh_token → throws `NO_REFRESH_TOKEN_REAUTH_REQUIRED` |
| `factory.test.ts` | user w/ `llm_provider='gemini-oauth'` + valid token → client uses user's token, **not** server key |
| `factory.test.ts` | OAuth user w/ expired token → factory triggers refresh transparently |

---

## Edge cases that bite people

- **Refresh token missing on re-auth.** Always send `prompt: 'consent'`. The first consent returns both access + refresh; subsequent consents need this flag or you silently lose the refresh token.
- **User revokes access on Google's side.** `refreshAccessToken()` will throw `invalid_grant`. Catch it, clear the tokens, set `llm_provider='server'`, show a banner: "Reconnect Google".
- **Quota exhaustion per user.** Free-tier limits are tight — that's *their* quota, not yours. Surface remaining quota in `/settings/llm` so users know what they're hitting.
- **Token encryption at rest.** `gemini_access_token` and `gemini_refresh_token` are bearer credentials. Encrypt with KMS / libsodium / age — never store plaintext. Use the same encryption helper you already use for other secrets.
- **Scope changes.** If you ever add a new scope, existing users won't have it. Detect via `gemini_scopes` field and prompt re-auth.
- **CSRF / state validation.** Always sign the OAuth `state` and verify on callback. Google won't validate it for you.

---

## "Sign in with X" comparison across LLM providers

| Provider | "Sign in with X" for end-users | What it grants |
|----------|-------------------------------|----------------|
| Google   | ✅ Yes — Google OAuth + Gemini API on-behalf-of-user | Per-user Gemini calls under user's Google identity |
| OpenAI   | ⚠️ Narrow — ChatGPT OAuth only for ChatGPT-data integrations | Access to user's ChatGPT data, **not** API calls under their key |
| Anthropic | ❌ No public OAuth for Claude API | N/A — API keys only; per-user auth via Bedrock/Vertex IAM |

So if you wanted to extend Sutra's chat-first model with "Sign in with your LLM provider," **Google is the only one that fully supports this pattern** for end-users today. For Claude/OpenAI, you'd proxy through a backend with per-user keys you manage yourself (which is what your `users.llm_provider` admin flip already sets up).

---

## Sources

- [Authentication with OAuth | Gemini API](https://ai.google.dev/gemini-api/docs/oauth) — official OAuth guide
- [Gemini API docs](https://ai.google.dev/gemini-api/docs) — landing
- [Gemini API key auth (standard vs auth keys)](https://ai.google.dev/gemini-api/docs/api-key) — key-tier changes
- [Workspace auth overview](https://developers.google.com/workspace/guides/auth-overview) — production OAuth reference
- [Workspace create-credentials guide](https://developers.google.com/workspace/guides/create-credentials#choose_the_access_credential_that_is_right_for_you) — credential type selection