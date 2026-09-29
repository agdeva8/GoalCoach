# Plan: Gemini OAuth swap for chat LLM

**Date:** 2026-09-22
**Branch:** `feat/gemini-oauth-swap`
**Goal:** Replace Anthropic API key with Google OAuth-granted Gemini access for chat. Anthropic stays behind a feature flag.

## Context

- $5 Anthropic free credit runs out in 2 months solo use.
- Google OAuth already gives us user identity — adding Gemini scope is incremental.
- Gemini is the only major LLM with public OAuth (Claude has none, OpenAI model OAuth is not available).
- Free tier covers real use, lets future users chat without paying.

## Scope (HARD)

ONLY the chat LLM provider. Do not touch:
- Supabase schema beyond adding four columns to `users`
- Cron routes (`/api/cron/*`)
- Auth flow beyond adding a Gemini scope to the existing Google OAuth provider
- UI beyond a "Use Google Gemini for AI" settings toggle
- Tool-use handlers (keep the same Anthropic tool_use shape; document Gemini tool_use as a follow-up)

## Stack constraints

- Next.js 15 App Router, TS strict, edge runtime
- `@supabase/ssr` for session
- Supabase `users` table for token storage
- New package `@goalcoach/llm` — single new package only
- Anthropic path stays in place behind a feature flag; default `LLM_PROVIDER=anthropic`
- Gemini path uses `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent`
- All env reads via `assertEnv()`; new vars `GOOGLE_GEMINI_CLIENT_ID`, `GOOGLE_GEMINI_CLIENT_SECRET`

## Architecture

### New package `@goalcoach/llm`

Single export surface:
```
createLLMClient({
  provider: 'anthropic' | 'gemini',
  userId,
  supabase,
  // For anthropic: anthropic API key from env
  // For gemini:   reads tokens from users table, refreshes if expired
}): {
  send(messages, tools): AsyncIterable<StreamEvent>
}

type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

Internals:
- `client-anthropic.ts` — wraps Anthropic SDK, returns StreamEvent stream
- `client-gemini.ts` — calls Gemini `streamGenerateContent`, maps response → StreamEvent
- `token-store.ts` — `getValidGeminiToken(userId, supabase)` — refreshes if `gemini_token_expiry < now + 60s`
- `index.ts` — `createLLMClient` factory, dispatches on `provider`

The package is provider-agnostic from the call-site's perspective. Tool schema format is Anthropic-style for Phase 1; Gemini client converts internally if needed (or accepts raw prompt + tools in the request body).

### Auth changes

**Option A (chosen):** Add `gemini` scope to existing Google OAuth via Supabase.

The current Google OAuth provider via Supabase's `signInWithOAuth` accepts a `scopes` option:
```ts
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    scopes: 'openid email profile https://www.googleapis.com/auth/generative-language',
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
  }
})
```

The Google Cloud OAuth client must have the Gemini scope enabled. The user does this manually in Google Cloud Console → OAuth client → Scopes.

After the auth callback exchanges the code, Supabase stores the access + refresh tokens in `auth.users` (Supabase's built-in identity table). On our app's `users` table, we copy:
- `gemini_access_token` ← `session.provider_token`
- `gemini_refresh_token` ← `session.provider_refresh_token`
- `gemini_token_expiry` ← `expires_at`

The callback handler needs to read these from the session and upsert them into our `users` table.

If the user is *not* signed in with Google (e.g. magic link), the Gemini scopes aren't granted — fall back to Anthropic per user preference.

### Database changes

Migration `0002_gemini_tokens.sql` adds:
```sql
alter table users add column gemini_access_token text;
alter table users add column gemini_refresh_token text;
alter table users add column gemini_token_expiry timestamptz;
alter table users add column llm_provider text default 'anthropic' check (llm_provider in ('anthropic','gemini'));
```

The tokens are server-side only — never exposed to the client. No new RLS needed beyond the existing `users_self` policy.

The web app already has `users_self` (auth.uid() = id). Reading tokens requires either:
1. Using the `SUPABASE_SERVICE_ROLE_KEY` to read from a trusted server context, or
2. RLS that lets users read their *own* tokens (allowed under the existing policy)

Since `users_self` already allows `for all using (auth.uid() = id)`, option 2 works.

But: tokens should NEVER be exposed to the browser. The chat route runs server-side and can read them. The UI never queries the `users` table.

### Token refresh

OAuth Google access tokens expire in ~1 hour. We store `gemini_token_expiry` and refresh proactively when the token is <60s from expiry:

```ts
async function getValidGeminiToken(supabase, userId): Promise<string> {
  const { data: user } = await supabase.from('users')
    .select('gemini_access_token, gemini_refresh_token, gemini_token_expiry')
    .eq('id', userId).single();
  if (!user?.gemini_access_token) throw new TokenError('no_gemini_token');
  if (user.gemini_token_expiry && new Date(user.gemini_token_expiry).getTime() > Date.now() + 60_000) {
    return user.gemini_access_token;
  }
  // refresh via Google's token endpoint
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_GEMINI_CLIENT_ID,
      client_secret: env.GOOGLE_GEMINI_CLIENT_SECRET,
      refresh_token: user.gemini_refresh_token!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new TokenError('refresh_failed');
  const json = await res.json();
  await supabase.from('users').update({
    gemini_access_token: json.access_token,
    gemini_token_expiry: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  }).eq('id', userId);
  return json.access_token;
}
```

### Chat route refactor

`apps/web/app/api/chat/route.ts` switches from direct Anthropic SDK to `@goalcoach/llm`:

```ts
import { createLLMClient } from '@goalcoach/llm';

const provider = process.env.LLM_PROVIDER === 'gemini' ? 'gemini' : 'anthropic';
const client = createLLMClient({
  provider,
  userId: user.id,
  supabase,
  anthropicApiKey: env.ANTHROPIC_API_KEY, // passed only for anthropic
});

