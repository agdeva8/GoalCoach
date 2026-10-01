-- GoalCoach migration 0002: Gemini OAuth tokens + per-user LLM provider.
--
-- Adds server-side-only columns to the existing users table. Tokens are
-- never returned to the browser; the chat route reads them via the
-- cookie-scoped Supabase client (RLS users_self allows it). The default
-- provider stays Anthropic until the founder explicitly opts in.

alter table users add column gemini_access_token text;
alter table users add column gemini_refresh_token text;
alter table users add column gemini_token_expiry timestamptz;
alter table users add column llm_provider text default 'anthropic'
  check (llm_provider in ('anthropic', 'gemini'));
