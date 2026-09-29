# Deploy: Sutra Phase 1

Vercel + Supabase. All free tier, no credit card.

## Prereqs (free, no card)

1. **Supabase free project** — https://supabase.com
   - Copy `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - Copy `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
   - Run migration: `packages/db/migrations/0001_init.sql` (apply in SQL editor)

2. **Google Cloud OAuth client** — https://console.cloud.google.com/apis/credentials
   - Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`

3. **Anthropic API key** — https://console.anthropic.com
   - Generate key → `ANTHROPIC_API_KEY`
   - Optional model override → `ANTHROPIC_MODEL` (defaults to `claude-sonnet-4-5`)

4. **Sentry free project** — https://sentry.io (optional, skip until 5K events)
   - DSN → `NEXT_PUBLIC_SENTRY_DSN`

5. **Cron secret** — generate any random string (e.g. `openssl rand -hex 32`)
   - Set `CRON_SECRET` in Vercel. Vercel cron auto-injects the bearer header.
   - Without this, `/api/cron/*` returns 401.

## Vercel setup

```bash
cd apps/web
npx vercel link
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
npx vercel env add SUPABASE_SERVICE_ROLE_KEY
npx vercel env add ANTHROPIC_API_KEY
npx vercel env add ANTHROPIC_MODEL          # optional override
npx vercel env add CRON_SECRET
npx vercel env add NEXT_PUBLIC_SENTRY_DSN   # optional
npx vercel deploy --prod
```

## Vercel cron schedules (already in `vercel.json`)

- Weekly: Mon 09:00 UTC → `/api/cron/weekly` (goals >7d idle)
- Monthly: 1st 09:00 UTC → `/api/cron/monthly` (reflections >30d old)

## Smoke test

1. Visit the URL, sign in with Google.
2. Primer appears. Pick a horizon. Chat works.
3. Run `curl https://<url>/api/cron/weekly` — expect `{count, stale[]}`.

## Domain (deferred)

`sutra.app` is held until first non-founder user. Register in Vercel
when `/ship` runs or when second user lands.

## Gemini OAuth (optional — Anthropic stays default)

The chat route is provider-agnostic. The Anthropic path is the default
and continues to work without any of the steps below. To enable Gemini
for a user:

1. **Google Cloud — consent screen republish (one-time)** — https://console.cloud.google.com/apis/credentials/consent
   - The OAuth consent screen must list the
     `https://www.googleapis.com/auth/generative-language` scope under
     "Data access". If the OAuth client is already published, you must
     **republish** the consent screen after adding the scope or
     existing users will keep getting the old scope set on sign-in.
   - Verify the scope is listed under "Your non-sensitive scopes" or
     "Your sensitive scopes" before continuing.

2. **Supabase — add Gemini to Google provider scopes**
   - The Google provider in Supabase Auth must request the same scope.
     The app's `/api/auth/google` route now sends
     `openid email profile https://www.googleapis.com/auth/generative-language`.
     No Supabase dashboard change required for the app itself, but if
     you have a custom Google provider config in Supabase, ensure
     `additional_scopes` contains the Gemini scope.

3. **Vercel — set the new env vars**
   ```bash
   cd apps/web
   npx vercel env add LLM_PROVIDER              # '' or 'gemini'
   npx vercel env add GOOGLE_GEMINI_CLIENT_ID
   npx vercel env add GOOGLE_GEMINI_CLIENT_SECRET
   ```
   `LLM_PROVIDER` is a site-wide feature flag. Set it to `gemini` to
   route every user with valid tokens through Gemini, or leave it empty
   and let users opt in individually via `/api/admin/llm-provider`.
   The client ID and secret are only used to refresh expired Gemini
   tokens; they do not select the provider.

4. **User opt-in (per-user)**
   - Existing users must sign out and back in via Google once after the
     consent screen republish so Supabase issues a token with the
     Gemini scope. The callback route persists the provider token and
     refresh token on the `users` row.
   - To switch a single user to Gemini:
     ```bash
     curl -X POST https://<url>/api/admin/llm-provider \
       -H 'Cookie: <sb-access-token>' \
       -H 'Content-Type: application/json' \
       -d '{"provider":"gemini"}'
     ```
   - Switch back to Anthropic with `{"provider":"anthropic"}`.

5. **Verify Gemini is active**
   ```bash
   curl -i -X POST https://<url>/api/chat \
     -H 'Cookie: <sb-access-token>' \
     -H 'Content-Type: application/json' \
     -d '{"messages":[{"role":"user","content":"hi"}]}'
   ```
   The response headers include `x-llm-provider: gemini`. If the user
   has no Gemini tokens, the route falls back to Anthropic and the
   header reads `x-llm-provider: anthropic`. A Sentry warning
   (`token_refresh_failed` / `llm_provider_selected=anthropic`) is
   emitted when the fallback path is taken.
