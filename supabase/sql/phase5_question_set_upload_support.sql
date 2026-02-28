-- Phase 5: question set upload support, versioning metadata, and visibility/status fields
-- Apply after phase4_tests_management_architecture.sql

do $$
begin
  create type public.question_set_status as enum ('draft', 'published', 'archived');
exception
  when duplicate_object then null;
end $$;

alter table public.question_sets
  add column if not exists library_key uuid not null default gen_random_uuid(),
  add column if not exists version_label text,
  add column if not exists status public.question_set_status not null default 'draft',
  add column if not exists source_question_set_id uuid references public.question_sets(id) on delete set null;

update public.question_sets
set version_label = coalesce(version_label, 'v' || version::text)
where version_label is null;

alter table public.question_sets
  alter column version_label set not null;

create index if not exists question_sets_library_key_idx
  on public.question_sets (library_key, version desc);
create index if not exists question_sets_status_idx
  on public.question_sets (status);
create unique index if not exists question_sets_library_version_label_key
  on public.question_sets (library_key, version_label);

alter table public.question_set_questions
  add column if not exists qid text,
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists media_type text,
  add column if not exists media_path text;

update public.question_set_questions
set qid = coalesce(qid, id::text)
where qid is null;

alter table public.question_set_questions
  alter column qid set not null;

alter table public.question_set_questions
  drop constraint if exists question_set_questions_media_type_check;

alter table public.question_set_questions
  add constraint question_set_questions_media_type_check
  check (media_type is null or media_type in ('image', 'audio'));

create unique index if not exists question_set_questions_qid_key
  on public.question_set_questions (question_set_id, qid);

create index if not exists question_set_questions_media_type_idx
  on public.question_set_questions (media_type);
