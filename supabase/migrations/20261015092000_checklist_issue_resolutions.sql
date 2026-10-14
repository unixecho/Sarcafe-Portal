-- The owner's "missing or not working" report groups checklist answers by CHECK (the ice machine, the oat milk),
-- not by form. When the owner marks one handled this records it: reports of that check submitted up to this moment
-- are done, and a report submitted afterwards opens it again. Rows are only ever added, so the table is also the
-- history of what was handled, when and by whom. Service role only, like every checklist table.

create table if not exists public.checklist_issue_resolutions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 100),
  resolved_by uuid references public.staff(id) on delete set null,
  resolved_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 300)
);
create index if not exists checklist_issue_resolutions_item_idx
  on public.checklist_issue_resolutions (branch_id, item_id, resolved_at desc);

alter table public.checklist_issue_resolutions enable row level security;
revoke all on public.checklist_issue_resolutions from public, anon, authenticated;
grant all on public.checklist_issue_resolutions to service_role;
