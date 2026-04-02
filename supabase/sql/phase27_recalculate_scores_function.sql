-- Phase 24: Admin function to recalculate attempt scores after correcting answers
-- This function recalculates scores for all attempts in a question set
-- by comparing student answers against the current correct answers

create or replace function public.recalculate_question_set_scores(
  p_question_set_id uuid
)
returns table (
  affected_attempts_count int,
  updated_attempts_count int,
  min_score_rate numeric,
  max_score_rate numeric,
  avg_score_rate numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count int;
begin
  -- Only super_admin and admin can run this
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'only super_admin and admin can recalculate scores';
  end if;

  -- Validate question set exists
  if not exists (
    select 1 from public.question_sets where id = p_question_set_id
  ) then
    raise exception 'question set not found: %', p_question_set_id;
  end if;

  -- Recalculate scores using a single update statement with subquery
  with calculated_scores as (
    select
      a.id,
      a.correct as old_correct,
      a.score_rate as old_score_rate,
      coalesce(
        (select count(*)::int
         from public.question_set_questions qsq
         where qsq.question_set_id = p_question_set_id
           and jsonb_typeof(a.answers_json -> qsq.id::text) = 'number'
           and (a.answers_json ->> (qsq.id::text))::int = (qsq.correct_answer::int)
        ),
        0
      ) as new_correct,
      (select count(*)::int from public.question_set_questions where question_set_id = p_question_set_id) as total_questions
    from public.attempts a
    where a.question_set_id = p_question_set_id
  ),
  with_score_rate as (
    select
      id,
      old_correct,
      old_score_rate,
      new_correct,
      total_questions,
      case
        when total_questions > 0
        then (new_correct::numeric / total_questions * 100)::numeric(5, 2)
        else 0
      end as new_score_rate
    from calculated_scores
  )
  update public.attempts
  set
    correct = wsr.new_correct,
    score_rate = wsr.new_score_rate,
    updated_at = now()
  from with_score_rate wsr
  where attempts.id = wsr.id
    and (attempts.correct != wsr.new_correct or attempts.score_rate != wsr.new_score_rate);

  get diagnostics v_updated_count = row_count;

  -- Return summary statistics
  return query
  select
    (select count(*)::int from public.attempts where question_set_id = p_question_set_id) as affected_attempts_count,
    v_updated_count as updated_attempts_count,
    (select min(score_rate) from public.attempts where question_set_id = p_question_set_id)::numeric as min_score_rate,
    (select max(score_rate) from public.attempts where question_set_id = p_question_set_id)::numeric as max_score_rate,
    (select avg(score_rate) from public.attempts where question_set_id = p_question_set_id)::numeric(5, 2) as avg_score_rate;
end;
$$;

-- Alternative function to recalculate scores for a specific test instance
create or replace function public.recalculate_test_instance_scores(
  p_test_instance_id uuid
)
returns table (
  affected_attempts_count int,
  updated_attempts_count int,
  min_score_rate numeric,
  max_score_rate numeric,
  avg_score_rate numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_set_id uuid;
  v_updated_count int;
begin
  -- Only super_admin and admin can run this
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'only super_admin and admin can recalculate scores';
  end if;

  -- Get the question set for this test instance
  select question_set_id into v_question_set_id
  from public.test_instances
  where id = p_test_instance_id;

  if v_question_set_id is null then
    raise exception 'test instance not found or no associated question set: %', p_test_instance_id;
  end if;

  -- Recalculate scores only for attempts in this test instance
  with calculated_scores as (
    select
      a.id,
      a.correct as old_correct,
      a.score_rate as old_score_rate,
      coalesce(
        (select count(*)::int
         from public.question_set_questions qsq
         where qsq.question_set_id = v_question_set_id
           and jsonb_typeof(a.answers_json -> qsq.id::text) = 'number'
           and (a.answers_json ->> (qsq.id::text))::int = (qsq.correct_answer::int)
        ),
        0
      ) as new_correct,
      (select count(*)::int from public.question_set_questions where question_set_id = v_question_set_id) as total_questions
    from public.attempts a
    where a.test_instance_id = p_test_instance_id
  ),
  with_score_rate as (
    select
      id,
      old_correct,
      old_score_rate,
      new_correct,
      total_questions,
      case
        when total_questions > 0
        then (new_correct::numeric / total_questions * 100)::numeric(5, 2)
        else 0
      end as new_score_rate
    from calculated_scores
  )
  update public.attempts
  set
    correct = wsr.new_correct,
    score_rate = wsr.new_score_rate,
    updated_at = now()
  from with_score_rate wsr
  where attempts.id = wsr.id
    and (attempts.correct != wsr.new_correct or attempts.score_rate != wsr.new_score_rate);

  get diagnostics v_updated_count = row_count;

  -- Return summary statistics
  return query
  select
    (select count(*)::int from public.attempts where test_instance_id = p_test_instance_id) as affected_attempts_count,
    v_updated_count as updated_attempts_count,
    (select min(score_rate) from public.attempts where test_instance_id = p_test_instance_id)::numeric as min_score_rate,
    (select max(score_rate) from public.attempts where test_instance_id = p_test_instance_id)::numeric as max_score_rate,
    (select avg(score_rate) from public.attempts where test_instance_id = p_test_instance_id)::numeric(5, 2) as avg_score_rate;
end;
$$;

-- Grant execute permission to authenticated users (they still need to be super_admin per function check)
grant execute on function public.recalculate_question_set_scores(uuid) to authenticated;
grant execute on function public.recalculate_test_instance_scores(uuid) to authenticated;
