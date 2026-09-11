-- Generic owner-toggleable settings store. Mirrors AyekaBar's
-- app_settings (migration 007) exactly. Any Sarcafe setting that must
-- differ per branch uses a composite key, `'<name>:<branch-slug>'` — e.g.
-- 'happy_hour:maor' — rather than adding a branch_id column, since most
-- settings (accessibility statement, feature flags) are shared across both
-- branches and only a few would ever need to diverge.

create table public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  is_public  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

-- Rows default is_public = false (opt-in exposure) — a blanket
-- `using (true)` would leak a setting the moment it's inserted, before
-- anyone remembers to mark it public.
create policy "public settings are readable by anyone"
  on public.app_settings for select
  using (is_public);

-- No write policy at all — every write goes through a service-role owner
-- API route (POST/PATCH /api/owner/settings) gated by requireOwner().

insert into public.app_settings (key, value, is_public) values
  ('accessibility_statement', '{}'::jsonb, true),
  ('menu_cart_enabled', 'true'::jsonb, true);
