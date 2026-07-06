-- 0002_cron.sql — schedule the weekly pattern-summary Edge Function
-- Run in the Supabase SQL Editor AFTER:
--   1. Deploying the function:  supabase functions deploy weekly-summary --no-verify-jwt
--   2. Setting its secret:      supabase secrets set GEMINI_API_KEY=<your key>
--   3. Replacing YOUR_PROJECT_REF below with your project ref
--      (the subdomain in your Supabase URL: https://YOUR_PROJECT_REF.supabase.co)
--
-- Prerequisites: pg_cron and pg_net extensions enabled (Database → Extensions).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every Sunday at 03:00 UTC
select cron.schedule(
  'weekly-pattern-summary',
  '0 3 * * 0',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/weekly-summary',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- To inspect: select * from cron.job;
-- To remove:  select cron.unschedule('weekly-pattern-summary');
