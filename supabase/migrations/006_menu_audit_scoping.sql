-- ============================================================
-- Menu audit — branch/menu scoping columns.
--
-- `menu_audit` (001_menus_schema.sql) has existed since day one but has no
-- code path writing to it: it was created ahead of the feature, not with
-- it, and carries no scoping column — every row would be unattributable to
-- a branch. Real logging lands in this pass (POST /api/owner/menu for
-- save/publish, PATCH/POST/DELETE /api/owner/menu-variants for variant
-- changes), so before any row is written, it needs somewhere to point.
--
-- Nullable: a handful of future audit actions (e.g. staff changes) may
-- never have been menu-scoped to begin with, and retrofitting NOT NULL
-- onto an append-only table with unattributed legacy rows (there are none
-- today, but the column exists for the general case) is the wrong
-- direction to lock in this early.
-- ============================================================

alter table public.menu_audit
  add column menu_id uuid references public.menus(id) on delete cascade,
  add column branch_id uuid references public.branches(id) on delete cascade;

create index menu_audit_branch_created_idx
  on public.menu_audit (branch_id, created_at desc);

comment on column public.menu_audit.branch_id is
  'Which branch this action affected. Nullable for any future non-menu-scoped audit action.';
comment on column public.menu_audit.menu_id is
  'Which menus row this action affected, if any.';
