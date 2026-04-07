-- Add a persisted session category for test sessions so result tabs can follow the saved label.
alter table if exists public.test_sessions
add column if not exists session_category text;

-- Backfill existing sessions from the current question-set label when possible.
update public.test_sessions ts
set session_category = coalesce(
  nullif(btrim(ts.session_category), ''),
  nullif(btrim(t.title), ''),
  'Uncategorized'
)
from public.tests t
where t.version = ts.problem_set_id
  and (ts.session_category is null or btrim(ts.session_category) = '');

comment on column public.test_sessions.session_category
  is 'Saved label for a daily test session. Used to group session and result tabs independently from the source SetID category.';
