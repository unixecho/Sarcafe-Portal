-- Owner-editable per-branch review-wall content. Links already got their
-- own columns in 005_branch_links_and_creation.sql; reviews follow the
-- same "real columns on branches, not a separate table" shape rather than
-- AyekaBar's single app_settings blob, because Sarcafe has two branches
-- with their own quotes, not one venue's.
--
-- Nullable: a branch with no reviews column set falls back to a static
-- placeholder client-side (lib/reviews.ts's normalizeReviews/
-- PLACEHOLDER_BLOCK) rather than rendering an empty wall.

alter table public.branches add column reviews jsonb;

comment on column public.branches.reviews is
  'Owner-curated PortalReviewsBlock ({rating,count,items[]}) shown on the public portal for this branch. Never pulled from Google automatically, by design — the site does not integrate with the Google API. Null falls back to a placeholder client-side.';
