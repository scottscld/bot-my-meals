-- 20261004120000_realtime_names_push.sql
-- 1) Realtime: publish the remaining tables the app reads.
-- 2) Names: RPCs to edit memberships.display_name (+ profiles mirror).
-- 3) Push: subscriptions, outbox, triggers, dispatch RPCs (no service-role key on the Worker).

-- ---------- 4.1 Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['memberships','recipes','shopping_lists','households'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- 4.2 Names ----------
create or replace function private.clean_display_name(raw text)
returns text
language plpgsql
immutable
as $$
declare v text := regexp_replace(btrim(coalesce(raw, '')), '\s+', ' ', 'g');
begin
  if v = '' or char_length(v) > 40 or v ~ '[[:cntrl:]]' then
    raise exception 'Name must be 1–40 characters.' using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function public.set_my_display_name(new_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); v text;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  v := private.clean_display_name(new_name);
  update public.profiles set display_name = v where id = uid;
  update public.memberships set display_name = v where user_id = uid;
  return v;
end;
$$;
revoke all on function public.set_my_display_name(text) from public;
grant execute on function public.set_my_display_name(text) to authenticated;

create or replace function public.set_member_display_name(member_id uuid, new_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); v text; hid uuid;
begin
  select household_id into hid from public.memberships where id = member_id;
  if hid is null or not exists (
    select 1 from public.memberships m
    where m.household_id = hid and m.user_id = uid and m.role = 'owner'
  ) then
    raise exception 'Only an Admin can rename someone.' using errcode = '42501';
  end if;
  v := private.clean_display_name(new_name);
  update public.memberships set display_name = v where id = member_id;
  return v;
end;
$$;
revoke all on function public.set_member_display_name(uuid, text) from public;
grant execute on function public.set_member_display_name(uuid, text) to authenticated;

-- ---------- 4.3 Push ----------
create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  prefs jsonb not null default '{"menu_ready": true, "week_locked": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);
create index if not exists push_subscriptions_household_idx on public.push_subscriptions (household_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own_read on public.push_subscriptions;
create policy push_subscriptions_own_read on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
-- Inserts/updates go through the RPCs below (they set household_id and handle endpoint takeover).

-- p_ prefixes avoid plpgsql name clashes with the table's columns.
create or replace function public.upsert_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); hid uuid; rid uuid;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select m.household_id into hid from public.memberships m
  where m.user_id = uid order by m.created_at limit 1;
  if hid is null then raise exception 'Join a household first.' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'Bad subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions as s (user_id, household_id, endpoint, p256dh, auth, user_agent)
  values (uid, hid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id,           -- same device, new signed-in person
    household_id = excluded.household_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    failure_count = 0,
    updated_at = now()
  returning s.id into rid;
  return rid;
end;
$$;
revoke all on function public.upsert_push_subscription(text, text, text, text) from public;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;
revoke all on function public.delete_push_subscription(text) from public;
grant execute on function public.delete_push_subscription(text) to authenticated;

create or replace function public.set_push_prefs(p_endpoint text, p_menu_ready boolean, p_week_locked boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions s
  set prefs = jsonb_build_object('menu_ready', p_menu_ready, 'week_locked', p_week_locked),
      updated_at = now()
  where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;
revoke all on function public.set_push_prefs(text, boolean, boolean) from public;
grant execute on function public.set_push_prefs(text, boolean, boolean) to authenticated;

-- Outbox (private schema: not exposed through PostgREST)
create table if not exists private.push_outbox (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  week_id uuid references public.weeks(id) on delete cascade,
  kind text not null check (kind in ('menu_ready','options_refreshed','week_locked')),
  dedupe_key text not null unique,
  title text not null default 'Bot My Meals',
  body text not null,
  url text not null default '/week',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
alter table private.push_outbox enable row level security; -- no policies: definer-only

-- "This week" vs "Next week" label + deep link for a week
create or replace function private.push_week_label(wid uuid, out label text, out url text, out range text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when w.starts_on > cur.start then 'Next week' else 'This week' end,
    case when w.starts_on > cur.start then '/week?week=next' else '/week' end,
    to_char(w.starts_on, 'Mon FMDD') || ' – ' || to_char(w.starts_on + 6, 'Mon FMDD')
  from public.weeks w
  join public.households h on h.id = w.household_id
  cross join lateral (
    select ((now() at time zone coalesce(nullif(h.timezone, ''), 'America/Chicago'))::date
            - ((extract(dow from (now() at time zone coalesce(nullif(h.timezone, ''), 'America/Chicago')))::int
                - coalesce(h.week_starts_on, 0) + 7) % 7)) as start
  ) cur
  where w.id = wid;
$$;

-- a) Menu ready / options refreshed: deferred so it runs once the transaction's options are all written.
create or replace function private.push_on_meal_options()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.weeks%rowtype;
  missing integer;
  lbl record;
  first_time boolean;
begin
  select * into w from public.weeks where id = new.week_id;
  if w.id is null or w.ballot_mode is distinct from 'choice3'
     or w.status is distinct from 'voting' or w.finalized_at is not null then
    return null;
  end if;

  select count(*) into missing
  from private.choice_active_nights(w.id) n
  where (select count(*) from public.meal_options o
         where o.week_id = w.id and o.day_index = n.day_index) < 3;
  if missing > 0 then return null; end if;

  select * into lbl from private.push_week_label(w.id);
  first_time := not exists (
    select 1 from private.push_outbox where week_id = w.id and kind = 'menu_ready'
  );

  insert into private.push_outbox (household_id, week_id, kind, dedupe_key, body, url)
  values (
    w.household_id, w.id,
    case when first_time then 'menu_ready' else 'options_refreshed' end,
    case when first_time then 'menu_ready:' || w.id
         else 'options_refreshed:' || w.id || ':' || txid_current() end,
    case when first_time then lbl.label || '’s menu is ready. Pick your dinners.'
         else 'New dinner options are in for ' || to_char(new.night_date, 'Dy') || '.' end,
    lbl.url
  )
  on conflict (dedupe_key) do nothing;
  return null;
end;
$$;

drop trigger if exists meal_options_push on public.meal_options;
create constraint trigger meal_options_push
  after insert on public.meal_options
  deferrable initially deferred
  for each row execute function private.push_on_meal_options();

-- b) Week locked (single lock_week, or choice3 finalize → lock_week_unchecked)
create or replace function private.push_on_week_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare lbl record;
begin
  if new.status = 'locked' and old.status is distinct from 'locked' then
    select * into lbl from private.push_week_label(new.id);
    insert into private.push_outbox (household_id, week_id, kind, dedupe_key, body, url)
    values (
      new.household_id, new.id, 'week_locked',
      'week_locked:' || new.id || ':' || coalesce(new.locked_at, now())::text,
      lbl.label || '’s menu is locked: ' || lbl.range || '. Shopping list is on the way.',
      lbl.url
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists weeks_push_locked on public.weeks;
create trigger weeks_push_locked
  after update of status on public.weeks
  for each row execute function private.push_on_week_locked();

-- c) Outbox → Worker (pg_net). URL + secret live in Vault, never in this file.
create or replace function private.push_outbox_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare d_url text; d_secret text;
begin
  select decrypted_secret into d_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into d_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if coalesce(d_url, '') = '' or coalesce(d_secret, '') = '' then
    return null; -- push not set up yet; row stays unsent
  end if;
  perform net.http_post(
    url := d_url,
    body := jsonb_build_object('outbox_id', new.id),
    headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', d_secret),
    timeout_milliseconds := 8000
  );
  return null;
end;
$$;

drop trigger if exists push_outbox_dispatch on private.push_outbox;
create trigger push_outbox_dispatch
  after insert on private.push_outbox
  for each row execute function private.push_outbox_dispatch();

-- d) Dispatch RPCs (anon-callable, gated by the shared secret in Vault)
create or replace function private.push_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(secret, '') <> ''
     and secret = (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret');
$$;

create or replace function public.push_dispatch_claim(secret text, outbox_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare o private.push_outbox%rowtype; subs jsonb; pref text;
begin
  if not private.push_secret_ok(secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update private.push_outbox
  set claimed_at = now(), attempts = attempts + 1
  where id = outbox_id and sent_at is null
    and (claimed_at is null or claimed_at < now() - interval '2 minutes')
  returning * into o;
  if o.id is null then return null; end if;

  pref := case o.kind when 'week_locked' then 'week_locked' else 'menu_ready' end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth))), '[]'::jsonb)
  into subs
  from public.push_subscriptions s
  join public.memberships m on m.user_id = s.user_id and m.household_id = s.household_id
  where s.household_id = o.household_id
    and coalesce((s.prefs ->> pref)::boolean, true)
    and (o.kind = 'week_locked' or m.role in ('owner', 'voter'));

  return jsonb_build_object(
    'id', o.id, 'kind', o.kind, 'week_id', o.week_id,
    'message', jsonb_build_object('title', o.title, 'body', o.body, 'url', o.url,
                                  'tag', o.kind || ':' || coalesce(o.week_id::text, '')),
    'subscriptions', subs
  );
end;
$$;
revoke all on function public.push_dispatch_claim(text, bigint) from public;
grant execute on function public.push_dispatch_claim(text, bigint) to anon, authenticated;

create or replace function public.push_dispatch_report(
  secret text, outbox_id bigint, gone text[] default '{}', ok text[] default '{}', error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.push_secret_ok(secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = any(coalesce(gone, '{}'));
  update public.push_subscriptions
  set last_success_at = now(), failure_count = 0
  where endpoint = any(coalesce(ok, '{}'));
  update private.push_outbox
  set sent_at = case when error is null then now() else sent_at end,
      last_error = left(error, 500)
  where id = outbox_id;
end;
$$;
revoke all on function public.push_dispatch_report(text, bigint, text[], text[], text) from public;
grant execute on function public.push_dispatch_report(text, bigint, text[], text[], text) to anon, authenticated;

-- e) Optional retry (needs pg_cron; leave commented unless Scott enables it)
-- create extension if not exists pg_cron;
-- select cron.schedule('push-outbox-retry', '*/5 * * * *', $$
--   update private.push_outbox set claimed_at = null
--   where sent_at is null and attempts < 5 and created_at > now() - interval '1 hour'
--     and (claimed_at is null or claimed_at < now() - interval '5 minutes');
--   -- re-fire: insert-trigger only fires on insert, so call the dispatcher directly
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_url'),
--     body := jsonb_build_object('outbox_id', id),
--     headers := jsonb_build_object('content-type','application/json','x-push-secret',
--       (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret')))
--   from private.push_outbox
--   where sent_at is null and attempts < 5 and created_at > now() - interval '1 hour';
-- $$);
