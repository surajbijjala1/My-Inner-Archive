-- 0010_theme_pref.sql — dark mode: light, dark, or follow the device.
--
-- Per-user like font_pref (0008), so the choice follows you between the web
-- app and the APK. The client also keeps a copy in localStorage for the
-- sign-in screens, and keeps working (device-only) until this is applied.

alter table users
  add column if not exists theme text not null default 'system';

alter table users
  drop constraint if exists users_theme_check;

alter table users
  add constraint users_theme_check
  check (theme in ('system', 'light', 'dark'));
