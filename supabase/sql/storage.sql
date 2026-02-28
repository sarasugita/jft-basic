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
