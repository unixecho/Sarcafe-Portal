-- Kiosk devices (owner, 2026-11-04): each physical kiosk tablet is a row, linked to ONE branch.
--
-- Until now the kiosk was pinned to Givat Haviva in code. A device row says which branch a tablet belongs to, holds the
-- settings its control panel (and the owner's page) change, and records what the tablet last reported about itself, so
-- more tablets, for more branches, are another row instead of another code change.
--
--   * kiosk_devices            slug (what the tablet calls itself), name, branch_id, the sparse `settings` overrides (only
--                              what someone changed; everything else follows the built-in defaults), and the last report:
--                              when it was seen, battery level and charging, app and page versions, and the state of the
--                              battery alerts.
--
-- Functions (service role only, one signature each, never overloaded):
--   kiosk_device_alert_test()  the control panel's "send a test alert": one alert marked "(בדיקה)" to each developer, so the
--                              path (database, bell, push) can be checked without waiting for a battery to run down.
--                              At most 5 test alerts per person per hour.
--   kiosk_device_report()      what the tablet sends every few minutes: records it, and when the battery has fallen below
--                              the device's alert level while NOT charging, writes ONE alert for each active developer
--                              ('dev.kiosk_battery': the developer's bell and push only, never an owner's). It alerts once per
--                              fall: the alert is armed again by charging, or by the level rising 5 points above the
--                              threshold, so a level that hovers around 50 % does not ring every few minutes. A second,
--                              optional "critical" level works the same way. At most 8 battery alerts per person per day.
--
-- Nothing here is reachable from a browser role: RLS on, every grant revoked.

create table if not exists public.kiosk_devices (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name                 text not null check (char_length(name) between 1 and 60),
  branch_id            uuid not null references public.branches(id) on delete cascade,
  active               boolean not null default true,
  settings             jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 8192),
  settings_updated_at  timestamptz not null default now(),
  settings_updated_by  uuid references public.staff(id) on delete set null,
  last_seen_at         timestamptz,
  battery_level        smallint check (battery_level is null or battery_level between 0 and 100),
  battery_charging     boolean,
  battery_reported_at  timestamptz,
  battery_alert_armed  boolean not null default true,
  battery_alerted_at   timestamptz,
  critical_alert_armed boolean not null default true,
  app_version          integer check (app_version is null or app_version between 0 and 1000000),
  web_version          text check (web_version is null or char_length(web_version) <= 40),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists kiosk_devices_branch_idx on public.kiosk_devices (branch_id);

alter table public.kiosk_devices enable row level security;
revoke all on public.kiosk_devices from public, anon, authenticated;
grant all on public.kiosk_devices to service_role;

-- The tablet that is already in use: Givat Haviva. Re-applying adds nothing twice.
insert into public.kiosk_devices (slug, name, branch_id)
select 'givat-haviva-1', 'קיוסק גבעת חביבה', id from public.branches where slug = 'givat-haviva'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- kiosk_device_report
-- ---------------------------------------------------------------------
-- p_level 0..100 (anything else is "unknown"), p_charging true / false / null (unknown: never alerts), the app's version
-- code and the page bundle's version (both optional). Returns { ok, alerted, settingsUpdatedAt }.
create or replace function public.kiosk_device_report(
  p_slug         text,
  p_level        integer,
  p_charging     boolean,
  p_app_version  integer,
  p_web_version  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev          public.kiosk_devices%rowtype;
  v_level        integer;
  v_enabled      boolean;
  v_threshold    integer;
  v_crit_on      boolean;
  v_crit         integer;
  v_armed        boolean;
  v_crit_armed   boolean;
  v_fire         boolean := false;
  v_fire_crit    boolean := false;
  v_recipient    record;
  v_title        text;
  v_body         text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    return jsonb_build_object('ok', false, 'error', 'unknown_device');
  end if;
  select * into v_dev from public.kiosk_devices where slug = p_slug and active for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_device'); end if;

  v_level := case when p_level between 0 and 100 then p_level else null end;

  -- the device's alert settings (sparse: a missing or odd value means the default)
  v_enabled   := coalesce((case when jsonb_typeof(v_dev.settings #> '{battery,alertEnabled}') = 'boolean'
                                then (v_dev.settings #>> '{battery,alertEnabled}')::boolean end), true);
  v_threshold := coalesce((case when (v_dev.settings #>> '{battery,alertPercent}') ~ '^[0-9]{1,3}$'
                                then (v_dev.settings #>> '{battery,alertPercent}')::integer end), 50);
  v_threshold := least(90, greatest(10, v_threshold));
  v_crit_on   := coalesce((case when jsonb_typeof(v_dev.settings #> '{battery,criticalEnabled}') = 'boolean'
                                then (v_dev.settings #>> '{battery,criticalEnabled}')::boolean end), false);
  v_crit      := coalesce((case when (v_dev.settings #>> '{battery,criticalPercent}') ~ '^[0-9]{1,3}$'
                                then (v_dev.settings #>> '{battery,criticalPercent}')::integer end), 15);
  v_crit      := least(40, greatest(5, v_crit));

  v_armed      := v_dev.battery_alert_armed;
  v_crit_armed := v_dev.critical_alert_armed;

  if v_level is not null and p_charging is not null then
    -- armed again: on charge, or once the level has climbed 5 points above the threshold
    if p_charging or v_level >= least(100, v_threshold + 5) then v_armed := true; end if;
    if p_charging or v_level >= least(100, v_crit + 5) then v_crit_armed := true; end if;

    if not p_charging then
      if v_crit_on and v_level < v_crit and v_crit_armed then
        v_fire_crit := true; v_crit_armed := false; v_armed := false; -- the urgent one replaces the first
      elsif v_enabled and v_level < v_threshold and v_armed then
        v_fire := true; v_armed := false;
      end if;
    end if;
  end if;

  update public.kiosk_devices
     set last_seen_at         = now(),
         battery_level        = coalesce(v_level, battery_level),
         battery_charging     = coalesce(p_charging, battery_charging),
         battery_reported_at  = case when v_level is not null then now() else battery_reported_at end,
         battery_alert_armed  = v_armed,
         critical_alert_armed = v_crit_armed,
         battery_alerted_at   = case when v_fire or v_fire_crit then now() else battery_alerted_at end,
         app_version          = coalesce(p_app_version, app_version),
         web_version          = coalesce(nullif(left(btrim(coalesce(p_web_version, '')), 40), ''), web_version)
   where id = v_dev.id;

  if v_fire or v_fire_crit then
    if v_fire_crit then
      v_title := '⚠️ סוללת הקיוסק כמעט נגמרה';
      v_body  := v_dev.name || ' · ' || v_level || '% · לא בטעינה — חברו למטען עכשיו';
    else
      v_title := '🔋 סוללת הקיוסק ירדה מתחת ל-' || v_threshold || '%';
      v_body  := v_dev.name || ' · ' || v_level || '% · לא בטעינה — כדאי לחבר למטען';
    end if;
    -- the developer only (the owner reads about the kiosk from the page, not from the lock screen)
    for v_recipient in select s.id from public.staff s where s.active and s.badge = 'developer' loop
      if (select count(*) from public.schedule_notifications n
           where n.staff_id = v_recipient.id and n.kind = 'dev.kiosk_battery'
             and n.created_at > now() - interval '1 day') < 8 then
        insert into public.schedule_notifications (branch_id, staff_id, kind, title, body, link)
        values (v_dev.branch_id, v_recipient.id, 'dev.kiosk_battery', v_title, v_body,
                jsonb_build_object('url', '/owner/kiosk'));
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'alerted', v_fire or v_fire_crit, 'settingsUpdatedAt', v_dev.settings_updated_at);
end;
$$;

revoke all on function public.kiosk_device_report(text, integer, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.kiosk_device_report(text, integer, boolean, integer, text) to service_role;

-- ---------------------------------------------------------------------
-- kiosk_device_alert_test
-- ---------------------------------------------------------------------
create or replace function public.kiosk_device_alert_test(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev        public.kiosk_devices%rowtype;
  v_recipient  record;
  v_sent       integer := 0;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    return jsonb_build_object('ok', false, 'error', 'unknown_device');
  end if;
  select * into v_dev from public.kiosk_devices where slug = p_slug and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_device'); end if;

  for v_recipient in select s.id from public.staff s where s.active and s.badge = 'developer' loop
    if (select count(*) from public.schedule_notifications n
         where n.staff_id = v_recipient.id and n.kind = 'dev.kiosk_battery' and n.title like '%(בדיקה)%'
           and n.created_at > now() - interval '1 hour') < 5 then
      insert into public.schedule_notifications (branch_id, staff_id, kind, title, body, link)
      values (v_dev.branch_id, v_recipient.id, 'dev.kiosk_battery', '🔋 בדיקת התראת סוללה (בדיקה)',
              v_dev.name || ' · ' || coalesce(v_dev.battery_level::text || '%', 'אין נתון') || ' · כך תיראה התראת הסוללה',
              jsonb_build_object('url', '/owner/kiosk'));
      v_sent := v_sent + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'sent', v_sent);
end;
$$;

revoke all on function public.kiosk_device_alert_test(text) from public, anon, authenticated;
grant execute on function public.kiosk_device_alert_test(text) to service_role;
