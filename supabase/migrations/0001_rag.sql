-- 0001_rag.sql — Phase 1: embedding infrastructure + pattern summaries
-- Run in the Supabase SQL Editor (or `supabase db push`).
-- Prerequisite: pgvector extension enabled (Database → Extensions → vector).

create extension if not exists vector;

-- ── entries: embedding columns ────────────────────────────────────────────────
-- embedding_model records which model produced the vector. Vectors from
-- different models are NOT comparable, so retrieval always filters on it.
alter table entries add column if not exists embedding vector(768);
alter table entries add column if not exists embedding_model text;

-- HNSW index for cosine similarity (no training step needed, unlike ivfflat)
create index if not exists entries_embedding_hnsw
  on entries using hnsw (embedding vector_cosine_ops);

-- ── pattern_summaries (Feature 10) ───────────────────────────────────────────
-- Weekly AI-generated reflections; the app keeps the newest 4 rows per user.
create table if not exists pattern_summaries (
  id uuid primary key default gen_random_uuid(),
  username text not null references users(username) on delete cascade,
  week_start date not null,
  summary text not null,
  created_at timestamptz not null default now(),
  unique (username, week_start)
);

create index if not exists pattern_summaries_user_week
  on pattern_summaries (username, week_start desc);

-- ── match_entries: primary semantic retrieval ────────────────────────────────
create or replace function match_entries(
  p_username text,
  p_query_embedding vector(768),
  p_model text,
  p_match_count int default 5,
  p_threshold float default 0.35
)
returns table (
  id uuid,
  text text,
  activity text,
  mood int,
  mood_label text,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    e.id,
    e.text,
    e.activity,
    e.mood,
    e.mood_label,
    e.created_at,
    1 - (e.embedding <=> p_query_embedding) as similarity
  from entries e
  where e.username = p_username
    and e.embedding is not null
    and e.embedding_model = p_model
    and 1 - (e.embedding <=> p_query_embedding) > p_threshold
  order by e.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- ── match_entries_before: temporal retrieval (Feature 11) ────────────────────
-- Same search, but excludes recent entries so Smriti can surface older
-- occurrences of the same theme ("you wrote about this in March too").
create or replace function match_entries_before(
  p_username text,
  p_query_embedding vector(768),
  p_model text,
  p_match_count int default 3,
  p_threshold float default 0.45,
  p_cutoff_days int default 30
)
returns table (
  id uuid,
  text text,
  activity text,
  mood int,
  mood_label text,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    e.id,
    e.text,
    e.activity,
    e.mood,
    e.mood_label,
    e.created_at,
    1 - (e.embedding <=> p_query_embedding) as similarity
  from entries e
  where e.username = p_username
    and e.embedding is not null
    and e.embedding_model = p_model
    and e.created_at < now() - make_interval(days => p_cutoff_days)
    and 1 - (e.embedding <=> p_query_embedding) > p_threshold
  order by e.embedding <=> p_query_embedding
  limit p_match_count;
$$;
