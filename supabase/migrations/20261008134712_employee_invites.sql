-- Employee setup links and verified Google binding. Raw bearer tokens never enter Postgres.
-- All functions are service-only: actor/session verification belongs to guarded server routes.
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  created_by uuid references public.staff(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expected_auth_user_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  consumed_at timestamptz,
  revoked_at timestamptz
);
create index staff_invitations_staff_idx on public.staff_invitations(staff_id, created_at desc);
create index staff_invitations_actor_idx on public.staff_invitations(created_by) where created_by is not null;

create table public.staff_google_link_intents (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  staff_id uuid not null references public.staff(id) on delete cascade,
  expected_auth_user_id uuid,
  pin_hash_snapshot text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  revoked_at timestamptz
);
create index staff_google_link_intents_staff_idx on public.staff_google_link_intents(staff_id, expires_at desc);
alter table public.staff_invitations enable row level security;
alter table public.staff_google_link_intents enable row level security;
revoke all on public.staff_invitations, public.staff_google_link_intents from public, anon, authenticated;
grant all on public.staff_invitations, public.staff_google_link_intents to service_role;

create function public.staff_create_invitation(p_actor uuid, p_staff uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff%rowtype; expiry timestamptz := now() + interval '7 days';
begin
  if not exists (select 1 from public.staff where id = p_actor and active and (role = 'owner' or badge = 'owner')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into s from public.staff where id = p_staff and active for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(trim(s.first_name), '') = '' or coalesce(trim(s.last_name), '') = '' or s.employee_no is null then
    return jsonb_build_object('ok', false, 'reason', 'profile_incomplete');
  end if;
  update public.staff_invitations set revoked_at = now() where staff_id = p_staff and revoked_at is null and consumed_at is null;
  insert into public.staff_invitations(staff_id, created_by, token_hash, expected_auth_user_id, expires_at)
  values (p_staff, p_actor, p_token_hash, s.auth_user_id, expiry);
  perform public.staff_log(p_actor, p_staff, 'staff.invite', 'יצר/ה קישור להגדרת החשבון', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'expires_at', expiry);
end $$;

create function public.staff_revoke_invitation(p_actor uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.staff where id = p_actor and active and (role = 'owner' or badge = 'owner')) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform 1 from public.staff where id = p_staff for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.staff_invitations set revoked_at = now() where staff_id = p_staff and revoked_at is null and consumed_at is null;
  update public.staff_google_link_intents set revoked_at = now() where staff_id = p_staff and revoked_at is null and consumed_at is null;
  perform public.staff_log(p_actor, p_staff, 'staff.invite_revoke', 'ביטל/ה קישורי הגדרת חשבון שטרם נוצלו', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create function public.staff_inspect_invitation(p_token_hash text)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('ok', true, 'name', public.sched_name(s.id), 'employee_no', s.employee_no, 'expires_at', i.expires_at)
  from public.staff_invitations i join public.staff s on s.id = i.staff_id
  where i.token_hash = p_token_hash and i.revoked_at is null and i.consumed_at is null and i.expires_at > now()
    and s.active and s.auth_user_id is not distinct from i.expected_auth_user_id), jsonb_build_object('ok', false));
$$;

-- Staff lock precedes token lock everywhere, so regeneration and redemption cannot race.
-- PIN, invitation consumption, the first session and link proof are committed together.
create function public.staff_complete_invitation(p_token_hash text, p_pin text, p_session_hash text, p_link_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare i public.staff_invitations%rowtype; s public.staff%rowtype; target uuid;
begin
  select staff_id into target from public.staff_invitations where token_hash = p_token_hash;
  if target is null then return jsonb_build_object('ok', false, 'reason', 'invalid_invite'); end if;
  select * into s from public.staff where id = target for update;
  select * into i from public.staff_invitations where token_hash = p_token_hash for update;
  if not s.active or i.revoked_at is not null or i.consumed_at is not null or i.expires_at <= now()
    or s.auth_user_id is distinct from i.expected_auth_user_id then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then return jsonb_build_object('ok', false, 'reason', 'invalid_pin'); end if;
  if public.pos_pin_is_weak(p_pin) then return jsonb_build_object('ok', false, 'reason', 'weak_pin'); end if;
  if p_session_hash !~ '^[a-f0-9]{64}$' or p_link_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.staff set pin_hash = crypt(p_pin, gen_salt('bf', 8)), pin_set_at = now() where id = target returning * into s;
  update public.staff_employee_sessions set revoked_at = now() where staff_id = target and revoked_at is null;
  insert into public.staff_employee_sessions(token_hash, staff_id, expires_at) values(p_session_hash, target, now() + interval '30 days');
  insert into public.staff_google_link_intents(token_hash, staff_id, expected_auth_user_id, pin_hash_snapshot)
  values(p_link_hash, target, s.auth_user_id, s.pin_hash);
  update public.staff_invitations set consumed_at = now() where id = i.id;
  perform public.staff_log(target, target, 'staff.onboard', 'הגדיר/ה קוד כניסה אישי', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'name', public.sched_name(s.id), 'employee_no', s.employee_no, 'has_google', s.auth_user_id is not null);
end $$;

-- Existing employees may prove the current PIN to link Google later, on the same record.
create function public.staff_prepare_google_link(p_staff uuid, p_pin text, p_link_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare s public.staff%rowtype;
begin
  select * into s from public.staff where id = p_staff and active for update;
  if not found or s.pin_hash is null or coalesce(p_pin, '') !~ '^[0-9]{6}$' then return jsonb_build_object('ok', false); end if;
  if s.pin_hash <> crypt(p_pin, s.pin_hash) then return jsonb_build_object('ok', false); end if;
  update public.staff_google_link_intents set revoked_at = now() where staff_id = p_staff and consumed_at is null and revoked_at is null;
  insert into public.staff_google_link_intents(token_hash, staff_id, expected_auth_user_id, pin_hash_snapshot)
  values(p_link_hash, p_staff, s.auth_user_id, s.pin_hash);
  return jsonb_build_object('ok', true);
end $$;

create function public.staff_google_link_ready(p_token_hash text)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.staff_google_link_intents i join public.staff s on s.id = i.staff_id
  where i.token_hash = p_token_hash and i.revoked_at is null and i.consumed_at is null and i.expires_at > now()
    and s.active and s.pin_hash = i.pin_hash_snapshot and s.auth_user_id is not distinct from i.expected_auth_user_id);
$$;

create function public.staff_finish_google_link(p_token_hash text, p_auth_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.staff_google_link_intents%rowtype; s public.staff%rowtype; target uuid; verified_email text;
begin
  select staff_id into target from public.staff_google_link_intents where token_hash = p_token_hash;
  if target is null then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  select * into s from public.staff where id = target for update;
  select * into i from public.staff_google_link_intents where token_hash = p_token_hash for update;
  if not s.active or i.revoked_at is not null or i.consumed_at is not null or i.expires_at <= now()
    or s.pin_hash is distinct from i.pin_hash_snapshot or s.auth_user_id is distinct from i.expected_auth_user_id then
    return jsonb_build_object('ok', false, 'reason', 'invalid_link');
  end if;
  -- Only Auth's server-controlled provider metadata and confirmed email are trusted.
  select lower(email) into verified_email from auth.users where id = p_auth_user and email_confirmed_at is not null
    and (raw_app_meta_data ->> 'provider' = 'google' or raw_app_meta_data -> 'providers' @> '["google"]'::jsonb);
  if verified_email is null then return jsonb_build_object('ok', false, 'reason', 'unverified_google'); end if;
  if s.auth_user_id is not null and s.auth_user_id <> p_auth_user then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;
  if exists(select 1 from public.staff where id <> target and (auth_user_id = p_auth_user or lower(email) = verified_email)) then
    return jsonb_build_object('ok', false, 'reason', 'account_conflict');
  end if;
  begin
    update public.staff set auth_user_id = p_auth_user, email = verified_email, claimed_at = coalesce(claimed_at, now()) where id = target;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'account_conflict');
  end;
  update public.staff_google_link_intents set consumed_at = now() where token_hash = p_token_hash;
  perform public.staff_log(target, target, 'staff.google_link', 'קישר/ה חשבון Google מאומת', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'staff_id', target);
end $$;

create function public.staff_invalidate_setup_tokens()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not new.active then
    update public.staff_invitations set revoked_at = now() where staff_id = new.id and consumed_at is null and revoked_at is null;
  end if;
  if not new.active or new.pin_hash is distinct from old.pin_hash or new.auth_user_id is distinct from old.auth_user_id then
    update public.staff_google_link_intents set revoked_at = now() where staff_id = new.id and consumed_at is null and revoked_at is null;
  end if;
  return new;
end $$;
create trigger staff_invalidate_setup_tokens after update of active, pin_hash, auth_user_id on public.staff
  for each row execute function public.staff_invalidate_setup_tokens();

-- New setup links require the browser-held PIN proof before Google binding.
-- Retain email matching only for older records that never entered this flow.
create or replace function public.claim_staff_invite()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare verified_user uuid; verified_email text;
begin
  select id, lower(email) into verified_user, verified_email from auth.users
  where id = auth.uid() and email_confirmed_at is not null
    and (raw_app_meta_data ->> 'provider' = 'google' or raw_app_meta_data -> 'providers' @> '["google"]'::jsonb);
  if verified_user is null or verified_email is null then return; end if;
  update public.staff s set auth_user_id = verified_user, claimed_at = now()
  where lower(s.email) = verified_email and s.auth_user_id is null and s.active
    and not exists(select 1 from public.staff_invitations i where i.staff_id = s.id);
end $$;
revoke all on function public.claim_staff_invite() from public, anon;
grant execute on function public.claim_staff_invite() to authenticated;

revoke all on function public.staff_create_invitation(uuid,uuid,text), public.staff_revoke_invitation(uuid,uuid),
  public.staff_inspect_invitation(text), public.staff_complete_invitation(text,text,text,text),
  public.staff_prepare_google_link(uuid,text,text), public.staff_google_link_ready(text), public.staff_finish_google_link(text,uuid),
  public.staff_invalidate_setup_tokens() from public, anon, authenticated;
grant execute on function public.staff_create_invitation(uuid,uuid,text), public.staff_revoke_invitation(uuid,uuid),
  public.staff_inspect_invitation(text), public.staff_complete_invitation(text,text,text,text),
  public.staff_prepare_google_link(uuid,text,text), public.staff_google_link_ready(text), public.staff_finish_google_link(text,uuid) to service_role;