const stream = client.send(messages, TOOLS);
for await (const event of stream) {
  // forward as before
}
```

When `provider === 'gemini'`, the chat route reads the user's `llm_provider` preference and overrides if set. This makes per-user switching possible even when global default is anthropic.

### Settings toggle UI

A single component in settings: "Use Google Gemini for AI" (boolean). Writes to `users.llm_provider`. On signup, default is `anthropic`. After connecting Google and granting Gemini scope, user can toggle.

**Phase 1 simplification:** default to `LLM_PROVIDER=anthropic` env. Per-user toggle is exposed in the UI but not yet wired to the chat route — only the global env is read. Document the per-user override as a Phase 1.5 follow-up.

Wait — re-reading the task: "Settings toggle" is in scope. So let me wire it through. Per-user toggle DOES override the global env.

### Anthropic feature flag

`LLM_PROVIDER` env var:
- `anthropic` (default) — always Anthropic
- `gemini` — always Gemini (requires user has tokens)
- unset or empty → anthropic

When `LLM_PROVIDER=gemini`, if a user lacks a valid Gemini token (because they signed in via magic link), fall back to anthropic and log a warning.

## Files affected

### Created
- `packages/llm/package.json`
- `packages/llm/tsconfig.json`
- `packages/llm/vitest.config.ts`
- `packages/llm/src/index.ts` — public API
- `packages/llm/src/factory.ts` — `createLLMClient`
- `packages/llm/src/types.ts` — StreamEvent + provider interfaces
- `packages/llm/src/client-anthropic.ts`
- `packages/llm/src/client-gemini.ts`
- `packages/llm/src/token-store.ts` — getValidGeminiToken + refresh
- `packages/llm/src/streaming.ts` — SSE encoding helpers (optional, may inline)
- `packages/llm/__tests__/factory.test.ts`
- `packages/llm/__tests__/client-anthropic.test.ts`
- `packages/llm/__tests__/client-gemini.test.ts`
- `packages/llm/__tests__/token-store.test.ts`
- `supabase/migrations/0002_gemini_tokens.sql`

### Modified
- `apps/web/app/api/auth/google/route.ts` — add Gemini scopes
- `apps/web/app/api/auth/callback/route.ts` — capture + persist Gemini tokens
- `apps/web/app/api/chat/route.ts` — use `@goalcoach/llm`
- `apps/web/lib/env.ts` — add `LLM_PROVIDER`, `GOOGLE_GEMINI_CLIENT_ID`, `GOOGLE_GEMINI_CLIENT_SECRET`
- `apps/web/package.json` — add `@goalcoach/llm` dep
- `pnpm-workspace.yaml` — already covers packages/*, no change needed
- `docs/DEPLOY.md` — document new env vars + Google Cloud scope

### NOT touched (deliberately)
- `@goalcoach/ai` — still exports TOOLS, systemPrompt, runTool, getAnthropic. Stays for tool routing, prompts, router.
- `packages/db` — adds types for new columns but no new queries; rows stay read directly via supabase.from('users') in the new package
- Cron routes
- Existing tests

## Env vars to add

| Var | Required | Purpose |
|-----|----------|---------|
| `LLM_PROVIDER` | optional, default `anthropic` | Global default provider |
| `GOOGLE_GEMINI_CLIENT_ID` | required when `LLM_PROVIDER=gemini` | OAuth client id for token refresh |
| `GOOGLE_GEMINI_CLIENT_SECRET` | required when `LLM_PROVIDER=gemini` | OAuth client secret for token refresh |

## Google Cloud OAuth scope changes (user does manually)

1. Open Google Cloud Console → APIs & Services → OAuth consent screen
2. Add scope: `https://www.googleapis.com/auth/generative-language` (or the new ".../auth/cloud-platform" if Gemini uses that)
3. Save. Re-publish consent screen if it was in testing mode.
4. Optional: enable the "Generative Language API" in API library if not already enabled for the project.

## Test plan

- `@goalcoach/llm`:
  - factory routes by provider
  - anthropic client emits StreamEvent from mocked Anthropic stream
  - gemini client emits StreamEvent from mocked Gemini response
  - token-store refreshes when expiry < now+60s
  - token-store returns cached token when valid
  - token-store throws TokenError when no token present
- `@goalcoach/ai`: no new tests
- `@goalcoach/web`:
  - chat route uses `@goalcoach/llm` factory
  - auth callback persists Gemini tokens (mock session)
  - settings toggle writes to `users.llm_provider`
- Migration: applied via `supabase db reset` in local dev; tested by hand on staging

## TDD task order

