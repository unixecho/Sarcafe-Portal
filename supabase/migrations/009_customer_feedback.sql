-- ============================================================
-- Customer feedback box — ported from AyekaBar's migration 050, adapted:
--
--   • `branch_slug` replaces AyekaBar's `customer_id` — Sarcafe has no
--     customer accounts at all (no loyalty/login system for visitors), and
--     the owner explicitly wants feedback "divided by branches in the
--     dashboard." Captured client-side from whichever page the widget is
--     mounted on (the branch-picker portal before a branch is chosen has
--     none to send — null in that case).
--   • Retention runs off Sarcafe's own cron mechanism (Vercel Cron hitting
--     a protected API route — see src/app/api/cron/keep-alive/route.ts and
--     vercel.json) rather than pg_cron, which AyekaBar's migration uses and
--     Sarcafe's project does not (confirmed: no other migration here calls
--     cron.schedule). The cleanup FUNCTION is still defined here, service-
--     role only, same as cleanup_rate_limits() in 003_rate_limiting.sql —
--     only the trigger mechanism differs, not the SQL.
--
-- ── SECURITY POSTURE (unchanged from AyekaBar) ───────────────────────
--   • RLS ON, ZERO POLICIES — same shape as menu_audit and rate_limits.
--     Nothing reaches these rows through PostgREST from any role, ever.
--     The only doors are this app's own service-role routes: POST
--     /api/feedback (public, rate-limited, validated) and GET/PATCH
--     /api/owner/feedback (requireOwner()).
--   • GRANTS REVOKED TOO, not just left to RLS — same reasoning
--     004_grants.sql already documents for every other service-role-only
--     table: a policy added later by accident still can't open a table
--     whose grants were never handed out.
--   • NO IP ADDRESS IS STORED — used only transiently for rate limiting
--     (lib/rate-limit.ts, keyed into `rate_limits`, ages out in a day).
-- ============================================================

create table public.customer_feedback (
  id            uuid primary key default gen_random_uuid(),

  category      text not null check (category in ('business','technical')),

  message       text not null check (
                  length(message) between 2 and 1000
                ),

  contact_email text check (contact_email is null or length(contact_email) <= 254),

  -- Same-origin PATH only (never a full URL) — see src/lib/feedback/validate.ts's
  -- normalizePagePath() for why (protocol-relative-URL bypass, etc.). The
  -- CHECK here is the backstop in case the app layer is ever bypassed.
  page_url      text check (
                  page_url is null
                  or (page_url ~ '^/' and page_url !~ '^//' and length(page_url) <= 300)
                ),

  -- Which of the two branches this was sent about, when known. `on delete
  -- set null` (not cascade): removing a branch should not erase feedback
  -- history about it.
  branch_slug   text references public.branches(slug) on delete set null,

  status        text not null default 'new' check (status in ('new','read','resolved')),
  resolved_by   uuid references auth.users(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index customer_feedback_new_idx
  on public.customer_feedback (created_at desc)
  where status = 'new';

create index customer_feedback_recent_idx
  on public.customer_feedback (created_at desc);

create index customer_feedback_branch_idx
  on public.customer_feedback (branch_slug, created_at desc);

comment on table public.customer_feedback is
  'Customer suggestions and bug reports from the portal/menu pages. Written by a public '
  'unauthenticated endpoint (POST /api/feedback, rate-limited); read only by the owner '
  'inbox. RLS on, no policies, no table grants — service role only. No IP is stored.';

alter table public.customer_feedback enable row level security;
revoke all on public.customer_feedback from public, anon, authenticated;

-- ---- Retention ---------------------------------------------------------
-- Same two-window split AyekaBar's migration documents: contact_email is
-- identifying and useful only for as long as the owner might reply, so it
-- clears first; the feedback text itself is business content worth a
-- longer window before deletion outright.
create or replace function public.cleanup_customer_feedback(
  p_email_months  integer default 12,
  p_delete_months integer default 24
)
returns table (emails_cleared integer, rows_deleted integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cleared integer;
  v_deleted integer;
begin
  with cleared as (
    update public.customer_feedback
       set contact_email = null
     where contact_email is not null
       and created_at < now() - make_interval(months => p_email_months)
    returning 1
  )
  select count(*) into v_cleared from cleared;

  with gone as (
    delete from public.customer_feedback
     where created_at < now() - make_interval(months => p_delete_months)
    returning 1
  )
  select count(*) into v_deleted from gone;

  return query select v_cleared, v_deleted;
end;
$function$;

revoke execute on function public.cleanup_customer_feedback(integer, integer) from public;
grant execute on function public.cleanup_customer_feedback(integer, integer) to service_role;

-- ---- The off switch ------------------------------------------------------
-- Public read (the signed-out portal/menu pages decide whether to render
-- the button); only `is_public` touched on conflict, so re-running this
-- migration can never silently re-enable a box the owner turned off.
insert into public.app_settings (key, value, is_public) values
  ('customer_feedback_enabled', 'true'::jsonb, true)
on conflict (key) do update set is_public = true;
