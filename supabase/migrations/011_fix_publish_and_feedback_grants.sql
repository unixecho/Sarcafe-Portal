-- ============================================================
-- Fixes two confirmed missing-grant/policy bugs, both verified live
-- against the production database (information_schema.role_table_grants,
-- pg_policies) before this migration was written — not guessed from
-- reading the other migrations alone.
--
-- 1. customer_feedback (009_customer_feedback.sql) revokes table access
--    from public/anon/authenticated but — unlike every sibling migration
--    that follows the same "RLS on, zero policies, service-role only"
--    shape (003_rate_limiting.sql, 007_menu_item_availability.sql,
--    010_shift_scheduling.sql) — never grants the table itself to
--    service_role. Confirmed live: service_role had only
--    REFERENCES/TRIGGER/TRUNCATE, no SELECT/INSERT/UPDATE/DELETE. This is
--    exactly the "permission denied for table X" failure DEPLOYMENT.md §2.1
--    already documents happening once before with 004_grants.sql. Root
--    cause of the customer-facing "השליחה נכשלה" error on POST
--    /api/feedback and of "Could not load feedback" in the owner inbox
--    (GET /api/owner/feedback) — both routes read/write this table via
--    createServiceRoleClient().
--
-- 2. publish_menu() (001_menus_schema.sql) is plain plpgsql, NOT
--    SECURITY DEFINER, so its `insert into menu_versions` runs as the
--    CALLER'S OWN `authenticated` session (src/app/api/owner/menu/route.ts
--    calls it via createServerSupabaseClient(), not service role).
--    Confirmed live: `authenticated` had no INSERT grant on menu_versions,
--    and pg_policies showed only a SELECT policy — no RLS policy permitted
--    insert at all. Root cause of "Could not publish menu" (400) on
--    POST /api/owner/menu, while draft-save on the same route succeeded
--    (draft-save only UPDATEs menus.draft, which authenticated already had
--    grant + an RLS policy for). Very likely also the root cause of the
--    stale "יש שינויים בתפריט שלא פורסמו" dashboard signal reported
--    separately — publish was never actually succeeding, so
--    menus.published never caught up to menus.draft for
--    lib/owner/dashboard-stats.ts's JSON.stringify(draft) !==
--    JSON.stringify(published) check to compare against.
-- ============================================================

grant select, insert, update, delete on public.customer_feedback to service_role;

grant insert on public.menu_versions to authenticated;

create policy "menu editors can log their branch's version history"
  on public.menu_versions
  for insert
  to authenticated
  with check (is_menu_editor((select branch_id from public.menus where id = menu_id)));