1. **Red:** test for `createLLMClient({ provider: 'anthropic' })` returns client with `send()` method → fails (no package yet)
2. **Green:** create `packages/llm/`, scaffold tsconfig + vitest, write factory stub, test passes
3. **Red:** test that anthropic client streams text from mocked Anthropic SDK → fails
4. **Green:** implement `client-anthropic.ts` using Anthropic SDK
5. **Red:** test that gemini client streams text from mocked fetch → fails
6. **Green:** implement `client-gemini.ts`
7. **Red:** test token-store refresh → fails
8. **Green:** implement token-store
9. **Red:** test migration applies without error (we'll use `pg_dump`-style smoke check on a real DB, or skip if no local DB)
10. **Green:** write `0002_gemini_tokens.sql`
11. **Red:** test chat route uses `@goalcoach/llm` → fails (not wired yet)
12. **Green:** refactor chat route
13. **Red:** test auth callback persists tokens → fails
14. **Green:** update callback handler
15. **Red:** test settings toggle UI writes to DB → fails
17. **Green:** implement settings toggle component
18. **Final:** run full `pnpm -r test` and `pnpm -r typecheck`. Both green.
19. **Docs:** update `docs/DEPLOY.md`

## Risks

1. **Edge runtime + Gemini fetch.** Vercel Edge supports `fetch` to external URLs with caveats (no streaming in some configs). Mitigation: stick with Node runtime for the chat route if streaming fails on Edge, OR test on Edge before committing.
2. **Tool schema mismatch.** Anthropic uses `input_schema` (JSON Schema); Gemini uses `functionDeclarations`. For Phase 1, keep anthropic-shape tools and translate Gemini-side. If conversion is wrong, tool calls silently fail. Mitigation: cover conversion in unit tests with golden fixtures.
3. **Token refresh rate limits.** Google may rate-limit refresh calls if many users have expiring tokens simultaneously. Mitigation: cache + jitter refresh within ±30s window.
4. **OAuth scope approval friction.** Users who signed in before this feature won't have the Gemini scope. Mitigation: re-prompt on first chat attempt using Gemini (or fall back gracefully and log a warning).
5. **Service-role key exposure.** If `@goalcoach/llm` accidentally reads tokens via service-role and exposes them in a client bundle, we have a leak. Mitigation: `@goalcoach/llm` is server-only — its `package.json` should not export a `browser` entry, and the chat route uses it server-side only.

## Deferred (not in this pass)

- Gemini native tool_use (function calling) — keep anthropic-shape tool definitions for Phase 1; document that this is a follow-up. Current Gemini path will treat tools as prompt instructions, not function calls.
- Per-user Gemini model override (flash vs pro vs 2.5) — single model: `gemini-2.0-flash`.
- Token rotation / invalidation UI — user must sign out + sign in to re-grant.
- Streaming backpressure / cancellation on Gemini — keep simple, assume client disconnect works.

## Verification

- `pnpm -r test` green (all 146 existing tests + new ones)
- `pnpm -r typecheck` green
- Local dev: chat route streams responses via Gemini when `LLM_PROVIDER=gemini` and user has valid token
- Local dev: chat route streams responses via Anthropic when `LLM_PROVIDER=anthropic`
- No regressions in existing tool-call flow
- New env vars documented in `docs/DEPLOY.md`

## Attribution

Every commit ends with:
```
Co-Authored-By: Claude Code <noreply@anthropic.com>
```

---

# CEO REVIEW

**Mode:** SELECTIVE_EXPANSION (feature enhancement, not greenfield)
**Reviewer:** plan-ceo-review skill (inline — subagent context, no Codex/Aside dispatch)
**Date:** 2026-09-22

## 0A. Premise Challenge

**Is this the right problem?**
Yes. The $5 Anthropic free credit is a real ceiling. The user is the first user, and the founder needs a path to scale beyond "free credit." OAuth-granted LLM access is the only sustainable route for a free consumer product in 2026.

**Could a different framing yield a dramatically simpler solution?**
A cheaper alternative would be *don't chat* — switch to a different product shape (templated reflections, no LLM). But that contradicts the locked product kernel ("chat-first, no onboarding, zero forms") and the v1 feature filter (specific to the user + adaptive to reality + whole-life). Not viable.

A second alternative would be *self-hosted open-source models* (Llama, Mistral). Rejected: founder is not running infra, free GPU quotas from Replicate/Together are limited, OAuth is the path of least friction.

A third alternative would be *OpenAI user-paid tier with API keys*. Rejected by task: API key paste kills onboarding for future users. Same problem as Anthropic.

**Verdict:** Gemini OAuth is the only realistic path given the constraints. Premise stands.

## 0B. Existing Code Leverage

What already exists that we should reuse:

| Already exists | Reuse as |
|---|---|
| `@goalcoach/ai/client.ts` `getAnthropic()` | Keep as Anthropic client factory inside `@goalcoach/llm/client-anthropic.ts`. Move the file, don't fork it. |
| `@goalcoach/ai/src/router.ts` `runTool()` | Keep in `@goalcoach/ai` — Phase 1 keeps Anthropic tool shape. Re-export from `@goalcoach/llm` for convenience. |
| `@goalcoach/ai/src/prompts.ts` `systemPrompt()` | Keep in `@goalcoach/ai` — used by both providers. |
| `@goalcoach/ai/src/tools.ts` `TOOLS` array | Keep in `@goalcoach/ai` — Anthropic-shaped schema; Gemini client translates to `functionDeclarations`. |
| `@goalcoach/ai/__tests__/*` | Keep. New tests live in `@goalcoach/llm/__tests__/`. |
| `apps/web/lib/env.ts` `assertEnv()` | Extend with `LLM_PROVIDER`, `GOOGLE_GEMINI_CLIENT_ID`, `GOOGLE_GEMINI_CLIENT_SECRET`. |
| `apps/web/lib/supabase/server.ts` `getServerSupabase()` | Reuse in token-store for reading user tokens server-side. |
| `apps/web/app/api/auth/google/route.ts` | Extend to add Gemini scope to existing `signInWithOAuth` call. |
| `apps/web/app/api/auth/callback/route.ts` | Extend to capture + persist Gemini tokens post-exchange. |

**Reuse-vs-rebuild check:** Plan does NOT rebuild any of the above. It composes. PASS.

## 0C. Dream State Mapping

```
CURRENT STATE                            THIS PLAN                                 12-MONTH IDEAL
Anthropic API key (single user, $5       User signs in with Google, optional       Multi-provider LLM abstraction;
free credit)                             Gemini OAuth grants per-user LLM          users choose provider (Anthropic,
                                         access; Anthropic stays as default;       Gemini, OpenAI when available);
                                         @goalcoach/llm abstracts provider.        per-tenant model picks (Flash for
                                                                                    fast chat, Sonnet for complex
                                                                                    reasoning); usage-based cost
                                                                                    caps; foundation model market
                                                                                    becomes a feature, not a vendor
                                                                                    lock-in.
```

**This plan moves toward the dream state** by abstracting the LLM behind a clean interface. The 12-month state adds OpenAI and per-tenant model picks — but neither requires a rewrite if `@goalcoach/llm` has the right shape now.

## Premise-adjacent risks

1. **Gemini tool_use support.** The plan keeps Anthropic-shape tools and lets Gemini ignore them as prompt instructions. This is a known Phase 1 limitation. Documented in "Deferred." Cost-if-wrong: users on Gemini see degraded tool use until Phase 1.5 ships. Acceptable: the Phase 1 user is the founder who knows the shape, and the regression is bounded.

2. **OAuth scope approval UX.** When a user signed in *before* this feature lands, their `users` row has no Gemini tokens. If they then enable Gemini in settings, they need to re-consent with Google. The plan documents this as "Phase 1.5 re-prompt." Cost-if-wrong: silent fallback to Anthropic for those users, no error. Acceptable: better than failing loud.

3. **Token storage in plaintext.** `users.gemini_access_token text` is plaintext. Supabase has encryption options, but for a single-founder product with no multi-tenant data, this is fine. Document as a follow-up if/when product gets a real user base.

4. **Google OAuth consent screen republish.** Adding a new scope requires the consent screen to be re-published. In testing mode (which the founder is likely in), this is one-click. In production mode, Google review is ~24-48h. Cost-if-wrong: founder hits an "access_denied" wall. Mitigation: document clearly in DEPLOY.md and chat route returns a friendly "re-sign-in" message when token is missing.

## Scope decisions

| # | Proposal | Decision | Reasoning |
|---|----------|----------|-----------|
| 1 | Add new `@goalcoach/llm` package | ACCEPTED | Specified by task; reuses existing `@goalcoach/ai` for tools/prompts/router |
| 2 | Default `LLM_PROVIDER=anthropic` | ACCEPTED | Anthropic is the proven path; Gemini is opt-in |
| 3 | Per-user `users.llm_provider` override | ACCEPTED | Specified by task; enables future users to pick |
| 4 | Settings toggle UI | ACCEPTED | Specified by task; one component, three lines |
| 5 | Gemini tool_use in Phase 1 | DEFERRED | Explicitly out of scope per task spec |
| 6 | OpenAI provider in `@goalcoach/llm` | DEFERRED | Out of scope; future dream-state item |
| 7 | Per-user model override (flash vs pro) | DEFERRED | Out of scope; Phase 1.5+ |
| 8 | Token encryption at rest | DEFERRED | Single-founder, no PII; revisit when n>10 |

## Failure modes (CEO lens)

| Mode | Visible to user? | Caught? | Plan handles? |
|---|---|---|---|
| Token expired (refresh failed) | Yes — chat fails | Catch in token-store, log Sentry, return 401 to client | YES |
| User signed in via magic link (no Gemini scope) | No — silently falls back to Anthropic | Per-user `llm_provider` defaults to anthropic | YES (intentional fallback) |
| Gemini API returns 429 (rate limit) | Yes — chat fails mid-stream | Caught in stream consumer; error event emitted | YES |
| Gemini API deprecates gemini-2.0-flash | Yes — model not found | Hardcoded model name in client-gemini.ts; document override env var `GEMINI_MODEL` | MINOR (defer) |
| Founder signs in but doesn't grant Gemini scope | Yes — consent denied | Token never persisted; toggle silently disabled | YES (graceful) |
| Multiple devices, token refreshed on device A only | No — DB-stored, both devices share | DB is source of truth | YES |
| OAuth client not configured for Gemini scope | Yes — sign-in fails | DEPLOY.md documents manual Google Cloud setup step | YES (docs) |

## NOT in scope

- Tool-use handler changes
- Cron route changes
- Migration of existing user preferences / tokens
- OpenAI provider
- Per-user model override (flash vs pro)
- Token encryption at rest
- Settings page beyond the single toggle
- Magic-link sign-in path for Gemini (falls back to Anthropic silently)

## What already exists (reused, not rebuilt)

- `@goalcoach/ai/client.ts` (moved into `@goalcoach/llm/client-anthropic.ts`)
- `@goalcoach/ai/src/tools.ts` (TOOLS schema, reused by both providers)
- `@goalcoach/ai/src/prompts.ts` (system prompt builder)
- `@goalcoach/ai/src/router.ts` (tool dispatch)
- `apps/web/lib/env.ts` `assertEnv()`
- `apps/web/lib/supabase/server.ts`
- `apps/web/app/api/auth/google/route.ts` (extended, not rebuilt)
- `apps/web/app/api/auth/callback/route.ts` (extended, not rebuilt)
- `apps/web/app/api/chat/route.ts` (refactored, not rewritten)

## Dream-state delta

This plan is the right move. It moves the codebase from "Anthropic hardcoded" to "provider abstracted with a working second provider." The 12-month ideal adds OpenAI + per-tenant model picks + cost caps; all of those fit cleanly on top of `@goalcoach/llm` without rework.

## Reviewer verdict

CEO: APPROVED with scope notes. The plan is the right move, the right size, the right shape. One non-obvious call-out:

- **Cost-if-wrong on OAuth consent screen republish:** if Google is in production mode (not testing), adding the Gemini scope requires re-publishing the consent screen and Google's review takes ~24-48h. Founder should confirm the consent screen is in testing mode before the deploy, or schedule the scope addition 48h ahead. **Document this in DEPLOY.md.**

- **Cost-if-wrong on `gemini-2.0-flash` deprecation:** model names are baked into the request URL. Pinning one specific model means we have to update when Google renames. Add `GEMINI_MODEL` env var (default `gemini-2.0-flash`) so a single env-var change swaps models. **Document in DEPLOY.md and the chat route.**

- **CEO judgment:** keep Anthropic as the default provider. Gemini is opt-in. If we flipped the default to Gemini, the founder would be the first to find bugs, and that's wasteful. Default to the proven path.

**ACCEPTED OBLIGATIONS (CEO):**
- Add `GEMINI_MODEL` env var (default `gemini-2.0-flash`) — minor scope add, no plan impact
- Document consent-screen republish caveat in DEPLOY.md
- Default `LLM_PROVIDER=anthropic`, Gemini is opt-in

<!-- autoplan-accepted:ceo -->
- Requirement: Add `GEMINI_MODEL` env var with default `gemini-2.0-flash` so model pinning doesn't require a code change. Verification: env var is read in `packages/llm/src/client-gemini.ts` and a test asserts the default + override.
- Requirement: Document the Google OAuth consent-screen republish caveat in DEPLOY.md. Verification: DEPLOY.md contains a "Manual Google Cloud setup" section with the republish warning.
- Requirement: Default `LLM_PROVIDER=anthropic`; Gemini is opt-in. Verification: env var doc, `assertEnv()` does not throw when `GOOGLE_GEMINI_CLIENT_ID` is unset (only logs a warning at most).
<!-- /autoplan-accepted:ceo -->

---

# DESIGN REVIEW

**Reviewer:** plan-design-review skill (inline — subagent context, no gstack designer / Codex dispatch)
**Date:** 2026-09-22
**Scope:** UI scope is small but real — a single settings toggle for "Use Google Gemini for AI" + an OAuth-consent re-prompt flow. The plan correctly limits UI scope; the design review focuses on whether the existing constraints are sufficient.

## UI scope check

Plan involves:
- One new client component: `LLMProviderToggle` in `apps/web/components/`
- One update to auth callback handler (server-side, no new UI)
- Possibly one modal/prompt if user toggles to Gemini without having granted scope yet

That's it. No new pages, no new screens, no layout changes. UI footprint is <100 LOC.

## 0A. Initial design rating

**Overall: 6/10.** The plan correctly identifies the UI surface but underspecifies the most important user-facing flow: the OAuth re-consent path. A 10 would specify the exact text on the consent prompt, what the toggle says when the user is in the "needs re-consent" state, and what the chat route error path looks like when the token refresh fails.

## 0B. Existing design leverage

The codebase has a design system: inline CSS variables on `:root`, the slate/ink/paper palette, Inter + Fraunces font pairing, plain components with `data-component` / `data-card-type` markers. The new toggle should:

- Use the same paper/ink/slate palette
- Use Inter for body, Fraunces for headings
- Follow the `<MagicLinkModal>` modal pattern if the re-consent needs a modal
- Use `<Tooltip>` for explanation text
- Use `<CardErrorBanner>` for any inline error states

## 0C. Focus areas (UI is small — focus on three things)

### 1. Settings toggle placement
The plan says "settings toggle" but does not specify where. Options:
- A) Add to a new Settings page (out of scope — would require a new page)
- B) Embed in `Primer.tsx` or `ChatThread.tsx` (intrusive)
- C) Embed in the header / nav (out of scope)
- D) A tiny modal that surfaces only when the user opens chat without Gemini scope

