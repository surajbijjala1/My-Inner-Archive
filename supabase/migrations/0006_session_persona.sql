-- 0006_session_persona.sql — pin each chat session to the persona it started with.
-- Run in the Supabase SQL Editor.
--
-- Existing rows stay NULL → the backend falls back to the user's currently
-- selected persona (the old behavior). New sessions are stamped at creation.

alter table chat_sessions add column if not exists persona text;
