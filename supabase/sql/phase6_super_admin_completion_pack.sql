-- Phase 6: super admin dashboard, analytics aggregates, and audit logs
-- Apply after phase5_question_set_upload_support.sql

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  actor_email text,
  action_type text not null,
  entity_type text not null,
  entity_id text not null,
  school_id uuid references public.schools(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_school_idx
  on public.audit_logs (school_id, created_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_user_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists "audit logs select super admin" on public.audit_logs;
create policy "audit logs select super admin"
on public.audit_logs for select
using (public.current_user_role() = 'super_admin');

drop policy if exists "audit logs service role insert" on public.audit_logs;
create policy "audit logs service role insert"
on public.audit_logs for insert
with check (auth.role() = 'service_role');

create or replace function public.super_school_metrics_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_test_type text default 'all'
)
returns table (
  school_id uuid,
  student_count bigint,
  tests_taken bigint,
  daily_avg numeric,
  model_avg numeric,
  attendance_avg numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'super_admin' and auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  return query
  with student_counts as (
    select p.school_id, count(*)::bigint as student_count
    from public.profiles p
    where p.role = 'student'
    group by p.school_id
  ),
  attempts_base as (
    select
      a.school_id,
      case
        when a.score_rate is not null then a.score_rate
        when a.total is not null and a.total <> 0 then a.correct::numeric / a.total::numeric
        else null
      end as score,
      case
        when a.test_type is not null then a.test_type::text
        when ti.test_type is not null then ti.test_type::text
        when t.type = 'daily' then 'daily'
        when t.type = 'mock' then 'model'
        else null
      end as normalized_test_type
    from public.attempts a
    left join public.test_instances ti on ti.id = a.test_instance_id
    left join public.tests t on t.version = a.test_version
    where (p_date_from is null or a.created_at::date >= p_date_from)
      and (p_date_to is null or a.created_at::date <= p_date_to)
  ),
  attempt_metrics as (
    select
      ab.school_id,
      count(*) filter (where p_test_type = 'all' or ab.normalized_test_type = p_test_type)::bigint as tests_taken,
      avg(ab.score) filter (
        where ab.normalized_test_type = 'daily'
          and (p_test_type = 'all' or ab.normalized_test_type = p_test_type)
      ) as daily_avg,
      avg(ab.score) filter (
        where ab.normalized_test_type = 'model'
          and (p_test_type = 'all' or ab.normalized_test_type = p_test_type)
      ) as model_avg
    from attempts_base ab
    where ab.school_id is not null
    group by ab.school_id
  ),
  attendance_metrics as (
    select
      ad.school_id,
      avg(case when ae.status = 'P' then 1.0 else 0.0 end) as attendance_avg
    from public.attendance_entries ae
    join public.attendance_days ad on ad.id = ae.day_id
    where (p_date_from is null or ad.day_date >= p_date_from)
      and (p_date_to is null or ad.day_date <= p_date_to)
    group by ad.school_id
  )
  select
    s.id as school_id,
    coalesce(sc.student_count, 0) as student_count,
    coalesce(am.tests_taken, 0) as tests_taken,
    am.daily_avg,
    am.model_avg,
    att.attendance_avg
  from public.schools s
  left join student_counts sc on sc.school_id = s.id
  left join attempt_metrics am on am.school_id = s.id
  left join attendance_metrics att on att.school_id = s.id
  order by s.name;
end;
$$;

create or replace function public.super_dashboard_metrics(
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  total_schools bigint,
  total_students bigint,
  total_tests_taken bigint,
  avg_score numeric,
  attendance_avg numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'super_admin' and auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  return query
  with attempts_base as (
    select
      case
        when a.score_rate is not null then a.score_rate
        when a.total is not null and a.total <> 0 then a.correct::numeric / a.total::numeric
        else null
      end as score
    from public.attempts a
    where (p_date_from is null or a.created_at::date >= p_date_from)
      and (p_date_to is null or a.created_at::date <= p_date_to)
  ),
  attendance_base as (
    select
      case when ae.status = 'P' then 1.0 else 0.0 end as attendance_rate
    from public.attendance_entries ae
    join public.attendance_days ad on ad.id = ae.day_id
    where (p_date_from is null or ad.day_date >= p_date_from)
      and (p_date_to is null or ad.day_date <= p_date_to)
  )
  select
    (select count(*)::bigint from public.schools),
    (select count(*)::bigint from public.profiles p where p.role = 'student'),
    (select count(*)::bigint from attempts_base),
    (select avg(score) from attempts_base),
    (select avg(attendance_rate) from attendance_base);
end;
$$;

create or replace function public.super_question_set_performance(
  p_date_from date default null,
  p_date_to date default null,
  p_school_id uuid default null,
  p_test_type text default 'all'
)
returns table (
  entity_id text,
  title text,
  source_type text,
  school_id uuid,
  attempts_count bigint,
  avg_score numeric,
  normalized_test_type text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'super_admin' and auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  return query
  with attempts_base as (
    select
      a.school_id,
      a.question_set_id,
      a.test_version,
      case
        when a.score_rate is not null then a.score_rate
        when a.total is not null and a.total <> 0 then a.correct::numeric / a.total::numeric
        else null
      end as score,
      case
        when a.test_type is not null then a.test_type::text
        when ti.test_type is not null then ti.test_type::text
        when t.type = 'daily' then 'daily'
        when t.type = 'mock' then 'model'
        else null
      end as normalized_test_type,
      qs.title as question_set_title,
      qs.version_label,
      t.title as legacy_title
    from public.attempts a
    left join public.test_instances ti on ti.id = a.test_instance_id
    left join public.question_sets qs on qs.id = coalesce(a.question_set_id, ti.question_set_id)
    left join public.tests t on t.version = a.test_version
    where (p_date_from is null or a.created_at::date >= p_date_from)
      and (p_date_to is null or a.created_at::date <= p_date_to)
      and (p_school_id is null or a.school_id = p_school_id)
  )
  select
    coalesce(ab.question_set_id::text, ab.test_version) as entity_id,
    coalesce(
      case
        when ab.question_set_title is not null then ab.question_set_title || ' (' || coalesce(ab.version_label, 'v?') || ')'
        else null
      end,
      ab.legacy_title,
      ab.test_version,
      'Unknown'
    ) as title,
    case when ab.question_set_id is not null then 'question_set' else 'legacy_test' end as source_type,
    ab.school_id,
    count(*)::bigint as attempts_count,
    avg(ab.score) as avg_score,
    ab.normalized_test_type
  from attempts_base ab
  where (p_test_type = 'all' or ab.normalized_test_type = p_test_type)
  group by
    coalesce(ab.question_set_id::text, ab.test_version),
    coalesce(
      case
        when ab.question_set_title is not null then ab.question_set_title || ' (' || coalesce(ab.version_label, 'v?') || ')'
        else null
      end,
      ab.legacy_title,
      ab.test_version,
      'Unknown'
    ),
    case when ab.question_set_id is not null then 'question_set' else 'legacy_test' end,
    ab.school_id,
    ab.normalized_test_type
  order by attempts_count desc, title asc;
end;
$$;
