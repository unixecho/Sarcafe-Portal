# SarCafe — Phase 1 Plan (Portal + Dashboard + Menu Versioning + Login)

Supersedes the "design fresh" direction in `SARCafe-ARCHITECTURE-AUDIT.md` §7 for the pieces AyekaBar already solved well. Source: a full read of [unixecho/AyekaBar](https://github.com/unixecho/AyekaBar) (auth, owner dashboard, menu versioning, design system, accessibility widget, RBAC/schema — 48 migrations read in full).

## Decision: what's mirrored, what's adapted, what's excluded

| From AyekaBar | Sarcafe treatment |
|---|---|
| Google OAuth via Supabase Auth, single `/login` door for everyone, role resolved post-auth from a `staff` table (`role`/`badge`), `claim_staff_invite()` linking pre-created invites to a Google account on first sign-in | **Mirrored as-is.** This is the exact model requested. |
| `AuthHandoff` two-step reveal, focus-trapped, `/no-access` page, safe-redirect callback | **Mirrored as-is** (copy verbatim, restyle to Sarcafe branding/copy). |
| Owner dashboard: hub-and-spoke (no sidebar/tabs), `OwnerHeader` + back-chevron chain, poll-every-30s `DashboardLive`, `known`-flagged stats (never conflate "zero" with "couldn't read it"), skeleton loading matching real geometry pixel-for-pixel | **Mirrored as-is**, content simplified: no floor/waiter/shift/loyalty signals (Sarcafe has none of those systems) — dashboard ships with a branch switcher + a small stat set (menu published/unpublished, items out of stock) + the nav tile grid to Menu Editor/Staff/Accessibility. More tiles land when Phase 2+3 (orders/POS) exists. |
| iOS-style page-push transitions (`viewTransition.ts` + `PageTransitions.tsx` + `template.tsx`, View Transitions API, `prefers-reduced-motion` respected) | **Ported verbatim** — zero AyekaBar-specific logic in any of the three files. |
| Menu system: `menus` (draft/published JSONB), `menu_versions` (publish-history snapshots), `menu_variants` (named/scheduled subsets via **exclusion lists**, `active_variant_id` vs `is_default`), Happy-Hour-style pattern available but not needed yet | **Mirrored, made branch-aware.** Sarcafe's two branches are **two separate `menus` rows** (`slug = 'maor'`, `slug = 'givat-haviva'`) — matching what the current site already does, and requiring zero change to the exclusion/variant/publish mechanics (they're already per-`menu_id`). Every API route/page gets a `branch` param that AyekaBar hardcoded as `MENU_SLUG`. |
| Design tokens, sheet/dialog system (`ModalPortal`, `SheetShell`, `ConfirmSheet`, `PromptSheet`), wheel picker (`WheelPicker`/`TimeWheel`), haptics, `.press`/`.rise` motion vocabulary, `data-*`-attribute state styling | **Ported verbatim** where generic (haptics.ts, ModalPortal, sheet CSS shell, wheel picker mechanics), **recolored** to Sarcafe's own palette (see tokens below) rather than AyekaBar's orange/cyan bar-neon look — reusing a nightclub-bar palette on a coffee truck would be a branding mismatch, not a UX one, so only the *mechanics* (radii, shadows, easing, sheet geometry, focus-trap behavior) are copied 1:1. |
| Accessibility widget (`components/a11y/*`, `lib/a11y/*`) — font scale, spacing, contrast/grayscale/invert (scoped `filter`, never on `<html>`), pause-animations, reading guide, highlight-links/headings, big cursor; persisted to `localStorage`, no TTL | **Ported, generalized.** AyekaBar's own report flags this as "not portable as-is" — it hardcodes AyekaBar's CSS variable names and depends on `SheetShell`. Since we're porting `SheetShell` too and reusing the same token *names* (just different values), this mostly resolves itself; the one real change is genericizing the copy/branding and confirming the `#a11y-scope` wrapper rule (all fixed/portalled chrome must live outside it) holds for Sarcafe's layout too. |
| Accessibility **statement** page/editor (legal IS 5568 text, owner CMS) | **Ported**, copy rewritten for Sarcafe (still Israeli IS 5568 / WCAG 2.2 AA target — same legal requirement applies). |
| Rate limiting (`rate_limits` table, atomic `check_rate_limit()` RPC, fail-open posture, explicit `revoke ... from public` on every `SECURITY DEFINER` function) | **Mirrored as-is** — this is exactly the pattern Phase 2/3's recovery-code/QR endpoints will need later, so it's worth having in place now. |
| `app_settings` generic key-value table, `is_public` RLS, Next.js data-cache-tagged reads | **Mirrored**, with a note: any Sarcafe setting that must differ per branch uses a composite key (`key:branchSlug`) — AyekaBar never needed this since it has one venue. |
| Waiter/floor-plan/table system, shift scheduling, loyalty/QR check-ins, bar-tab/pool-session features | **Excluded from Phase 1 entirely.** These are AyekaBar's bar-specific operational modules (table service, seating, shift dispatch) — Sarcafe is a walk-up food-truck counter with no seating to manage. None of this is requested and adding it would violate "don't overengineer." Phase 2+3's order/kitchen/QR/push system is a different, new build (see `SARCafe-ARCHITECTURE-AUDIT.md`), not a AyekaBar port. |
| `staff` table (global, no location column) | **Adapted, not mirrored as-is.** AyekaBar's own audit flags this as the one real conflict with multi-branch. Sarcafe's `staff.branch_id` is nullable: `null` = owner/all-branch access, a real branch id = scoped to that branch only. `isOp()`/`canEditMenu()` gain a branch parameter; an owner passes any branch, a branch-scoped editor only their own. |

