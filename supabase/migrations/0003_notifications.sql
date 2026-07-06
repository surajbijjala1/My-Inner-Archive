-- 0003_notifications.sql — Phase 3: favorites, device tokens, notification settings
-- Run in the Supabase SQL Editor.

-- ── Star/favorite on entries (Feature 6) ─────────────────────────────────────
alter table entries add column if not exists is_favorite boolean not null default false;

-- ── FCM device tokens (Feature 5) ────────────────────────────────────────────
create table if not exists device_tokens (
  token text primary key,
  username text not null references users(username) on delete cascade,
  platform text not null default 'android',
  created_at timestamptz not null default now()
);

create index if not exists device_tokens_username on device_tokens (username);

-- ── Per-user notification settings (Feature 6) ───────────────────────────────
alter table users add column if not exists notify_enabled boolean not null default false;
alter table users add column if not exists notify_times jsonb not null default '["08:00","18:00"]'::jsonb;
alter table users add column if not exists notify_timezone text;
-- Bookkeeping used by the cron job: no consecutive repeats, no double-sends per slot
alter table users add column if not exists last_notified_entry_id uuid;
alter table users add column if not exists last_notified_slot text;
