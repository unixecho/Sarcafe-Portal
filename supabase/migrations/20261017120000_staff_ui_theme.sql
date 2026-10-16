-- Each person chooses the look of the staff app (owner, 2026-10-17): five looks, picked when the account is made and changeable
-- from the profile. One nullable text column on staff: null = "never chose" (the default look is drawn and the home asks once).
-- Additive and idempotent. No function, no policy: `staff` has no browser access, and the app writes the column with the service role
-- (POST /api/staff/theme), so nothing here needs a grant. The app also keeps the choice in a cookie and reads this column
-- tolerantly, so it works whether or not this migration has run yet.
alter table public.staff add column if not exists ui_theme text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_ui_theme_check') then
    alter table public.staff add constraint staff_ui_theme_check
      check (ui_theme is null or ui_theme in ('neon', 'glass', 'pass', 'crema', 'latte'));
  end if;
end $$;
