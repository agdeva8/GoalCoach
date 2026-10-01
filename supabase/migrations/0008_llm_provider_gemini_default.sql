-- GoalCoach migration 0008: llm_provider defaults to Gemini (Drift D1).
--
-- Why this exists:
--   0002_gemini_tokens.sql added `users.llm_provider text default
--   'anthropic'`. Postgres applies a column default to every row inserted
--   without an explicit value, and `ALTER TABLE ... ADD COLUMN ... DEFAULT`
--   backfills existing rows. So *every* pre-existing user carries
--   llm_provider = 'anthropic' on their row, and only the admin setter
--   (/api/admin/llm-provider) ever writes the column - the OAuth callback
--   stores Gemini tokens but never touches llm_provider.
--
--   The chat route resolves provider as row > default. Because the row
--   check outranks the application fallback, flipping the fallback alone
--   was unreachable in production: real users kept resolving to
--   'anthropic' from the row. This migration fixes the data, not just the
--   code.
--
-- What this does:
--   1. Backfills users who have connected Google (gemini_access_token is
--      not null) off the stale 'anthropic' default so they actually get
--      Gemini. Users without tokens are left alone: they cannot use
--      Gemini anyway, and the chat route's missing-token path already
--      falls back to Anthropic for them.
--   2. Flips the column default so new rows get 'gemini' without an
--      explicit write.
--
-- The `llm_provider in ('anthropic', 'gemini')` check constraint from
-- 0002 is left intact: both values stay legal, because an explicit admin
-- override and the missing-token fallback still produce 'anthropic'.
--
-- Idempotent: re-running sets no rows to a new value and re-applies the
-- same default.

update users
   set llm_provider = 'gemini'
 where llm_provider = 'anthropic'
   and gemini_access_token is not null;

alter table users alter column llm_provider set default 'gemini';
