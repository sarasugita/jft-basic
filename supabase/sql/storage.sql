-- Storage bucket + policies for test assets

-- Create bucket (public read)
insert into storage.buckets (id, name, public)
values ('test-assets', 'test-assets', true)
on conflict (id) do update
set public = excluded.public;

-- Public read (needed for public bucket URL access)
drop policy if exists "public read test-assets" on storage.objects;
create policy "public read test-assets"
on storage.objects for select
using (bucket_id = 'test-assets');

-- Super admin is global. School admins remain limited by table RLS on public.test_assets.
drop policy if exists "admin upload test-assets" on storage.objects;
drop policy if exists "staff upload test-assets" on storage.objects;
create policy "staff upload test-assets"
on storage.objects for insert
with check (
  bucket_id = 'test-assets'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('super_admin', 'admin')
  )
);

drop policy if exists "admin update test-assets" on storage.objects;
drop policy if exists "staff update test-assets" on storage.objects;
create policy "staff update test-assets"
on storage.objects for update
using (
  bucket_id = 'test-assets'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('super_admin', 'admin')
  )
);

drop policy if exists "admin delete test-assets" on storage.objects;
drop policy if exists "staff delete test-assets" on storage.objects;
create policy "staff delete test-assets"
on storage.objects for delete
using (
  bucket_id = 'test-assets'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('super_admin', 'admin')
  )
);

-- Profile document uploads live in:
--   test-assets/profile-documents/<student-id>/...
-- Students may manage their own files. Admins/super admins may manage student files they can access.
drop policy if exists "profile documents insert" on storage.objects;
create policy "profile documents insert"
on storage.objects for insert
with check (
  bucket_id = 'test-assets'
  and (storage.foldername(name))[1] = 'profile-documents'
  and (
    (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'student'
      )
    )
    or exists (
      select 1
      from public.profiles target
      where target.id::text = (storage.foldername(name))[2]
        and target.role = 'student'
        and public.current_user_role() in ('super_admin', 'admin')
        and public.can_access_school(target.school_id)
    )
  )
);

drop policy if exists "profile documents update" on storage.objects;
create policy "profile documents update"
on storage.objects for update
using (
  bucket_id = 'test-assets'
  and (storage.foldername(name))[1] = 'profile-documents'
  and (
    (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'student'
      )
    )
    or exists (
      select 1
      from public.profiles target
      where target.id::text = (storage.foldername(name))[2]
        and target.role = 'student'
        and public.current_user_role() in ('super_admin', 'admin')
        and public.can_access_school(target.school_id)
    )
  )
)
with check (
  bucket_id = 'test-assets'
  and (storage.foldername(name))[1] = 'profile-documents'
  and (
    (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'student'
      )
    )
    or exists (
      select 1
      from public.profiles target
      where target.id::text = (storage.foldername(name))[2]
        and target.role = 'student'
        and public.current_user_role() in ('super_admin', 'admin')
        and public.can_access_school(target.school_id)
    )
  )
);

drop policy if exists "profile documents delete" on storage.objects;
create policy "profile documents delete"
on storage.objects for delete
using (
  bucket_id = 'test-assets'
  and (storage.foldername(name))[1] = 'profile-documents'
  and (
    (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'student'
      )
    )
    or exists (
      select 1
      from public.profiles target
      where target.id::text = (storage.foldername(name))[2]
        and target.role = 'student'
        and public.current_user_role() in ('super_admin', 'admin')
        and public.can_access_school(target.school_id)
    )
  )
);