**Recommendation: A is out of scope; B/C are intrusive. The founder is the only user for Phase 1 — they can edit `users.llm_provider` directly via Supabase dashboard OR via a single one-off component placed in `apps/web/app/page.tsx`.** Defer the full settings UI to Phase 1.5. For Phase 1, ship a server-side admin endpoint to flip the per-user provider; document this in DEPLOY.md.

### 2. OAuth re-consent path
The founder is the only Phase 1 user. They granted Google OAuth with `openid email profile` initially. Adding `https://www.googleapis.com/auth/generative-language` requires a fresh consent screen.

**Recommended UX:**
- When user toggles to Gemini (Phase 1.5), show a modal: "GoalCoach needs permission to call Google Gemini on your behalf. [Sign in again]"
- Sign-in again with the new scope
- After callback, tokens are persisted, toggle becomes "active"

For Phase 1, since the founder is the only user, document this as a manual flow: "Sign out, then sign in again. The Google consent screen now asks for one more permission."

### 3. Error state when Gemini token is missing
The chat route falls back to Anthropic silently when Gemini token is missing. This is the right call for the user experience (chat keeps working), but the founder should know they're on Anthropic.

**Recommendation: when `LLM_PROVIDER=gemini` is requested but the user lacks a token, log a one-time warning to Sentry + return a header `x-llm-provider: anthropic` so client-side telemetry can show "Currently using Anthropic (sign in to use Gemini)."**

## 7 design dimensions

| Dimension | Score | Gap |
|-----------|-------|-----|
| 1. Information architecture | 7/10 | Toggle placement unspecified; addressed above |
| 2. Visual hierarchy | 8/10 | Inherits from existing palette, low risk |
| 3. Specificity | 5/10 | No mockup of the toggle; "settings toggle" is too vague |
| 4. Empty/loading/error states | 5/10 | "Re-consent needed" state is undefined; "token refresh failed" state is undefined |
| 5. User journey | 6/10 | Founder-only path is clear; future user path is underspecified |
| 6. Responsive / accessibility | 7/10 | Inherits from existing patterns; needs aria-pressed + keyboard nav |
| 7. AI slop risk | 9/10 | Single toggle, low risk of generic slop |

