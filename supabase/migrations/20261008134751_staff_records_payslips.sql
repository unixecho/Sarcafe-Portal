-- Employee documents stay private; guarded server routes authorize every read.
create table public.staff_payslips (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  pay_month date not null check (extract(day from pay_month) = 1),
  object_path text not null unique,
  file_name text not null,
  content_type text not null check (content_type in ('application/pdf','image/png','image/jpeg')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 4194304),
  uploaded_by uuid references public.staff(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index staff_payslips_history_idx on public.staff_payslips(staff_id, pay_month desc, uploaded_at desc);
create index staff_payslips_uploader_idx on public.staff_payslips(uploaded_by);
alter table public.staff_payslips enable row level security;
revoke all on public.staff_payslips from public, anon, authenticated;
grant all on public.staff_payslips to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-payslips', 'staff-payslips', false, 4194304, array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Restrictive policies protect this bucket even if an unrelated permissive storage
-- policy is added later. Only the service role may mint a short-lived download.
create policy staff_payslips_browser_deny on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'staff-payslips') with check (bucket_id <> 'staff-payslips');
