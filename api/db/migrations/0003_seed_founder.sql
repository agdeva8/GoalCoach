-- Seed: the founder user referenced as TEST_USER_ID in
-- api/app/api/chat/stream/route.ts:58 and elsewhere. Without this row, any
-- chat attempt using the bearer/session_token shortcut fails with FK
-- violation "messages_user_id_users_id_fk" before the LLM stream starts
-- (FK violation = 500, no SSE events emitted).
--
-- Idempotent: ON CONFLICT DO NOTHING so re-runs are safe.

INSERT INTO users (id, email, name, image, model_provider, is_guest, created_at)
VALUES (
  'user_founder01',
  'founder@goalcoach.local',
  'Founder',
  NULL,
  'gemini',
  false,
  NOW()
)
ON CONFLICT (id) DO NOTHING;