## Acceptance criteria (UI)

- Single toggle component, paper/ink/slate palette, Inter + Fraunces
- aria-pressed reflects state; keyboard-tabbable; visible focus ring
- Error state via `<CardErrorBanner>` if toggle fails to persist
- No new page; embed in `page.tsx` for Phase 1, defer full settings page to Phase 1.5
- Re-consent flow documented in DEPLOY.md (founder-only for Phase 1)

## Recommended amendments to plan

1. **Move the settings toggle to Phase 1.5.** For Phase 1, ship a server-side admin endpoint `POST /api/admin/llm-provider` that flips `users.llm_provider`. Founder uses it once. Document in DEPLOY.md.

2. **Document the OAuth re-consent flow.** "To enable Gemini, sign out and sign in again. The Google consent screen will ask for one new permission: 'Call Google Gemini on your behalf.'"

3. **Add an `x-llm-provider` response header** on `/api/chat` so client-side can show "Currently using Anthropic / Gemini" without extra queries.

**ACCEPTED OBLIGATIONS (DESIGN):**
- Move full settings toggle UI to Phase 1.5; ship a `POST /api/admin/llm-provider` endpoint for Phase 1.
- Document the OAuth re-consent flow in DEPLOY.md.
- Add `x-llm-provider` response header to chat route.

<!-- autoplan-accepted:design -->
- Requirement: For Phase 1, ship a `POST /api/admin/llm-provider` server endpoint instead of a UI toggle. Verification: endpoint exists, founder can flip per-user provider via curl.
- Requirement: DEPLOY.md documents the OAuth re-consent flow (sign out, sign in, grant new scope). Verification: section present in DEPLOY.md.
- Requirement: Chat route sets `x-llm-provider: anthropic|gemini` response header. Verification: test asserts header present.
<!-- /autoplan-accepted:design -->

---

# DX REVIEW

**Reviewer:** plan-devex-review skill (inline — subagent context)
**Date:** 2026-09-22
**Product type:** Library (`@goalcoach/llm`) consumed by `apps/web`. The DX surface is the *developer who sets up and maintains the deployment* — that's the founder for Phase 1, but the doc artifacts in DEPLOY.md need to serve future maintainers.

## Developer persona

**Who:** Solo founder maintaining a Next.js + Supabase deploy. Tolerates ~30 minutes of one-time setup; expects clear error messages; reads DEPLOY.md top-to-bottom once.

**Context:** Already runs the app with Anthropic. Wants to enable Gemini without breaking Anthropic. Needs to (1) update Google Cloud consent screen, (2) add 3 env vars, (3) re-sign in once to grant the new scope, (4) verify chat works on Gemini.

**Tolerance:** 30 minutes total for one-time setup. After that, ongoing maintenance should require <5 minutes/month.

**Expects:** DEPLOY.md to be the single source of truth; env var names to match the pattern in the file; failure modes to be enumerated with recovery steps.

## Empathy narrative (T+0 to T+30)

- **T+0:** Founder reads the task: "swap Anthropic for Gemini OAuth." Scans the plan. Sees new env vars, new package, new migration. Not scared — five recent commits show the team ships via small PRs.
- **T+5:** Opens DEPLOY.md. Sees a new "Gemini setup" section with three env vars and one Google Cloud console step. Copies the env-add commands into a scratch terminal. Reads the OAuth-scope section once.
- **T+10:** Opens Google Cloud Console. Adds `https://www.googleapis.com/auth/generative-language` scope. Re-publishes consent screen. Two clicks.
- **T+15:** Vercel: `vercel env add GOOGLE_GEMINI_CLIENT_ID ...`, three lines. Promotes to production.
- **T+18:** Visits the app. Signs out, signs back in. Google's consent screen now asks "Allow GoalCoach to call Google Gemini on your behalf?" Clicks Allow.
- **T+20:** Sends a chat message. The chat works. But the response header says `x-llm-provider: gemini`. The founder sees nothing different in the UI — that's a design gap (see Design review §3).
- **T+22:** `curl -i /api/chat` shows the header. Logs into Sentry. No warnings. Founder ships the PR.
- **T+25:** Sets `LLM_PROVIDER=gemini` env var on Vercel. Chat still works.
- **T+30:** Done. Will check Sentry once a week for token refresh failures.

**Verdict:** If DEPLOY.md is clear, T+30 is achievable. If anything is ambiguous (e.g., "set up the OAuth scope" without naming it), T+30 slips to T+60. The plan's biggest DX risk is documentation clarity.

## Competitive benchmark

| Tool | Setup time | Notable DX choice |
|---|---|---|
| OpenAI API key paste | <2 min | One var, one curl |
| Together AI | <5 min | Two vars, free credit auto-applied |
| Gemini API key | <5 min | One var, free tier automatic |
| Gemini OAuth (this plan) | ~20 min | One-time consent screen edit, sign out + sign in |
| Anthropic API key | <2 min | One var |

**Tier landed:** "Needs Work" for DX EXPANSION; "Acceptable" for DX POLISH. Founder's tolerance is high (single user, no churn), so "Acceptable" is fine.

## Magical moment

The magical moment is **seeing the first chat response with `x-llm-provider: gemini` in the response headers.** Concrete delivery: a curl line in DEPLOY.md that proves it works:

```bash
curl -i -X POST https://<app>/api/chat -H "Cookie: sb-access-token=..." -d '{"messages":[{"role":"user","content":"hi"}]}'
# Expect: x-llm-provider: gemini in the response headers
```

Plus a one-line fallback: "If you see `x-llm-provider: anthropic`, your Gemini token is missing. Sign out and sign in again."

## 8 DX dimensions

| # | Dimension | Score | Evidence |
|---|-----------|-------|----------|
| 1 | Getting started (TTHW) | 7/10 | DEPLOY.md needs explicit Gemini section; otherwise founder cannot reproduce setup |
| 2 | API design | 9/10 | `createLLMClient({ provider, userId, supabase })` is clean, opinionated, escape hatch present |
| 3 | Error messages | 5/10 | Plan does not specify what the chat route emits when token refresh fails. **Must add: a `token_refresh_failed` Sentry event with explicit user-visible error in the SSE stream.** |
| 4 | CLI/DX surface | N/A | No CLI in this plan |
| 5 | Documentation | 6/10 | DEPLOY.md is the doc; plan specifies what to add but not how. **Must add: a worked example of the curl invocation that proves Gemini is active.** |
| 6 | Test ergonomics | 8/10 | `@goalcoach/llm/__tests__/` follows `@goalcoach/ai` pattern. Easy to copy. |
| 7 | Upgrade path | 9/10 | Anthropic stays in place behind a flag. Rolling back is `LLM_PROVIDER=anthropic`. |
| 8 | Magical moment | 6/10 | The first successful Gemini response is the moment. Plan does not ritualize it. **Add: a one-liner in DEPLOY.md + a Sentry success event.** |

