-- Club sign-ups from a public web page as well as the kiosk (owner, 2026-11-04).
--
-- customer_waitlist_register gets ONE more argument, p_source ('kiosk' default, or 'web'). The old 9-argument signature is dropped in
-- the same migration, so there is exactly one function (never an overload: PostgREST would refuse every call). The kiosk's route
-- calls it without p_source and keeps working.
--   * the source is stored on the contact and on its consent events (so the owner can tell kiosk from web);
--   * rate limits are counted per source: kiosk 12 per hour per caller and 300 overall (as before), web 6 per hour per caller and
--     120 overall, so a flood on the web page can never lock the kiosk out;
--   * a person is told about at most 30 sign-ups per hour (the sign-up itself is still stored), so a flood cannot bury a phone.
-- Same rules as before otherwise: validation, a number already on the list is refused with nothing changed, a repeat request id is a
-- replay, no customer data in the notification. Service role only.

alter table public.customer_waitlist_attempts add column if not exists source text not null default 'kiosk';

drop function if exists public.customer_waitlist_register(text, text, text, boolean, text, text, text, uuid, text);

create or replace function public.customer_waitlist_register(
  p_first_name       text,
  p_phone            text,
  p_email            text,
  p_marketing        boolean,
  p_privacy_version  text,
  p_consent_version  text,
  p_terms_version    text,
  p_request_id       uuid,
  p_key_hash         text,
  p_source           text default 'kiosk'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch    uuid;
  v_phone     text;
  v_name      text;
  v_email     text;
  v_marketing boolean := coalesce(p_marketing, false);
  v_source    text := coalesce(p_source, 'kiosk');
  v_per_key   integer;
  v_overall   integer;
  v_contact   public.customer_waitlist_contacts%rowtype;
  v_recipient record;
  v_title     text := '☕ התעניינות חדשה במועדון שרקפה';
  v_body      text;
begin
  if v_source not in ('kiosk', 'web') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if p_key_hash is null or char_length(p_key_hash) not between 16 and 128 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- Rate limit per caller and overall, over the last hour, per source. Old hits are swept here, so the table stays tiny.
  v_per_key := case when v_source = 'web' then 6 else 12 end;
  v_overall := case when v_source = 'web' then 120 else 300 end;
  delete from public.customer_waitlist_attempts where at < now() - interval '2 hours';
  if (select count(*) from public.customer_waitlist_attempts where key_hash = p_key_hash and source = v_source and at > now() - interval '1 hour') >= v_per_key
     or (select count(*) from public.customer_waitlist_attempts where source = v_source and at > now() - interval '1 hour') >= v_overall then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.customer_waitlist_attempts (key_hash, source) values (p_key_hash, v_source);

  -- Validate and normalize. +972 5X... and 05X... both become 05XXXXXXXX.
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_phone ~ '^9725[0-9]{8}$' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone !~ '^05[0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'bad_phone'); end if;

  v_name := btrim(regexp_replace(coalesce(p_first_name, ''), '[[:cntrl:]]', '', 'g'));
  if char_length(v_name) not between 1 and 60 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;

  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;

  if p_request_id is null
     or coalesce(char_length(p_privacy_version), 0) not between 1 and 80
     or coalesce(char_length(p_consent_version), 0) not between 1 and 80
     or coalesce(char_length(p_terms_version), 0) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- Same request id again (a retry after a dropped answer): the same success, nothing new.
  if exists (select 1 from public.customer_waitlist_consent_events where request_id = p_request_id) then
    return jsonb_build_object('ok', true, 'status', 'replayed');
  end if;

  select id into v_branch from public.branches where slug = 'givat-haviva';
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;

  -- A number that is already on the list is refused, and nothing about it changes.
  if exists (select 1 from public.customer_waitlist_contacts where branch_id = v_branch and normalized_phone = v_phone) then
    return jsonb_build_object('ok', false, 'error', 'already_registered');
  end if;

  insert into public.customer_waitlist_contacts (branch_id, first_name, normalized_phone, email, current_marketing_consent, source)
  values (v_branch, v_name, v_phone, v_email, v_marketing, v_source)
  returning * into v_contact;

  insert into public.customer_waitlist_consent_events
    (contact_id, event_type, privacy_notice_version, consent_text_version, terms_version, marketing_consent, source, request_id)
  values (v_contact.id, 'interest_registered', p_privacy_version, p_consent_version, p_terms_version, v_marketing, v_source, p_request_id);

  -- A marketing yes is its own, separate, dated event.
  if v_marketing then
    insert into public.customer_waitlist_consent_events
      (contact_id, event_type, privacy_notice_version, consent_text_version, terms_version, marketing_consent, source)
    values (v_contact.id, 'marketing_granted', p_privacy_version, p_consent_version, p_terms_version, true, v_source);
  end if;

  -- Tell every active owner and developer, once each, at most 30 an hour per person. No customer data in the text.
  v_body := case when v_source = 'web'
                 then 'לקוח חדש הצטרף לרשימת המתעניינים במועדון הלקוחות הדיגיטלי דרך עמוד ההרשמה באתר.'
                 else 'לקוח חדש הצטרף לרשימת המתעניינים במועדון הלקוחות הדיגיטלי.' end;
  for v_recipient in
    select s.id, (s.role = 'owner' or s.badge = 'owner') as is_owner
      from public.staff s
     where s.active and (s.role = 'owner' or s.badge in ('owner', 'developer'))
  loop
    if (select count(*) from public.schedule_notifications n
         where n.staff_id = v_recipient.id and n.kind in ('club.signup', 'dev.club_signup')
           and n.created_at > now() - interval '1 hour') < 30 then
      insert into public.schedule_notifications (branch_id, staff_id, kind, title, body, link)
      values (v_branch, v_recipient.id,
              case when v_recipient.is_owner then 'club.signup' else 'dev.club_signup' end,
              v_title, v_body, jsonb_build_object('url', '/owner/waitlist'));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'status', 'created');
exception
  when unique_violation then
    -- two requests at the same moment: either the same request id (a replay) or the same number (the second one is refused)
    if exists (select 1 from public.customer_waitlist_consent_events where request_id = p_request_id) then
      return jsonb_build_object('ok', true, 'status', 'replayed');
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_registered');
end;
$$;

revoke all on function public.customer_waitlist_register(text, text, text, boolean, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.customer_waitlist_register(text, text, text, boolean, text, text, text, uuid, text, text) to service_role;
