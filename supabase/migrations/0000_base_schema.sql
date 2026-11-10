-- 0000_base_schema.sql — the tables that predate the numbered migrations.
--
-- Until now no migration created users, entries, chat_sessions or
-- chat_messages, so the database could not be rebuilt from this repo. This
-- file was reconstructed on 2026-11-09 from the live database's API schema
-- (PostgREST OpenAPI): column names, types, NOT NULL, defaults, primary keys
-- and foreign keys are exact. Not visible there, and therefore NOT asserted
-- here: secondary indexes, ON DELETE behaviour, check constraints, RLS.
--
-- Only each table's ORIGINAL columns are created here. Later columns are
-- added by the migrations that introduced them (all `add column if not
-- exists`), so running 0000 → 0009 in order reproduces the current schema,
-- and running this file against the existing database is a no-op.

create table if not exists users (
  username     text primary key,
  pin_hash     text not null,
  pin_length   integer default 4,
  chat_count   integer default 0,
  user_api_key text,            -- encrypted at rest ("enc:v1:…"), see backend/src/lib/secret-box.ts
  custom_tags  jsonb,
  created_at   timestamptz default now()
);

create table if not exists entries (
  id              uuid primary key default gen_random_uuid(),
  username        text references users (username),
  text            text not null,
  activity        text,
  mood            integer,      -- AI-scored, 1–10
  mood_label      text,
  mood_user       integer,      -- self-reported, 1–10
  mood_user_label text,
  created_at      timestamptz default now()
);

create table if not exists chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  -- NB: the live table has no foreign key to users, so deleting a user leaves
  -- their sessions behind. Reproduced as-is rather than silently "fixed".
  username   text not null,
  title      text,
  created_at timestamptz default now()
);

create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions (id),
  role       text not null,     -- 'user' | 'assistant'
  content    text not null,
  created_at timestamptz default now()
);