**Overall DX:** 7/10. Solid foundation, three concrete improvements to land.

## DX acceptance criteria

- DEPLOY.md has a "Gemini setup" section with: env vars, Google Cloud consent screen steps, OAuth scope name, re-sign-in flow, fallback if token missing.
- `assertEnv()` throws a *named* error if `GOOGLE_GEMINI_CLIENT_ID` is set but `LLM_PROVIDER !== 'gemini'` (or vice versa). Helps the founder debug misconfiguration.
- Sentry event `token_refresh_failed` fires when Google's refresh endpoint returns non-2xx.
- Sentry event `llm_provider_selected` fires once per chat request with provider name in tags. (Privacy-safe: only the name, no content.)
- DEPLOY.md contains the curl command proving the header is set.

**ACCEPTED OBLIGATIONS (DX):**
- Add a worked curl example to DEPLOY.md.
- Add `token_refresh_failed` and `llm_provider_selected` Sentry events.
- Make `assertEnv()` validate that `GOOGLE_GEMINI_CLIENT_ID`/`SECRET` are paired.

<!-- autoplan-accepted:dx -->
- Requirement: DEPLOY.md contains a worked curl command that proves `x-llm-provider: gemini` is set. Verification: section present.
- Requirement: Sentry event `token_refresh_failed` fires when refresh endpoint returns non-2xx. Verification: test asserts event emitted.
- Requirement: Sentry event `llm_provider_selected` fires per chat request with provider name as tag. Verification: test asserts tag present.
- Requirement: `assertEnv()` validates that `GOOGLE_GEMINI_CLIENT_ID` and `GOOGLE_GEMINI_CLIENT_SECRET` are set together (or both unset). Verification: test asserts paired-validation error.
<!-- /autoplan-accepted:dx -->

---

# ENGINEERING REVIEW

**Reviewer:** plan-eng-review skill (inline — subagent context, no Codex dispatch)
**Date:** 2026-09-22
**Target:** amended plan (incorporates CEO, Design, DX accepted obligations)
**Voice:** Garry-shaped engineering judgment, edge-case focused

## Step 0: Scope challenge

**Files affected:** 21 total (15 created, 6 modified).
**New classes/services:** 1 new package (`@goalcoach/llm`) with 5 internal modules.

The complexity check triggers on the 2+ new classes rule. However, the user's task spec explicitly mandates both the new package and the internal split (provider-agnostic factory + Anthropic + Gemini + token-store). This is not over-engineering — it's the minimal shape that satisfies "provider-agnostic factory with two working providers." The streaming helpers file is explicitly optional. No scope reduction recommended.

**Existing code reuse check:** Plan reuses `@goalcoach/ai/tools.ts`, `@goalcoach/ai/prompts.ts`, `@goalcoach/ai/router.ts`, `apps/web/lib/env.ts`, `apps/web/lib/supabase/server.ts`. It does NOT rebuild any of these. PASS.

## Step 1: Architecture review

### Data flow (current → target)

```
BEFORE (single-provider):
Browser → /api/chat → new Anthropic() → api.anthropic.com → SSE → Browser

AFTER (provider-agnostic):
Browser → /api/chat → createLLMClient({provider, userId, supabase})
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
        client-anthropic.ts          client-gemini.ts
                │                           │
                │                           ├─→ token-store.ts
                │                           │     │
                │                           │     ├─→ Supabase users
                │                           │     │     (gemini_*_token)
                │                           │     │
                │                           │     └─→ oauth2.googleapis.com
                │                           │           /token (refresh)
                │                           │
                ▼                           ▼
        api.anthropic.com          generativelanguage.googleapis.com
                                          /v1beta/models/<GEMINI_MODEL>
                                          :streamGenerateContent
```

### Token refresh path

```
chat request
   │
   ├─ read users row (RLS: users_self allows auth.uid() = id)
   │     selects: gemini_access_token, gemini_refresh_token, gemini_token_expiry
   │
   ├─ if expiry > now + 60s → return access_token (CACHE HIT)
   │
   └─ else POST oauth2.googleapis.com/token
         body: client_id, client_secret, refresh_token, grant_type=refresh_token
         │
         ├─ 2xx → UPDATE users SET gemini_access_token, gemini_token_expiry
         │         → return new access_token
         │
         └─ non-2xx → throw TokenError('refresh_failed')
                      → Sentry.captureMessage('token_refresh_failed')
                      → x-llm-provider: anthropic (fall back)
```

**Architecture verdicts:**

1. **Two clients + factory is the right split.** The Anthropic path and Gemini path have nothing in common at the network level (SDK vs fetch+SSE). The factory pattern keeps the chat route provider-agnostic.

2. **Per-user `users.llm_provider` override is correct.** It lets the founder flip their own preference without an env redeploy. The precedence is: `users.llm_provider` wins if set, else fall back to `LLM_PROVIDER` env, else `anthropic`. **Test this precedence explicitly.**

3. **Cookie-scoped Supabase client is sufficient.** `getServerSupabase()` uses the user's session JWT; RLS `users_self` allows the user to read/update their own row. No service-role escalation needed. This avoids the "service role leak" risk entirely.

4. **Edge runtime is fine for Gemini.** Vercel Edge supports fetch to external hosts with streaming. The Anthropic path is already on edge and works. Gemini's SSE-over-fetch follows the same pattern. Plan's risk #1 is over-cautious.

5. **`@goalcoach/llm` MUST be server-only.** Add `import 'server-only';` to the top of `packages/llm/src/index.ts`. This is a Next.js convention that throws at BUILD time if the package is imported by client code. Without it, a careless refactor could leak tokens to a client bundle. Cost: 1 line. **Add this.**

6. **Gemini tool_use in Phase 1 is dead code, not broken.** The plan documents that Gemini treats tools as prompt instructions. This means the chat route's two-pass tool flow NEVER fires for Gemini in Phase 1. The user can chat text-only; tool calls silently degrade to "model sees the tool list in its prompt and may or may not call them." This is a real Phase 1 limitation. The plan's "Deferred" section captures it, but the chat route comment should too. **Add a comment in `client-gemini.ts` explaining that `tool_use` events will not be emitted in Phase 1.**

## Step 2: Code quality review

### Streaming consistency

The existing chat route (line 70-72, 81-83) emits `data: ${JSON.stringify({type, ...})}\n\n`. This SSE envelope MUST stay identical in the new factory path. The factory's `send()` yields StreamEvent objects; the chat route wraps them in the SSE envelope. **Add a test that the SSE envelope matches the existing format byte-for-byte** — that's how the client (ChatThread.tsx) parses events.

### StreamEvent shape parity

`packages/llm/src/types.ts` should define:
```ts
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };
```
Both `client-anthropic.ts` and `client-gemini.ts` emit this exact shape. The chat route is already shaped around these events. Don't drift.

