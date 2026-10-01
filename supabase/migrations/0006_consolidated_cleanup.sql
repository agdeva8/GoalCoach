-- GoalCoach migration 0006: consolidated TTL cleanup RPC.
--
-- Why this exists:
--   weekly + monthly cron routes currently do their own narrow cleanups
--   (stale goals, old reflections). This single function is the
--   consolidation point for cleaning TTL'd rows across the app. Each
--   DELETE is wrapped in a per-statement EXCEPTION handler so the
--   function never fails when a table is not yet present — it logs a
--   notice and continues. New migrations adding those tables will be
--   picked up automatically without revisiting this cron.
--
-- Why this is safe to run before the tables exist:
--   Each DELETE is independent. When the table is missing, postgres
--   raises undefined_table (SQLSTATE 42P01). We catch and RAISE NOTICE
--   so the cron returns 200 + {ok:true} from the route. When a future
--   migration creates the table, this same function will clean it on
--   the next 3am UTC run.

CREATE OR REPLACE FUNCTION cleanup_expired_rows() RETURNS void AS $$
BEGIN
  BEGIN
    DELETE FROM idempotency_keys WHERE expires_at < now();
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'cleanup_expired_rows: idempotency_keys not present, skipping';
  END;

  BEGIN
    DELETE FROM oauth_states WHERE expires_at < now();
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'cleanup_expired_rows: oauth_states not present, skipping';
  END;

  BEGIN
    DELETE FROM rate_limit_events WHERE bucket_hour < now() - interval '24 hours';
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'cleanup_expired_rows: rate_limit_events not present, skipping';
  END;
END;
$$ LANGUAGE plpgsql;
