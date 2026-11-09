-- 0008_reading_preferences.sql — Paper redesign: how the archive reads, and
-- whether it locks itself when you leave.
--
-- Both settings are per-user rather than per-device so they follow you between
-- the web app and the APK, which is why they live here and not in localStorage.

-- How the entries are set. 'reading' is the serif the design was drawn in.
alter table users
  add column if not exists font_pref text not null default 'reading';

alter table users
  drop constraint if exists users_font_pref_check;

alter table users
  add constraint users_font_pref_check
  check (font_pref in ('reading', 'handwritten', 'plain'));

-- Re-lock on leaving. Defaults on: this is a private journal.
alter table users
  add column if not exists lock_on_close boolean not null default true;