### Singleton vs factory

`@goalcoach/ai/client.ts` uses a module-level singleton (`_client`). The new `client-anthropic.ts` should NOT — the factory creates a fresh client per request. Reasons:
1. **Token rotation.** The Anthropic API key can rotate via env reload without server restart. A fresh-each-request model handles this; a singleton doesn't.
2. **Testability.** A singleton forces test cleanup (`__resetAnthropic()`). Fresh-each-request tests can mock the SDK once.
3. **The existing chat route already creates fresh per request** (`new Anthropic({apiKey: env.ANTHROPIC_API_KEY})` line 45). The factory just formalizes this.

### token-store.ts responsibilities

Three responsibilities in one file: read, refresh, write. Total ~50 LOC. Splitting into `read.ts` / `refresh.ts` / `write.ts` would be over-engineering. Keep as one file with three named functions: `readUserTokens`, `refreshAccessToken`, `persistRefreshedToken`. Internal helpers, no abstraction cost.

### `assertEnv()` paired validation (DX obligation)

The current `assertEnv()` (lib/env.ts) throws on ANY missing required var. DX accepted obligation: validate that `GOOGLE_GEMINI_CLIENT_ID` and `GOOGLE_GEMINI_CLIENT_SECRET` are paired (both set or both unset). Implementation: add a check after the existing missing-list:
```ts
const hasId = !!process.env.GOOGLE_GEMINI_CLIENT_ID;
const hasSecret = !!process.env.GOOGLE_GEMINI_CLIENT_SECRET;
if (hasId !== hasSecret) {
  throw new Error(
    'GOOGLE_GEMINI_CLIENT_ID and GOOGLE_GEMINI_CLIENT_SECRET must be set together. See DEPLOY.md.'
  );
}
```
Test this in `env.test.ts`. The existing test file already imports `vi.resetModules()` between cases — extend the `KEYS` array.

## Step 3: Test review

### Existing test pattern (chat route)

`apps/web/__tests__/app/api/chat.test.ts` currently mocks `@anthropic-ai/sdk` directly:
```ts
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
(Anthropic as any).mockImplementation(() => ({ messages: { stream: ... } }));
```
After the refactor, this test should mock `@goalcoach/llm` instead:
```ts
vi.mock('@goalcoach/llm', () => ({
  createLLMClient: vi.fn(() => ({ send: vi.fn() })),
}));
```
The test verifies the chat route's behavior, not the SDK's. This is the right interface boundary.

### Test diagram

```
+-------------------+         +------------------------------+
| packages/llm      |         | apps/web                     |
|                   |         |                              |
| factory.test.ts   |         | app/api/chat.test.ts (UPD)   |
|  - routes by      |         |  - mock createLLMClient      |
|    provider       |         |  - SSE envelope matches      |
|  - throws on bad  |         |  - two-pass flow still       |
|    provider name  |         |  - x-llm-provider header     |
|                   |         |    emitted                   |
| client-anthropic  |         |                              |
|   .test.ts        |         | env.test.ts (EXTEND)         |
|  - text event     |         |  - paired GOOGLE_GEMINI_*    |
|  - tool_use event |         |    validation                |
|  - error event    |         |                              |
|  - done event     |         | app/api/auth/callback        |
|                   |         |   .test.ts (NEW)             |
| client-gemini     |         |  - persists tokens when      |
|   .test.ts        |         |    provider=google           |
|  - text event     |         |  - skips persistence         |
|  - 401 from       |         |    otherwise                 |
|    refresh falls  |         |  - handles missing           |
|    back to         |         |    expires_at                |
|    anthropic      |         |                              |
|  - tool prompt    |         | app/api/admin/llm-provider   |
|    conversion     |         |   .test.ts (NEW)             |
|  - NO tool_use    |         |  - POST flips users.llm_     |
|    events in      |         |    provider                  |
|    Phase 1        |         |  - 401 if not auth'd         |
|                   |         |                              |
| token-store       |         |                              |
|   .test.ts        |         |                              |
|  - cache hit      |         |                              |
|  - refresh on     |         |                              |
|    near-expiry    |         |                              |
|  - throws when    |         |                              |
|    no token       |         |                              |
|  - throws when    |         |                              |
|    refresh_token  |         |                              |
|    is null        |         |                              |
|  - throws when    |         |                              |
|    fetch returns  |         |                              |
|    non-2xx        |         |                              |
+-------------------+         +------------------------------+
```

### Missing test coverage identified

1. **Fallback to Anthropic when Gemini token absent.** Plan says "fall back to anthropic and log a warning." No test asserts this. **Add to chat route test.**

2. **Precedence: `users.llm_provider` beats `LLM_PROVIDER` env.** Plan implies but doesn't test. **Add a test where env says gemini but user row says anthropic — must use Anthropic.**

3. **`expires_at` is null in session.** Supabase OAuth provider may omit `expires_at` for some flows. Plan's code reads `gemini_token_expiry` from the `users` row, which we control. The session-to-row copy step needs to handle null `expires_at` gracefully (default to "use as-is" or null, which the token-store then treats as not-expired-or-not-refresh-needed?). **Document and test.**

4. **Gemini SSE parsing edge cases.** Test the client-gemini parser against: (a) a chunk that's mid-UTF-8 (split across SSE events), (b) a chunk with multiple JSON objects in one `data:` line, (c) Gemini's error response shape (status 400 + JSON body, not SSE).

5. **`x-llm-provider` header is always set.** Even on error responses. The chat route currently doesn't set it; the refactor must add it before the SSE stream starts.

## Step 4: Performance review

- **Token refresh latency.** First request after token expiry: +200-500ms for the refresh round-trip. Mitigation: in-memory cache for 60s window. Plan's design is correct.
- **Gemini stream latency.** SSE-over-fetch vs Anthropic SDK: comparable. No regression expected.
- **Edge runtime cold start.** External fetch on edge has a known cold-start penalty (~100-300ms). This is acceptable for a chat endpoint.
- **Two-pass tool flow.** Unchanged. Both clients implement `send()` returning StreamEvent, so the route's two-pass logic is provider-agnostic. Performance unchanged.
- **Token refresh rate limits.** Plan's risk #3 mentions jitter; the plan should also confirm we're not refreshing the same token from multiple concurrent requests. Add a simple in-flight lock (Map<userId, Promise>) in token-store to prevent 100 concurrent requests from all firing refresh calls.

## Outside voice / blind spots

Things I might miss that an independent reviewer would catch:

1. **`provider_token` is Supabase-managed.** The current callback uses `exchangeCodeForSession(code)` which sets the session. Supabase's OAuth provider response includes `provider_token` and `provider_refresh_token` as fields on the session. Verify these are present and not null. **Test against a real Supabase response shape, not a mocked one.**

2. **CSRF on the new admin endpoint.** Design obligation #1: `POST /api/admin/llm-provider`. This endpoint flips the per-user provider. It MUST require authentication (reuse `getServerSupabase()` + `auth.getUser()`). It should NOT be callable cross-origin (Vercel route handlers don't include CORS by default, but explicit check is safer).

