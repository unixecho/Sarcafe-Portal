-- Lightweight self-selected staff identity for schedules. Profile-photo
-- storage can replace this later without changing existing assignments.
alter table public.staff
  add column if not exists avatar_emoji text;

alter table public.staff
  drop constraint if exists staff_avatar_emoji_length;

alter table public.staff
  add constraint staff_avatar_emoji_length
  check (avatar_emoji is null or char_length(avatar_emoji) between 1 and 8);

comment on column public.staff.avatar_emoji is
  'Optional emoji selected by the employee for schedule/profile avatars.';
