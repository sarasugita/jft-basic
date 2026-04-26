alter table public.absence_applications
  add column if not exists admin_comment text;
