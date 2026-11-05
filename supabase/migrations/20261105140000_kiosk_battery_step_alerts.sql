-- Kiosk battery alerts, one for every 5 % (owner, 2026-11-05: "notifications for battery level on the kiosk from 50 and
-- descending each 5%").
--
-- Before: ONE alert per fall below the tablet's alert level (50 % unless changed), re-armed by charging.
-- Now: the developer is told at 50 %, 45 %, 40 % ... 10 %, 5 % while the tablet is not charging. The alert level (battery.alertPercent,
-- 50 by default, set in the tablet's control panel and on /owner/kiosk) is where the ladder starts. Each rung rings once per
-- fall: the lowest rung already told is kept in kiosk_devices.battery_alert_step, and it is cleared when the tablet is charged or
-- has climbed 5 points above the alert level. A report that skips rungs (the tablet reports every ~5 minutes) rings once, for the
-- rung the charge is now at or under, and says the real charge. The optional "urgent" level (battery.criticalEnabled) no longer
-- sends a second alert: a rung at or under it is sent with the urgent title instead.
--
-- Same function, same signature (create or replace, no overload: see CLAUDE.md). The old armed columns stay (unused) so this is
-- additive. The per-person daily cap goes from 8 to 30 (a fall from 50 % is ten alerts, and the tablet can fall twice in a day).
-- Not applied by the migration itself: the owner runs it in the SQL editor and records the ledger row.

alter table public.kiosk_devices add column if not exists battery_alert_step smallint
  check (battery_alert_step is null or battery_alert_step between 0 and 100);

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
  v_last         integer;
  v_step         integer;
  v_fire         boolean := false;
  v_urgent       boolean := false;
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

  v_last := v_dev.battery_alert_step;

  if v_level is not null and p_charging is not null then
    -- the ladder starts again: on charge, or once the level has climbed 5 points above where it starts
    if p_charging or v_level >= least(100, v_threshold + 5) then v_last := null; end if;

    if not p_charging and v_enabled then
      -- the rung the charge is at or under: the smallest multiple of 5 that is not below it (47 -> 50, 45 -> 45, 43 -> 45), never under 5
      v_step := greatest(5, ((v_level + 4) / 5) * 5);
      if v_step <= v_threshold and (v_last is null or v_step < v_last) then
        v_fire := true;
        v_last := v_step;
        v_urgent := v_crit_on and v_level <= v_crit;
      end if;
    end if;
  end if;

  update public.kiosk_devices
     set last_seen_at         = now(),
         battery_level        = coalesce(v_level, battery_level),
         battery_charging     = coalesce(p_charging, battery_charging),
         battery_reported_at  = case when v_level is not null then now() else battery_reported_at end,
         battery_alert_step   = v_last,
         battery_alerted_at   = case when v_fire then now() else battery_alerted_at end,
         app_version          = coalesce(p_app_version, app_version),
         web_version          = coalesce(nullif(left(btrim(coalesce(p_web_version, '')), 40), ''), web_version)
   where id = v_dev.id;

  if v_fire then
    if v_urgent then
      v_title := '⚠️ סוללת הקיוסק כמעט נגמרה · ' || v_level || '%';
      v_body  := v_dev.name || ' · ' || v_level || '% · לא בטעינה — חברו למטען עכשיו';
    else
      v_title := '🔋 סוללת הקיוסק ב-' || v_level || '%';
      v_body  := v_dev.name || ' · לא בטעינה — התראה בכל 5% · כדאי לחבר למטען';
    end if;
    -- the developer only (the owner reads about the kiosk from the page, not from the lock screen)
    for v_recipient in select s.id from public.staff s where s.active and s.badge = 'developer' loop
      if (select count(*) from public.schedule_notifications n
           where n.staff_id = v_recipient.id and n.kind = 'dev.kiosk_battery'
             and n.created_at > now() - interval '1 day') < 30 then
        insert into public.schedule_notifications (branch_id, staff_id, kind, title, body, link)
        values (v_dev.branch_id, v_recipient.id, 'dev.kiosk_battery', v_title, v_body,
                jsonb_build_object('url', '/owner/kiosk'));
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'alerted', v_fire, 'settingsUpdatedAt', v_dev.settings_updated_at);
end;
$$;

revoke all on function public.kiosk_device_report(text, integer, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.kiosk_device_report(text, integer, boolean, integer, text) to service_role;
