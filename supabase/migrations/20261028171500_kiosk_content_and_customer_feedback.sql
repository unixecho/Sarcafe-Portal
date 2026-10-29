-- Kiosk content and the customer "what should the cart offer" poll (owner, 2026-10-28).
--
--   * kiosk_settings             one row per branch: idle / grace / slide timings and the dated hours exceptions
--                                (closed days, short days) that nothing else in the system records yet.
--   * kiosk_ads                  the kiosk's rotating cards, in the owner's order. The four required cards are seeded
--                                (seed_key set: they can be switched off but never deleted) plus a menu highlight card
--                                that starts switched off.
--   * kiosk_feedback_options     the owner's list of things customers may vote for. Never hard-deleted once voted for:
--                                removing a voted option switches it off so the old votes keep their label.
--   * kiosk_feedback_responses   one anonymous answer: up to three option votes, an optional suggestion (<= 500), an
--                                optional 1-5 rating. No name, phone, e-mail, IP, user agent or device id. The owner can
--                                hide spam; hidden answers leave the counts and the list.
--   * kiosk_feedback_attempts    short-lived rate-limit hits keyed by an HMAC of the caller (raw IPs never stored),
--                                swept after one day by every submit.
--
-- Functions (service role only, one signature each, never overloaded):
--   kiosk_content_save()        the owner's ONE Save: settings + every ad + every poll option, validated, all or nothing.
--   kiosk_feedback_submit()     the public poll's anonymous POST: rate limit, validate, idempotent by request id.
--   kiosk_feedback_set_hidden() owner: hide / restore one answer.
--   kiosk_feedback_summary()    owner: counts per option, answers per day, rating, for the last N days (0 = all time).
-- Nothing here is reachable from a browser role: RLS on, every grant revoked.

-- ---------------------------------------------------------------------
-- A. Tables
-- ---------------------------------------------------------------------
create table if not exists public.kiosk_settings (
  branch_id         uuid primary key references public.branches(id) on delete cascade,
  idle_seconds      integer not null default 60 check (idle_seconds between 30 and 300),
  grace_seconds     integer not null default 10 check (grace_seconds between 5 and 30),
  slide_seconds     integer not null default 7 check (slide_seconds between 3 and 60),
  hours_exceptions  jsonb not null default '[]'::jsonb check (jsonb_typeof(hours_exceptions) = 'array'),
  updated_by        uuid references public.staff(id) on delete set null,
  updated_at        timestamptz not null default now()
);

