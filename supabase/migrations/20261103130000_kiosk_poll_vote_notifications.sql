-- Every new answer to the kiosk's QR poll (/feedback) now tells the owners and the developers, the way a loyalty-club
-- sign-up already does: one schedule_notifications row per active owner ('poll.vote') and per developer ('dev.poll_vote'),
-- which travel the existing push outbox. The text carries the rating and the options that were ticked, never the written
-- suggestion (a push shows on a lock screen, and the suggestion is free text from a stranger; it is on the owner page).
--
-- Same signature as before, so this replaces the function in place (no overload). Replays and refused answers write
-- nothing. A flood guard keeps a bot that spreads over many addresses from burying a phone: at most 20 poll alerts per
-- person per hour; the answers themselves are still stored and shown on the page.

create or replace function public.kiosk_feedback_submit(
  p_option_ids  uuid[],
  p_suggestion  text,
  p_rating      integer,
  p_request_id  uuid,
  p_key_hash    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch      uuid;
  v_options     uuid[];
  v_suggestion  text;
  v_labels      text;
  v_body        text;
  v_recipient   record;
begin
  if p_key_hash is null or char_length(p_key_hash) not between 16 and 128 or p_request_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- Same request id again (a retry after a dropped answer): the same success, nothing new, not counted.
  if exists (select 1 from public.kiosk_feedback_responses where request_id = p_request_id) then
    return jsonb_build_object('ok', true, 'status', 'replayed');
  end if;

  -- Rate limit per caller and overall, over the last hour. Raw hits older than a day are swept here.
  delete from public.kiosk_feedback_attempts where at < now() - interval '1 day';
  if (select count(*) from public.kiosk_feedback_attempts where key_hash = p_key_hash and at > now() - interval '1 hour') >= 8
     or (select count(*) from public.kiosk_feedback_attempts where at > now() - interval '1 hour') >= 400 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.kiosk_feedback_attempts (key_hash) values (p_key_hash);

  select id into v_branch from public.branches where slug = 'givat-haviva';
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;

  select coalesce(array_agg(distinct x), '{}') into v_options from unnest(coalesce(p_option_ids, '{}')) x where x is not null;
  if coalesce(array_length(v_options, 1), 0) > 3 then return jsonb_build_object('ok', false, 'error', 'too_many_options'); end if;
  if (select count(*) from public.kiosk_feedback_options where branch_id = v_branch and enabled and id = any (v_options))
     <> coalesce(array_length(v_options, 1), 0) then
    return jsonb_build_object('ok', false, 'error', 'bad_option');
  end if;

  v_suggestion := nullif(btrim(regexp_replace(coalesce(p_suggestion, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  if v_suggestion is not null and char_length(v_suggestion) > 500 then
    return jsonb_build_object('ok', false, 'error', 'bad_suggestion');
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    return jsonb_build_object('ok', false, 'error', 'bad_rating');
  end if;
  if coalesce(array_length(v_options, 1), 0) = 0 and v_suggestion is null and p_rating is null then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  insert into public.kiosk_feedback_responses (branch_id, option_ids, suggestion, rating, request_id)
  values (v_branch, v_options, v_suggestion, p_rating::smallint, p_request_id);

  -- The alert text: the rating, the ticked options (owner-written labels), and whether a suggestion came with it.
  select string_agg(o.label, ' · ' order by o.sort_order) into v_labels
    from public.kiosk_feedback_options o where o.id = any (v_options);
  v_body := concat_ws(E'\n',
    case when p_rating is not null then repeat('★', p_rating) || repeat('☆', 5 - p_rating) end,
    v_labels,
    case when v_suggestion is not null then 'כולל הצעה כתובה — בעמוד הסקר' end);

  for v_recipient in
    select s.id, (s.role = 'owner' or s.badge = 'owner') as is_owner
      from public.staff s
     where s.active and (s.role = 'owner' or s.badge in ('owner', 'developer'))
  loop
    if (select count(*) from public.schedule_notifications n
         where n.staff_id = v_recipient.id and n.kind in ('poll.vote', 'dev.poll_vote')
           and n.created_at > now() - interval '1 hour') < 20 then
      insert into public.schedule_notifications (branch_id, staff_id, kind, title, body, link)
      values (v_branch, v_recipient.id,
              case when v_recipient.is_owner then 'poll.vote' else 'dev.poll_vote' end,
              '📊 הצבעה חדשה בסקר הלקוחות', v_body, jsonb_build_object('url', '/owner/kiosk/feedback'));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'status', 'created');
exception
  when unique_violation then
    -- two taps of the same request at the same moment: the first one won
    return jsonb_build_object('ok', true, 'status', 'replayed');
end;
$$;

revoke all on function public.kiosk_feedback_submit(uuid[], text, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.kiosk_feedback_submit(uuid[], text, integer, uuid, text) to service_role;
