# 10 — Mandatory Sarcafe Glisse design contract

The user reiterated on 2026-11-11: **all design must use the Glisse skill in the way Sarcafe was designed**. This applies to every new identity, organization, registration, scanner, benefits, Wallet, loyalty and administration screen, including error/empty/loading/confirmation states. It is not permission to redesign the existing customer website or Ayeka Bar.

## Skill and source precedence

Locate and read the actual Glisse skill available in Claude's environment and report its path/version. No dedicated Glisse `SKILL.md` was found among the inspected laptop's installed skills. Do not fabricate a skill path, claim it was applied, or install an unrelated visual library as a substitute. If absent in Claude too, report the missing skill before beginning UI implementation; backend work can follow its own gates. This document is a **project design contract**, not a claim that a Glisse skill was installed.

Read `CLAUDE.md`, `docs/SARCAFE_GLASS_UI.md`, `docs/SARCAFE_GLASS_UI_STYLE.md`, and the actual shared components. The user's latest requirements and Sarcafe-specific established patterns override generic skill examples. Existing shared components are the design system; do not generate a separate mockup system.

## Required implementation patterns

- Glisse remains pinned at the repository's 0.5.0 unless a separately justified compatibility change is reviewed. No Framer Motion, GSAP use in new features, React Spring, Motion One, or new motion/design library. Existing GSAP-backed screens are a baseline fact, not a pattern to copy or an excuse for a global rewrite.
- Use `GlassDashboardShell` / `GlassPage`; import shared glass styles as established. Keep the top bar, logo/branch/bell/account structure and existing dashboard categories intact.
- Reuse the account menu's signature design: Glisse `Menu` from an icon, `.gl-pop` otherwise; no generic browser select/popover skin for new UI. Preserve row non-shrink and scrolling with long content.
- One orange `Pill`/`.gl-pill` language for real counts/states. Green success (`--gl-ok`), red error (`--gl-bad`), neutral theme accent. Include text/icon so color is not the only signal. Use `glassToast` with the correct tone.
- Use `Seg` and `GlassDock`, never raw Glisse `SegmentedControl` / `TabBar` directly. Preserve RTL item reversal and `--lg-tab-width` sizing. Hebrew is RTL; times/codes use deliberate bidi isolation.
- `DockHost` stays in the owner/staff layouts, never duplicated per page. Add tool entries with roles matching middleware and API capability guards; branch selection is display context, never authority.
- Add page-shaped `loading.tsx`; use `GlassSkeleton` and `.sk` blocks. Stream data fields behind Suspense where appropriate; do not blank the entire stable shell. Preserve router freshness behavior after saves.
- Static cards use `.gl-surf`; avoid a Glisse SVG filter per member row/photo. Use real glass only where existing controls use it. Preserve `GlassMotion`, scroll blur fallback and `settleGlass()` on appropriate switches.
- Honor all five looks, reduced motion, touch target accessibility, keyboard/focus behavior, iPhone safe areas and bottom-bar/dock clearance. No hardcoded dark theme or untested generic animation.
- Private photos/QRs are functional verification content, not animated decoration. Do not keep them in transitions/caches after timeout or next-person actions. Stop camera/decode work when hidden.

## Plain-JS kiosk boundary

The native kiosk is a vanilla JS/HTML WebView bundle, not a React app. Existing `kiosk-admin.css` mirrors the house glass look without importing Glisse React. Preserve that architecture and its existing motion/reset machinery. For FABLE-010 use existing visual tokens/styles and simple existing interactions; **add no new animation engine or React/Glisse bundle to the tablet**. Any new animated kiosk UI requiring literal Glisse runtime support is a design decision to return for review, not license to rebuild the kiosk. All React portal surfaces use the actual shared Glisse components.

Wallet pass artwork uses provider formats and cannot execute Glisse. Match approved Sarcafe branding, typography hierarchy and readable color treatment within provider constraints; the web issuance/admin flows use Glisse. Do not claim native Wallet cards run a React motion library.

## Acceptance evidence

For every UI task: skill reference; list of reused shared components; screenshots of meaningful states in five looks with synthetic data; Hebrew RTL and applicable en/ar layouts; phone/tablet widths; safe-area and long-menu checks; reduced-motion behavior; no new animation imports; no horizontal overflow; camera/photo cleanup; measured performance under the existing QA setup. Codex compares against the current Sarcafe components, not merely the word “glass” in a screenshot description.
