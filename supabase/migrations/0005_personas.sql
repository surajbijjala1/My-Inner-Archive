-- 0005_personas.sql — Batch B: selectable AI personas + user custom instructions
-- Run in the Supabase SQL Editor.

alter table users add column if not exists persona text not null default 'smriti';
alter table users add column if not exists custom_instructions text;
