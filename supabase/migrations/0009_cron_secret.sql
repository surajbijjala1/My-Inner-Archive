-- 0009_cron_secret.sql — make pg_cron authenticate to the Edge Functions.
--
-- The functions run with --no-verify-jwt, so until now anyone who knew the
-- project URL could trigger them. They now refuse requests without an
-- x-cron-secret header (supabase/functions/_shared/cron-auth.ts). This
-- reschedules both jobs to send it, reading the secret and the project URL
-- from Supabase Vault, so neither is written into this repo. It also replaces
-- the YOUR_PROJECT_REF placeholders from 0002/0004.
--
-- ORDER MATTERS — do these first, with ONE random value (e.g. `openssl rand -hex 32`):
--   1. supabase secrets set CRON_SECRET=<value>
--   2. supabase functions deploy weekly-summary --no-verify-jwt
--      supabase functions deploy daily-notification --no-verify-jwt
--   3. In the SQL Editor (once):
--        select vault.create_secret('<value>', 'cron_secret');
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   4. Run this file.
-- Between steps 2 and 4 the old jobs are refused (no header), so at most a
-- 15-minute notification slot is skipped. To rotate later: set a new
-- CRON_SECRET, then vault.update_secret(id, '<new>') — no reschedule needed.

do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('weekly-pattern-summary', 'daily-motivation-notifications');
end $$;

-- Every Sunday at 03:00 UTC (unchanged)
select cron.schedule(
  'weekly-pattern-summary',
  '0 3 * * 0',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- Every 15 minutes (unchanged)
select cron.schedule(
  'daily-motivation-notifications',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/daily-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Check:  select jobname, schedule from cron.job;
-- Recent runs (status_code should be 200, not 401/503):
--   select status_code, created from net._http_response order by created desc limit 10;
