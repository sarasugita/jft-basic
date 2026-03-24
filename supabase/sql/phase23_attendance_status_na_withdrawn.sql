alter table public.attendance_entries
  drop constraint if exists attendance_entries_status_check;

alter table public.attendance_entries
  add constraint attendance_entries_status_check
  check (status in ('P', 'L', 'E', 'A', 'N/A', 'W'));