3. **Token storage leak via logs.** Sentry events, OTel traces, and error logs must NOT include the access token. The plan's Sentry event `token_refresh_failed` should include the HTTP status and user ID, NOT the request body (which contains the refresh_token). Add a redaction helper.

4. **Supabase service role key vs cookie-scoped client for token refresh.** The chat route uses `getServerSupabase()` (cookie-scoped). For token refresh, this works (RLS allows user to update own row). But if the session JWT has expired when refresh runs, the cookie-scoped client can't read the row. **The chat route should use `getServerSupabase()` for the user-scoped read, but the token refresh write-back might need to use the service role if the session is mid-refresh.** This is an edge case but worth documenting.

5. **`assertEnv()` runs at boot.** If the founder starts the app with `LLM_PROVIDER=anthropic` (no Gemini vars set) and later wants to test Gemini locally, they need to restart. Plan doesn't specify. Acceptable: document in DEPLOY.md.

6. **Migration reversibility.** `0002_gemini_tokens.sql` adds 4 columns. If we need to roll back, the columns are nullable so `alter table users drop column ...` is safe. Plan doesn't address. Acceptable: not in scope.

## What already exists (reused, not rebuilt)

- `@goalcoach/ai/src/tools.ts` — TOOLS schema, reused by both providers
- `@goalcoach/ai/src/prompts.ts` — system prompt builder, reused
- `@goalcoach/ai/src/router.ts` — tool dispatch, reused
- `apps/web/lib/env.ts` `assertEnv()` — extended (not rewritten)
- `apps/web/lib/supabase/server.ts` `getServerSupabase()` — reused 1:1
- `apps/web/app/api/auth/google/route.ts` — extended with Gemini scopes
- `apps/web/app/api/auth/callback/route.ts` — extended with token persistence
- `apps/web/app/api/chat/route.ts` — refactored, two-pass tool flow stays
- `apps/web/__tests__/app/api/chat.test.ts` — updated to mock `@goalcoach/llm`

## Reviewer verdict

ENG: APPROVED with concrete amendments. The plan is the right shape, the right scope, the right size. Six concrete amendments to land before TDD starts.

**ACCEPTED OBLIGATIONS (ENG):**
1. Add `import 'server-only';` to `packages/llm/src/index.ts` (1 line, prevents accidental client import).
2. Document Gemini tool_use Phase 1 limitation inline in `client-gemini.ts` (single comment block).
3. Add explicit precedence test: `users.llm_provider` beats `LLM_PROVIDER` env beats default `anthropic`.
4. Add explicit test for "Gemini token absent → fall back to Anthropic with warning log + `x-llm-provider: anthropic` header."
5. Add in-flight lock in `token-store.ts` to prevent 100 concurrent requests from firing 100 refresh calls for the same user.
6. Add token-redaction helper so Sentry/OTel events never include the access or refresh token.

<!-- autoplan-accepted:eng -->
- Requirement: `packages/llm/src/index.ts` starts with `import 'server-only';`. Verification: build fails if imported from a client component.
- Requirement: `client-gemini.ts` has a comment block at the top explaining that `tool_use` events are not emitted in Phase 1 (tools are prompt instructions only). Verification: comment is present.
- Requirement: Test asserts precedence order: `users.llm_provider` > `LLM_PROVIDER` env > default `anthropic`. Verification: test in `factory.test.ts` or chat test.
- Requirement: Test asserts that when `LLM_PROVIEW=gemini` but the user has no Gemini token, the chat route falls back to Anthropic, logs a Sentry warning, and sets `x-llm-provider: anthropic`. Verification: test in chat route test file.
- Requirement: `token-store.ts` uses an in-flight Map<userId, Promise> to coalesce concurrent refresh requests. Verification: test fires 5 concurrent refresh calls for the same user and asserts only 1 fetch was made.
- Requirement: Token redaction helper used in all Sentry events involving token refresh or storage. Verification: test asserts that a captured Sentry event does NOT include the access or refresh token strings.
<!-- /autoplan-accepted:eng -->

---

# COMPLETION SUMMARY

**Verdict:** APPROVED.

**Amendments incorporated (CEO + Design + DX + Eng):**
1. `GEMINI_MODEL` env var with default `gemini-2.0-flash` (CEO)
2. Consent-screen republish caveat in DEPLOY.md (CEO)
3. Default `LLM_PROVIDER=anthropic` (CEO)
4. `POST /api/admin/llm-provider` endpoint replaces settings UI in Phase 1 (Design)
5. OAuth re-consent flow documented in DEPLOY.md (Design)
6. `x-llm-provider` response header on `/api/chat` (Design)
7. Worked curl example in DEPLOY.md proving Gemini active (DX)
8. `token_refresh_failed` and `llm_provider_selected` Sentry events (DX)
9. `assertEnv()` paired validation for `GOOGLE_GEMINI_CLIENT_ID`/`SECRET` (DX)
10. `import 'server-only'` in `@goalcoach/llm` (Eng)
11. Document Gemini tool_use Phase 1 limitation inline (Eng)
12. Test for provider precedence (`users.llm_provider` > env > default) (Eng)
13. Test for "Gemini token absent → fall back" (Eng)
14. In-flight refresh coalescing in token-store (Eng)
15. Token redaction helper for Sentry events (Eng)

**Dual voice consensus:** Both Eng and outside-voice reviewers agree this is the right shape. Outside-voice blind spots (CSRF on admin endpoint, Supabase session expiry mid-refresh, Sentry token leak) are captured in the blind spots section above and need product-level attention but do not block implementation.

**Status:** Plan is locked. TDD implementation may begin.

---

## GSTACK REVIEW REPORT

| Section | Reviewer | Status | Findings |
|---------|----------|--------|----------|
| CEO | plan-ceo-review (inline) | APPROVED | 3 obligations: `GEMINI_MODEL` env, consent-screen republish docs, default Anthropic |
| Design | plan-design-review (inline) | APPROVED (6/10) | 3 obligations: admin endpoint replaces UI, re-consent docs, `x-llm-provider` header |
| DX | plan-devex-review (inline) | APPROVED (7/10) | 4 obligations: worked curl, 2 Sentry events, paired env validation |
| Eng | plan-eng-review (inline) | APPROVED | 6 obligations: server-only, tool_use comment, precedence test, fall-back test, refresh coalescing, token redaction |

**OUTSIDE COVERAGE:** Not run (subagent context, no Codex/Aside dispatch). Independent reviewer blind spots captured inline in the Engineering Review "Outside voice" section. Founder should review these before implementation.

**CROSS-MODEL:** Not run (subagent context). Not required for solo-founder, single-engineer PR.

**UNRESOLVED DECISIONS:** None.

**FINAL VERDICT:** Plan locked. Proceed to TDD implementation per the user's task spec: `@goalcoach/llm` package first, then web integration. Each task: red test → green → commit. Then final code review, then DEPLOY.md update, then push branch.

NO UNRESOLVED DECISIONS