create table if not exists public.kiosk_ads (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches(id) on delete cascade,
  seed_key       text,
  kind           text not null check (kind in ('location', 'feedback', 'loyalty', 'hours', 'menu_highlight', 'custom')),
  title          text not null check (char_length(title) between 1 and 80),
  body           text not null default '' check (char_length(body) <= 400),
  action         text not null default 'none' check (action in ('none', 'join', 'menu')),
  image_url      text check (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^https://[^[:space:]]+$')),
  menu_item_ids  text[] not null default '{}' check (coalesce(array_length(menu_item_ids, 1), 0) <= 12),
  enabled        boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (branch_id, seed_key)
);
create index if not exists kiosk_ads_order_idx on public.kiosk_ads (branch_id, sort_order);

create table if not exists public.kiosk_feedback_options (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  seed_key    text,
  label       text not null check (char_length(label) between 1 and 60),
  enabled     boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (branch_id, seed_key)
);
create index if not exists kiosk_feedback_options_order_idx on public.kiosk_feedback_options (branch_id, sort_order);

create table if not exists public.kiosk_feedback_responses (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  option_ids  uuid[] not null default '{}' check (coalesce(array_length(option_ids, 1), 0) <= 3),
  suggestion  text check (suggestion is null or char_length(suggestion) between 1 and 500),
  rating      smallint check (rating is null or rating between 1 and 5),
  request_id  uuid not null unique,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists kiosk_feedback_responses_recent_idx on public.kiosk_feedback_responses (branch_id, created_at desc);

create table if not exists public.kiosk_feedback_attempts (
  id        bigint generated always as identity primary key,
  key_hash  text not null,
  at        timestamptz not null default now()
);
create index if not exists kiosk_feedback_attempts_key_idx on public.kiosk_feedback_attempts (key_hash, at);

alter table public.kiosk_settings enable row level security;
alter table public.kiosk_ads enable row level security;
alter table public.kiosk_feedback_options enable row level security;
alter table public.kiosk_feedback_responses enable row level security;
alter table public.kiosk_feedback_attempts enable row level security;
revoke all on public.kiosk_settings, public.kiosk_ads, public.kiosk_feedback_options, public.kiosk_feedback_responses,
  public.kiosk_feedback_attempts from public, anon, authenticated;
grant all on public.kiosk_settings, public.kiosk_ads, public.kiosk_feedback_options, public.kiosk_feedback_responses,
  public.kiosk_feedback_attempts to service_role;

-- ---------------------------------------------------------------------
-- B. Seed (the kiosk's branch only; re-applying adds nothing twice)
-- ---------------------------------------------------------------------
insert into public.kiosk_settings (branch_id)
select id from public.branches where slug = 'givat-haviva'
on conflict (branch_id) do nothing;

insert into public.kiosk_ads (branch_id, seed_key, kind, title, body, action, enabled, sort_order)
select b.id, s.seed_key, s.kind, s.title, s.body, s.action, s.enabled, s.sort_order
  from public.branches b
 cross join (values
   ('location', 'location', 'סניף האם במאור',
    'בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי', 'none', true, 10),
   ('feedback', 'feedback', 'מה תרצו שנגיש?',
    'סרקו את קוד ה-QR כדי להצביע ולהשפיע על מה שיש לעגלה להציע — אנחנו רוצים לשמוע אתכם', 'none', true, 20),
   ('loyalty', 'loyalty', 'מועדון לקוחות — בקרוב',
    'מעוניינים במועדון לקוחות עם צבירת נקודות ואירועים? הירשמו בלחיצה על המסך', 'join', true, 30),
   -- the body of the hours card is written from the branch's hours when the kiosk asks for it
   ('hours', 'hours', 'שעות הפתיחה', '', 'none', true, 40),
   ('menu_highlight', 'menu_highlight', 'המומלצים שלנו', '', 'menu', false, 50)
 ) as s(seed_key, kind, title, body, action, enabled, sort_order)
 where b.slug = 'givat-haviva'
on conflict (branch_id, seed_key) do nothing;

insert into public.kiosk_feedback_options (branch_id, seed_key, label, sort_order)
select b.id, s.seed_key, s.label, s.sort_order
  from public.branches b
 cross join (values
   ('pastries', 'מאפים טריים', 10),
   ('sandwiches', 'כריכים וטוסטים', 20),
   ('cold_drinks', 'משקאות קרים מיוחדים', 30),
   ('vegan', 'אפשרויות טבעוניות', 40),
   ('desserts', 'קינוחים ועוגות', 50)
 ) as s(seed_key, label, sort_order)
 where b.slug = 'givat-haviva'
on conflict (branch_id, seed_key) do nothing;

-- ---------------------------------------------------------------------
-- C. kiosk_content_save: the owner's one Save
-- ---------------------------------------------------------------------
-- p_settings: { idleSeconds, graceSeconds, slideSeconds, exceptions: [{ date, closed, open, close, note }] }
-- p_ads:      [{ id?, kind, title, body, action, imageUrl, menuItemIds, enabled }]  (array order = kiosk order)
-- p_options:  [{ id?, label, enabled }]                                             (array order = page order)
-- Everything is validated before anything is written, so a refusal changes nothing.
create or replace function public.kiosk_content_save(p_actor uuid, p_settings jsonb, p_ads jsonb, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch   uuid;
  v_idle     integer;
  v_grace    integer;
  v_slide    integer;
  v_ex       jsonb;
  v_exs      jsonb := '[]'::jsonb;
  v_el       jsonb;
  v_pos      bigint;
  v_id       uuid;
  v_kept     uuid[] := '{}';
  v_ids      text[];
  v_title    text;
  v_body     text;
  v_label    text;
  v_url      text;
  v_note     text;
begin
  select id into v_branch from public.branches where slug = 'givat-haviva';
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  if p_actor is null or not exists (select 1 from public.staff where id = p_actor and active and (role = 'owner' or badge = 'owner')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' or jsonb_typeof(p_ads) is distinct from 'array'
     or jsonb_typeof(p_options) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- settings
  begin
    v_idle := (p_settings ->> 'idleSeconds')::integer;
    v_grace := (p_settings ->> 'graceSeconds')::integer;
    v_slide := (p_settings ->> 'slideSeconds')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_settings');
  end;
  if v_idle is null or v_idle not between 30 and 300 or v_grace is null or v_grace not between 5 and 30
     or v_slide is null or v_slide not between 3 and 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_settings');
  end if;

  v_ex := coalesce(p_settings -> 'exceptions', '[]'::jsonb);
  if jsonb_typeof(v_ex) <> 'array' or jsonb_array_length(v_ex) > 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_exception');
  end if;
  for v_el in select value from jsonb_array_elements(v_ex) loop
    v_note := nullif(btrim(regexp_replace(coalesce(v_el ->> 'note', ''), '[[:cntrl:]]', ' ', 'g')), '');
    if jsonb_typeof(v_el) <> 'object'
       or coalesce(v_el ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(v_el -> 'closed') is distinct from 'boolean'
       or (v_note is not null and char_length(v_note) > 80) then
      return jsonb_build_object('ok', false, 'error', 'bad_exception');
    end if;
    begin
      perform (v_el ->> 'date')::date;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'bad_exception');
    end;
    if not (v_el ->> 'closed')::boolean and (
         coalesce(v_el ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(v_el ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      return jsonb_build_object('ok', false, 'error', 'bad_exception');
    end if;
    if exists (select 1 from jsonb_array_elements(v_exs) e where e ->> 'date' = v_el ->> 'date') then
      return jsonb_build_object('ok', false, 'error', 'duplicate_exception');
    end if;
    v_exs := v_exs || jsonb_build_array(jsonb_build_object(
      'date', v_el ->> 'date',
      'closed', (v_el ->> 'closed')::boolean,
      'open', case when (v_el ->> 'closed')::boolean then null else v_el ->> 'open' end,
      'close', case when (v_el ->> 'closed')::boolean then null else v_el ->> 'close' end,
      'note', v_note));
  end loop;

  -- ads: validate every one first
  if jsonb_array_length(p_ads) > 20 then return jsonb_build_object('ok', false, 'error', 'too_many_ads'); end if;
  for v_el, v_pos in select value, ordinality from jsonb_array_elements(p_ads) with ordinality loop
    v_title := btrim(regexp_replace(coalesce(v_el ->> 'title', ''), '[[:cntrl:]]', ' ', 'g'));
    v_body := btrim(regexp_replace(coalesce(v_el ->> 'body', ''), '[[:cntrl:]]', ' ', 'g'));
    v_url := nullif(btrim(coalesce(v_el ->> 'imageUrl', '')), '');
    if jsonb_typeof(v_el) <> 'object'
       or coalesce(v_el ->> 'kind', '') not in ('location', 'feedback', 'loyalty', 'hours', 'menu_highlight', 'custom')
       or coalesce(v_el ->> 'action', '') not in ('none', 'join', 'menu')
       or jsonb_typeof(v_el -> 'enabled') is distinct from 'boolean'
       or char_length(v_title) not between 1 and 80
       or char_length(v_body) > 400
       or (v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://[^[:space:]]+$'))
       or (v_el ? 'menuItemIds' and jsonb_typeof(v_el -> 'menuItemIds') <> 'array')
       or jsonb_array_length(coalesce(v_el -> 'menuItemIds', '[]'::jsonb)) > 12
       or exists (select 1 from jsonb_array_elements(coalesce(v_el -> 'menuItemIds', '[]'::jsonb)) m
                   where jsonb_typeof(m) <> 'string' or (m #>> '{}') !~ '^[A-Za-z0-9_-]{1,64}$') then
      return jsonb_build_object('ok', false, 'error', 'bad_ad', 'index', v_pos - 1);
    end if;
    if v_el ? 'id' and jsonb_typeof(v_el -> 'id') = 'string' then
      begin
        v_id := (v_el ->> 'id')::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'bad_ad', 'index', v_pos - 1);
      end;
      v_kept := v_kept || v_id;
    end if;
  end loop;
  if exists (select 1 from public.kiosk_ads where branch_id = v_branch and seed_key is not null and not (id = any (v_kept))) then
    return jsonb_build_object('ok', false, 'error', 'seeded_ad_missing');
  end if;

  -- poll options: validate
  if jsonb_array_length(p_options) > 12 then return jsonb_build_object('ok', false, 'error', 'too_many_options'); end if;
  for v_el, v_pos in select value, ordinality from jsonb_array_elements(p_options) with ordinality loop
    v_label := btrim(regexp_replace(coalesce(v_el ->> 'label', ''), '[[:cntrl:]]', ' ', 'g'));
    if jsonb_typeof(v_el) <> 'object' or char_length(v_label) not between 1 and 60
       or jsonb_typeof(v_el -> 'enabled') is distinct from 'boolean' then
      return jsonb_build_object('ok', false, 'error', 'bad_option', 'index', v_pos - 1);
    end if;
    if v_el ? 'id' and jsonb_typeof(v_el -> 'id') = 'string' then
      begin
        perform (v_el ->> 'id')::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'bad_option', 'index', v_pos - 1);
      end;
    end if;
  end loop;

  -- write: settings
  insert into public.kiosk_settings (branch_id, idle_seconds, grace_seconds, slide_seconds, hours_exceptions, updated_by, updated_at)
  values (v_branch, v_idle, v_grace, v_slide, v_exs, p_actor, now())
  on conflict (branch_id) do update
     set idle_seconds = excluded.idle_seconds, grace_seconds = excluded.grace_seconds, slide_seconds = excluded.slide_seconds,
         hours_exceptions = excluded.hours_exceptions, updated_by = excluded.updated_by, updated_at = now();

  -- write: ads (a seeded card keeps its kind; an unknown id becomes a new card)
  v_kept := '{}';
  for v_el, v_pos in select value, ordinality from jsonb_array_elements(p_ads) with ordinality loop
    v_id := case when jsonb_typeof(v_el -> 'id') = 'string' then (v_el ->> 'id')::uuid else null end;
    select coalesce(array_agg(m #>> '{}'), '{}') into v_ids from jsonb_array_elements(coalesce(v_el -> 'menuItemIds', '[]'::jsonb)) m;
    if v_id is not null and exists (select 1 from public.kiosk_ads where id = v_id and branch_id = v_branch) then
      update public.kiosk_ads
         set kind = case when seed_key is null then v_el ->> 'kind' else kind end,
             title = btrim(regexp_replace(v_el ->> 'title', '[[:cntrl:]]', ' ', 'g')),
             body = btrim(regexp_replace(coalesce(v_el ->> 'body', ''), '[[:cntrl:]]', ' ', 'g')),
             action = v_el ->> 'action',
             image_url = nullif(btrim(coalesce(v_el ->> 'imageUrl', '')), ''),
             menu_item_ids = v_ids,
             enabled = (v_el ->> 'enabled')::boolean,
             sort_order = v_pos * 10,
             updated_at = now()
       where id = v_id;
    else
      insert into public.kiosk_ads (branch_id, kind, title, body, action, image_url, menu_item_ids, enabled, sort_order)
      values (v_branch, v_el ->> 'kind', btrim(regexp_replace(v_el ->> 'title', '[[:cntrl:]]', ' ', 'g')),
              btrim(regexp_replace(coalesce(v_el ->> 'body', ''), '[[:cntrl:]]', ' ', 'g')), v_el ->> 'action',
              nullif(btrim(coalesce(v_el ->> 'imageUrl', '')), ''), v_ids, (v_el ->> 'enabled')::boolean, v_pos * 10)
      returning id into v_id;
    end if;
    v_kept := v_kept || v_id;
  end loop;
  delete from public.kiosk_ads where branch_id = v_branch and seed_key is null and not (id = any (v_kept));

  -- write: poll options (a removed option that already has votes is switched off, not deleted)
  v_kept := '{}';
  for v_el, v_pos in select value, ordinality from jsonb_array_elements(p_options) with ordinality loop
    v_id := case when jsonb_typeof(v_el -> 'id') = 'string' then (v_el ->> 'id')::uuid else null end;
    v_label := btrim(regexp_replace(v_el ->> 'label', '[[:cntrl:]]', ' ', 'g'));
    if v_id is not null and exists (select 1 from public.kiosk_feedback_options where id = v_id and branch_id = v_branch) then
      update public.kiosk_feedback_options
         set label = v_label, enabled = (v_el ->> 'enabled')::boolean, sort_order = v_pos * 10, updated_at = now()
       where id = v_id;
    else
      insert into public.kiosk_feedback_options (branch_id, label, enabled, sort_order)
      values (v_branch, v_label, (v_el ->> 'enabled')::boolean, v_pos * 10)
      returning id into v_id;
    end if;
    v_kept := v_kept || v_id;
  end loop;
  update public.kiosk_feedback_options o
     set enabled = false, sort_order = 100000, updated_at = now()
   where o.branch_id = v_branch and not (o.id = any (v_kept))
     and exists (select 1 from public.kiosk_feedback_responses r where o.id = any (r.option_ids));
  delete from public.kiosk_feedback_options o
   where o.branch_id = v_branch and not (o.id = any (v_kept))
     and not exists (select 1 from public.kiosk_feedback_responses r where o.id = any (r.option_ids));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- D. kiosk_feedback_submit: the public poll's anonymous answer
-- ---------------------------------------------------------------------
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
  return jsonb_build_object('ok', true, 'status', 'created');
exception
  when unique_violation then
    -- two taps of the same request at the same moment: the first one won
    return jsonb_build_object('ok', true, 'status', 'replayed');
end;
$$;

-- ---------------------------------------------------------------------
-- E. Owner: hide / restore an answer, and the summary
-- ---------------------------------------------------------------------
create or replace function public.kiosk_feedback_set_hidden(p_response_id uuid, p_hidden boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kiosk_feedback_responses set hidden = coalesce(p_hidden, true) where id = p_response_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- p_days: 7, 30, ... or 0 / null for all time. Hidden answers are left out everywhere. Days are the branch's own days.
create or replace function public.kiosk_feedback_summary(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch  uuid;
  v_tz      text;
  v_since   timestamptz;
  v_span    integer;
  v_result  jsonb;
begin
  select id, coalesce(timezone, 'Asia/Jerusalem') into v_branch, v_tz from public.branches where slug = 'givat-haviva';
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  if p_days is not null and p_days < 0 then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  v_since := case when coalesce(p_days, 0) = 0 then '-infinity'::timestamptz
                  else (date_trunc('day', now() at time zone v_tz) - make_interval(days => p_days - 1)) at time zone v_tz end;
  -- the per-day series covers the chosen period, at most the last 60 days
  v_span := least(case when coalesce(p_days, 0) = 0 then 60 else p_days end, 60);

  with r as (
    select * from public.kiosk_feedback_responses
     where branch_id = v_branch and not hidden and created_at >= v_since
  ), votes as (
    select o.id, o.label, o.enabled, o.sort_order,
           (select count(*) from r where o.id = any (r.option_ids))::integer as votes
      from public.kiosk_feedback_options o
     where o.branch_id = v_branch
  ), days as (
    select d::date as day
      from generate_series((now() at time zone v_tz)::date - (v_span - 1), (now() at time zone v_tz)::date, interval '1 day') d
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from r),
    'withSuggestion', (select count(*) from r where suggestion is not null),
    'ratingCount', (select count(*) from r where rating is not null),
    'ratingAverage', (select round(avg(rating)::numeric, 2) from r where rating is not null),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'enabled', enabled, 'votes', votes)
                                          order by votes desc, sort_order)
                           from votes where enabled or votes > 0), '[]'::jsonb),
    'perDay', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(days.day, 'YYYY-MM-DD'),
                                          'count', (select count(*) from r where (r.created_at at time zone v_tz)::date = days.day))
                                          order by days.day)
                          from days), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- F. Access: service role only, exact signatures
-- ---------------------------------------------------------------------
revoke all on function public.kiosk_content_save(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kiosk_content_save(uuid, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.kiosk_feedback_submit(uuid[], text, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.kiosk_feedback_submit(uuid[], text, integer, uuid, text) to service_role;
revoke all on function public.kiosk_feedback_set_hidden(uuid, boolean) from public, anon, authenticated;
grant execute on function public.kiosk_feedback_set_hidden(uuid, boolean) to service_role;
revoke all on function public.kiosk_feedback_summary(integer) from public, anon, authenticated;
grant execute on function public.kiosk_feedback_summary(integer) to service_role;