## Design tokens (Sarcafe palette, AyekaBar's mechanics)

Same variable *names* AyekaBar's ported components already expect (so `SheetShell`/`WheelPicker`/the a11y widget need zero rewiring), Sarcafe's own values:

```css
:root {
  --bg:            #150f0c;  /* near-black coffee, replaces AyekaBar's #0a0a0f */
  --bg-elev:       #221712;  /* cards/sheets level 1, replaces #141420 */
  --bg-elev-2:     #2e1f18;  /* sheets/popovers level 2, replaces #1d1d2b */
  --neon:          #ff7a45;  /* Sarcafe amber-orange (crema/roast), replaces AyekaBar's #ff5e3a red-orange */
  --neon-soft:     #ffab7a;
  --neon-2:        #57d9c0;  /* teal-mint info/secondary accent, replaces AyekaBar's cyan #38e1ff */
  --text:          #fdf6ec;  /* warm cream — close to the current site's #fff8ea, kept for continuity */
  --text-dim:      #b9ada0;  /* checked 4.5:1 on --bg-elev, same discipline as AyekaBar's audit */
  --text-faint:    #9c9086;
  --line:              rgba(253,246,236,0.08);
  --line-strong:       rgba(253,246,236,0.14);
  --line-interactive:  rgba(253,246,236,0.4);   /* clears WCAG 1.4.11 3:1 non-text contrast */
  --glow:          0 0 24px rgba(255,122,69,0.45);
  --ease:          cubic-bezier(0.22,1,0.36,1); /* AyekaBar's single travel-motion curve, kept exactly */
  --spring:        cubic-bezier(0.34,1.56,0.64,1); /* promoted to a token (AyekaBar left this un-tokenized) */
}
```
Radii: `--radius-sm:12px; --radius-md:16px; --radius-lg:22px; --radius-xl:28px;` (merges the original Sarcafe site's scale with AyekaBar's). Tap targets: `--tap-min:52px` (the original site's already-more-generous floor, kept — it also happens to suit Phase 2/3's tablet POS better than the WCAG 44px minimum). Font: **Heebo + Noto Sans Arabic** (kept from the current site, not switched to AyekaBar's Rubik) — Sarcafe's existing trilingual pairing is a deliberate brand-continuity choice, not an oversight. No light mode, matching AyekaBar's single-committed-dark-theme approach (revisit only if requested).

## Schema (Supabase, new project `moiunkugxgsgbdokaxbr`)

```sql
-- Branches (new — AyekaBar has no equivalent; closest precedent is its venues table)
branches (id uuid pk, slug text unique, name jsonb, timezone text default 'Asia/Jerusalem', active boolean default true)
  seed: ('maor','givat-haviva')

-- Staff (mirrors AyekaBar's role/badge model, adds branch scoping)
staff (
  id uuid pk, auth_user_id uuid unique references auth.users, email text,
  first_name text, last_name text, display_name text,
  role text check (role in ('staff','owner')) default 'staff',
  badge text,                      -- owner | general_manager | manager | barista | cook | free text
  branch_id uuid references branches(id),  -- NULL = all branches (owner-level)
  active boolean default true,     -- soft delete, mirrors AyekaBar 041
  invited_at timestamptz, claimed_at timestamptz,
  created_at timestamptz default now()
)

-- Menus (mirrors AyekaBar's 000 schema exactly — already multi-row-capable)
menus (id uuid pk, branch_id uuid references branches(id) unique, slug text unique,
  name jsonb, draft jsonb default '{"categories":[]}', published jsonb default '{"categories":[]}',
  active_variant_id uuid, updated_at timestamptz default now(), published_at timestamptz)

menu_versions (id bigint identity pk, menu_id uuid references menus(id), data jsonb,
  published_by uuid references auth.users, created_at timestamptz default now())

menu_variants (id uuid pk, menu_id uuid references menus(id), name jsonb,
  excluded_uids text[] default '{}', is_default boolean default false, sort_order int,
  schedule_enabled boolean default false, schedule_days smallint[] default '{}',
  schedule_start text, schedule_end text, active_until timestamptz,
  expire_action text check (expire_action in ('revert','delete')) default 'revert',
  created_at timestamptz default now(), updated_at timestamptz default now())
  -- unique partial index: one is_default=true per menu_id

menu_audit (id uuid pk, actor_id uuid references auth.users, actor_name text, actor_email text,
  action text, summary text, detail jsonb, created_at timestamptz default now())  -- service-role only

-- Settings (mirrors AyekaBar's 007 exactly)
app_settings (key text pk, value jsonb, is_public boolean default false,
  updated_at timestamptz default now(), updated_by uuid references auth.users)
  -- branch-specific settings use key = '<name>:<branch_slug>'

-- Rate limiting (mirrors AyekaBar's 045 exactly — needed now for login/menu APIs, and again in Phase 2/3 for recovery codes)
rate_limits (key text pk, window_start timestamptz, count int)
-- check_rate_limit(p_key, p_max, p_window_seconds) — atomic INSERT ... ON CONFLICT, revoked from PUBLIC/anon/authenticated

-- Views (public-safe projections, mirrors AyekaBar's pattern)
public_menus, public_menu_variants  -- anon-read, never expose draft/owner columns
public_staff  -- anon-safe team-page projection (no email/auth_user_id)
```

RLS/authorization mirrors AyekaBar exactly: `is_op()` / `is_menu_editor()` / `is_staff()` SQL functions with branch-aware variants (`is_op(branch_id)` etc.), every `SECURITY DEFINER` function has `revoke execute ... from public, anon, authenticated` applied explicitly (migrations 043/044's lesson — Postgres grants `EXECUTE` to `PUBLIC` by default and revoking `anon`/`authenticated` alone is cosmetic).

## File plan (Next.js App Router)

```
src/
  app/
    login/page.tsx                 -- mirrors AyekaBar's /login structure, Sarcafe branding
    no-access/page.tsx
    auth/callback/route.ts
    api/auth/signout/route.ts
    api/owner/dashboard/route.ts
    api/owner/menu-variants/route.ts
    api/owner/settings/route.ts
    owner/
      page.tsx                     -- redirect('/login'), same as AyekaBar
      dashboard/{page.tsx,loading.tsx}
      editor/{page.tsx,loading.tsx}
      staff/page.tsx
      accessibility/page.tsx
    menu/[branch]/{page.tsx,loading.tsx}   -- public menu, branch in the URL (AyekaBar had one hardcoded slug)
    accessibility/page.tsx         -- public IS 5568 statement
    layout.tsx, template.tsx, globals.css
  components/
    OwnerHeader.tsx, OwnerHeaderSkeleton.tsx, PageTransitions.tsx
    DashboardLive.tsx, StatStrip.tsx, DashboardDetailLists.tsx
    MenuEditor.tsx, MenuVersionBar.tsx, MenuView.tsx, VariantWizard.tsx, TempMenuSheet.tsx
    ModalPortal.tsx, SheetShell.tsx, ConfirmSheet.tsx, PromptSheet.tsx, Switch.tsx, WheelPicker.tsx, TimeWheel.tsx
    AuthHandoff.tsx, SignOutButton.tsx
    a11y/{A11yLauncher,A11yPanel,A11yProvider,A11yWidget,ReadingGuide}.tsx, a11y.css
  lib/
    supabase/{client.ts,server.ts}
    nav/viewTransition.ts
    haptics.ts
    staff/{access.ts,guard.ts,badges.ts}
    owner/guard.ts
    menu/{types.ts,fetch.ts,client.ts,variants.ts}
    a11y/{types.ts,apply.ts,storage.ts,i18n.ts}
    settings/{keys.ts,server.ts}
    rate-limit.ts
  middleware.ts
supabase/migrations/*.sql
```

## Google OAuth setup (you)

Supabase's Google provider needs a Google Cloud OAuth client. Once you've created it (per your earlier answer):
1. Authorized JavaScript origin: your Vercel production URL (+ any preview domains you want to allow) and `http://localhost:3000` for local dev.
2. Authorized redirect URI: `https://moiunkugxgsgbdokaxbr.supabase.co/auth/v1/callback` (Supabase's fixed callback — not the app's own `/auth/callback`, which is separate and needs no Google-side entry).
3. Paste the Client ID + Secret into Supabase Dashboard → Authentication → Providers → Google.

## Status (2026-09-11)

Built and verified (`tsc --noEmit` + `next build` pass clean) on `rewrite/nextjs-ayekabar-style`:
- Portal (`/`, branch picker + real nav/Instagram/review/Bit-payment links migrated from the legacy site)
- Auth: `/login` + `AuthHandoff`, `/no-access`, `/auth/callback`, signout
- Owner dashboard (branch-aware stats + signals, nav tile grid)
- Menu editor + full versioning (draft/publish, named/scheduled variants, out-of-stock panel)
- Public `/menu/[branch]` (accordion, live-poll for publish changes, language switch)
- Accessibility statement (`/accessibility` public + `/owner/accessibility` editor)
- Staff management (`/owner/staff` — invite, role/badge/branch assignment, deactivate)
- Full SQL schema staged in `supabase/migrations/`, not yet applied

**Caught and fixed during this pass:** `/menu/[branch]` originally paired `generateStaticParams` with `dynamic = 'force-dynamic'` — Next.js prerenders listed params at *build* time regardless of that export, which would have frozen the public menu at whatever (empty) state existed during the build, permanently, until the next deploy. Removed `generateStaticParams`; the route is now genuinely per-request dynamic.

**Deliberately deferred**, each noted in code comments where it matters:
- The AyekaBar-style accessibility **widget** (visitor-facing font-scale/contrast-mode/reading-guide/big-cursor panel) — baseline WCAG 2.2 AA work (semantics, focus management, contrast tokens, keyboard operability, reduced-motion, non-color status, 52px tap targets) is built into every component from the start; this widget is an additive convenience layer on top, not a compliance gap, and deserves its own careful pass rather than being rushed in at the end of this one.
- Custom iOS `WheelPicker`/`TimeWheel` — `TempMenuSheet` uses native `datetime-local`/`time` inputs instead (fully accessible and correct; the wheel's tactile feel is cosmetic polish).
- `menu_audit` logging — the table and RLS exist; no code path writes to it yet.
- Real contact phone number on `/no-access` — intentionally not invented as a placeholder.
- Real brand assets (logo/background/favicon) — still literally placeholders; carried over as a known gap from the original audit.
- Automated tests (Phase 27 of the master prompt) — not started.

## Still blocked on

The `supabase` MCP connector shows `needs_auth` — authorize it with `/mcp` in an interactive Claude Code session before any migration can actually run against `moiunkugxgsgbdokaxbr`. Everything else in this plan (app scaffold, config, design tokens, SQL files staged in the repo) can proceed without it.
