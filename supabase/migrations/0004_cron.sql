-- 0004_cron.sql — schedule the daily-notification Edge Function
-- Run in the Supabase SQL Editor AFTER:
--   1. Running 0003_notifications.sql
--   2. Deploying:  supabase functions deploy daily-notification --no-verify-jwt
--   3. Setting the secret (service-account JSON as ONE line):
--        supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json | tr -d '\n')"
--   4. Replacing YOUR_PROJECT_REF below
--
-- Runs every 15 minutes; the function itself decides which users' local
-- notification slots match and sends at most one notification per slot.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daily-motivation-notifications',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To inspect: select * from cron.job;
-- To remove:  select cron.unschedule('daily-motivation-notifications');
