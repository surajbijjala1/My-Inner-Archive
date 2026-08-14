-- 0007_atomic_chat_count.sql — make the free-tier counter race-free.
-- Run in the Supabase SQL Editor.
--
-- The route previously did a read-modify-write around an AI call:
--   read chat_count → ... await Gemini ... → write chat_count + 1
-- Concurrent requests all read the same value and write the same increment, so
-- the counter undercounts and a trial user can exceed FREE_MESSAGE_LIMIT.
-- A single UPDATE ... SET x = x + 1 is atomic under Postgres row locking.

create or replace function increment_chat_count(p_username text)
returns int
language sql
volatile
as $$
  update users
     set chat_count = coalesce(chat_count, 0) + 1
   where username = p_username
  returning chat_count;
$$;
