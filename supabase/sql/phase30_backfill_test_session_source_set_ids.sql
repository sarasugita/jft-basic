-- Backfill daily test sessions so the SetID column shows the selected source sets.
-- This repairs rows created before source_set_ids was consistently persisted.

with question_sources as (
  select
    q.test_version,
    nullif(trim(source_ids.source_id), '') as source_set_id
  from public.questions q
  cross join lateral (
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(q.data->'sourceSetIds') = 'array' then q.data->'sourceSetIds'
        else '[]'::jsonb
      end
    ) as source_id
  ) source_ids
  where q.test_version like 'daily_session_%'

  union all

  select
    q.test_version,
    nullif(trim(q.data->>'sourceVersion'), '') as source_set_id
  from public.questions q
  where q.test_version like 'daily_session_%'
),
source_map as (
  select
    qs.test_version,
    (
      select jsonb_agg(to_jsonb(source_set_id) order by source_set_id)
      from (
        select distinct source_set_id
        from question_sources qs2
        where qs2.test_version = qs.test_version
          and qs2.source_set_id is not null
      ) ordered_sources
    ) as source_set_ids
  from question_sources qs
  group by qs.test_version
)
update public.test_sessions ts
set source_set_ids = source_map.source_set_ids
from source_map
where ts.problem_set_id = source_map.test_version
  and ts.problem_set_id like 'daily_session_%'
  and (
    ts.source_set_ids is null
    or ts.source_set_ids = '[]'::jsonb
    or (
      jsonb_typeof(ts.source_set_ids) = 'array'
      and jsonb_array_length(ts.source_set_ids) = 1
      and (ts.source_set_ids->>0) like 'daily_session_%'
    )
  );
