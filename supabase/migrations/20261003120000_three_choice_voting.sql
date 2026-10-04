-- 3-choice voting. Bot writes 3 options per active night; each voter picks one per night,
-- locks in; when every owner/voter is in, winners become public.meals and the week locks.

-- Week mode + finalize marker. Existing rows stay 'single' (old flow). New weeks default to choice3.
alter table public.weeks
  add column if not exists ballot_mode text not null default 'single'
    check (ballot_mode in ('single', 'choice3')),
  add column if not exists finalized_at timestamptz;

alter table public.weeks alter column ballot_mode set default 'choice3';

create table if not exists public.meal_options (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  week_id uuid not null references public.weeks (id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6),
  night_date date not null,
  rank smallint not null check (rank between 1 and 3),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  pitch text not null default '' check (char_length(pitch) <= 280),
  servings integer not null check (servings between 1 and 12),
  prep_minutes integer not null default 30 check (prep_minutes between 5 and 240),
  recipe_key text,
  created_at timestamptz not null default now(),
  unique (week_id, day_index, rank),
  unique (id, week_id, day_index)
);

create unique index if not exists meal_options_distinct_title
  on public.meal_options (week_id, day_index, lower(btrim(title)));

alter table public.meals
  add column if not exists source_option_id uuid
    references public.meal_options (id) on delete set null;

create table if not exists public.meal_option_picks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  week_id uuid not null references public.weeks (id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6),
  option_id uuid not null,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_option_picks_one_per_night unique (week_id, day_index, membership_id),
  foreign key (option_id, week_id, day_index)
    references public.meal_options (id, week_id, day_index) on delete cascade
);

create table if not exists public.week_vote_submissions (
  week_id uuid not null references public.weeks (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (week_id, membership_id)
);

create table if not exists public.meal_option_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  week_id uuid not null references public.weeks (id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6),
  requested_by uuid references public.memberships (id) on delete set null,
  note text not null default '' check (char_length(note) <= 280),
  status text not null default 'pending' check (status in ('pending', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

create unique index if not exists meal_option_requests_one_pending
  on public.meal_option_requests (week_id, day_index) where status = 'pending';

alter table public.meal_options enable row level security;
alter table public.meal_option_picks enable row level security;
alter table public.week_vote_submissions enable row level security;
alter table public.meal_option_requests enable row level security;

drop policy if exists meal_options_member_read on public.meal_options;
create policy meal_options_member_read on public.meal_options
  for select to authenticated using (public.is_household_member(household_id));

drop policy if exists meal_option_picks_read on public.meal_option_picks;
create policy meal_option_picks_read on public.meal_option_picks
  for select to authenticated using (
    public.is_household_member(household_id)
    and (
      membership_id in (select id from public.memberships where user_id = auth.uid())
      or exists (
        select 1 from public.weeks w
        where w.id = meal_option_picks.week_id and w.finalized_at is not null
      )
    )
  );

drop policy if exists week_vote_submissions_member_read on public.week_vote_submissions;
create policy week_vote_submissions_member_read on public.week_vote_submissions
  for select to authenticated using (public.is_household_member(household_id));

drop policy if exists meal_option_requests_member_read on public.meal_option_requests;
create policy meal_option_requests_member_read on public.meal_option_requests
  for select to authenticated using (public.is_household_member(household_id));

revoke insert, update, delete on public.meal_options, public.meal_option_picks,
  public.week_vote_submissions, public.meal_option_requests from anon, authenticated;
grant select on public.meal_options, public.meal_option_picks,
  public.week_vote_submissions, public.meal_option_requests to authenticated;
grant all on public.meal_options, public.meal_option_picks,
  public.week_vote_submissions, public.meal_option_requests to service_role;

do $$
begin
  alter publication supabase_realtime add table public.meal_options;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.meal_option_picks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.week_vote_submissions;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.meal_option_requests;
exception
  when duplicate_object then null;
end $$;

drop trigger if exists meal_options_fulfill_ballot_request on public.meal_options;
create trigger meal_options_fulfill_ballot_request
  after insert on public.meal_options
  for each row execute function private.fulfill_ballot_request_for_week();

-- Member inserts of meals stay allowed, except on an open choice3 week.
-- Finalize writes meals as security definer and is not affected.
drop policy if exists meals_member_write on public.meals;
drop policy if exists meals_member_insert on public.meals;
drop policy if exists meals_member_update on public.meals;
drop policy if exists meals_member_delete on public.meals;

create policy meals_member_insert on public.meals
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and not exists (
      select 1
      from public.weeks w
      where w.id = week_id
        and w.ballot_mode = 'choice3'
        and w.finalized_at is null
    )
  );

create policy meals_member_update on public.meals
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy meals_member_delete on public.meals
  for delete to authenticated
  using (public.is_household_member(household_id));

-- Nights with plates > 0 that are not frozen before editable_from.
-- Plates come from ballot_plates, indexed by weekday (0 = Sun), not day_index.
create or replace function private.choice_active_nights(wid uuid)
returns table (day_index smallint, night_date date, plates integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    gs.i::smallint,
    (w.starts_on + gs.i),
    bp.counts[extract(dow from (w.starts_on + gs.i))::int + 1]
  from public.weeks w
  cross join lateral private.ballot_plates(w.household_id, w.id) bp
  cross join lateral generate_series(0, 6) as gs(i)
  where w.id = wid
    and coalesce(bp.counts[extract(dow from (w.starts_on + gs.i))::int + 1], 0) > 0
    and (w.starts_on + gs.i) >= coalesce(w.editable_from, w.starts_on);
$$;

revoke all on function private.choice_active_nights(uuid) from public;

create or replace function private.lock_week_unchecked(wid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  lid uuid;
begin
  select household_id into hid
  from public.weeks
  where id = wid;

  if hid is null then
    raise exception 'That week is not in this household.';
  end if;

  update public.weeks
  set status = 'locked'
  where id = wid;

  delete from public.shopping_lists where week_id = wid;

  insert into public.shopping_lists (household_id, week_id)
  values (hid, wid)
  returning id into lid;

  insert into public.shopping_items (
    household_id, shopping_list_id, store_id, name, quantity, unit
  )
  select
    hid,
    lid,
    ri.store_id,
    ri.name,
    sum(ri.quantity),
    ri.unit
  from public.meals m
  join public.recipes r on r.meal_id = m.id
  join public.recipe_ingredients ri on ri.recipe_id = r.id
  where m.week_id = wid
    and not exists (
      select 1
      from (
        select distinct on (v.meal_id) v.meal_id, v.choice
        from public.votes v
        join public.memberships mem on mem.id = v.membership_id
        where v.meal_id = m.id
          and mem.role in ('owner', 'voter')
        order by v.meal_id, v.updated_at desc, v.id desc
      ) latest
      where latest.choice = 'remove'
    )
  group by ri.store_id, lower(btrim(ri.name)), ri.unit, ri.name;

  return lid;
end;
$$;

revoke all on function private.lock_week_unchecked(uuid) from public;

create or replace function public.lock_week(target_week uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  cooking public.weeks%rowtype;
  target public.weeks%rowtype;
begin
  select household_id into hid
  from public.memberships
  where user_id = auth.uid()
  order by created_at asc
  limit 1;

  if hid is null then
    raise exception 'Not in a household';
  end if;

  select * into target
  from public.weeks
  where id = target_week
    and household_id = hid;

  if target.id is null then
    raise exception 'That week is not in this household.';
  end if;

  select * into cooking from private.open_cooking_week(hid);
  if cooking.id is null
    or (
      target.starts_on is distinct from cooking.starts_on
      and target.starts_on is distinct from cooking.starts_on + 7
    ) then
    raise exception 'Only this week and next week can be locked.';
  end if;

  return private.lock_week_unchecked(target.id);
end;
$$;

revoke all on function public.lock_week(uuid) from public;
grant execute on function public.lock_week(uuid) to authenticated;

create or replace function private.try_finalize_week(wid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.weeks%rowtype;
  voters integer;
  missing integer;
  nights integer;
  bad integer;
  n record;
  win public.meal_options%rowtype;
  mid uuid;
begin
  select * into w
  from public.weeks
  where id = wid
  for update;

  if w.id is null
    or w.ballot_mode is distinct from 'choice3'
    or w.status is distinct from 'voting'
    or w.finalized_at is not null then
    return false;
  end if;

  select count(*) into voters
  from public.memberships mem
  where mem.household_id = w.household_id
    and mem.role in ('owner', 'voter');

  if voters = 0 then
    return false;
  end if;

  select count(*) into missing
  from public.memberships mem
  where mem.household_id = w.household_id
    and mem.role in ('owner', 'voter')
    and not exists (
      select 1
      from public.week_vote_submissions s
      where s.week_id = w.id
        and s.membership_id = mem.id
    );

  if missing > 0 then
    return false;
  end if;

  select count(*) into nights
  from private.choice_active_nights(w.id);

  if nights = 0 then
    return false;
  end if;

  select count(*) into bad
  from private.choice_active_nights(w.id) n
  where (
    select count(*) from public.meal_options o
    where o.week_id = w.id and o.day_index = n.day_index
  ) <> 3
  or exists (
    select 1
    from public.meal_option_requests r
    where r.week_id = w.id
      and r.day_index = n.day_index
      and r.status = 'pending'
  );

  if bad > 0 then
    return false;
  end if;

  for n in
    select * from private.choice_active_nights(w.id)
  loop
    select o.* into win
    from public.meal_options o
    left join lateral (
      select count(*) as votes
      from public.meal_option_picks p
      join public.memberships m on m.id = p.membership_id and m.role in ('owner', 'voter')
      where p.option_id = o.id
    ) c on true
    left join lateral (
      select min(m.created_at) as owner_at
      from public.meal_option_picks p
      join public.memberships m on m.id = p.membership_id and m.role = 'owner'
      where p.option_id = o.id
    ) ow on true
    where o.week_id = wid and o.day_index = n.day_index
    order by c.votes desc, ow.owner_at asc nulls last, o.rank asc
    limit 1;

    mid := null;
    insert into public.meals (
      household_id, week_id, day_index, night_date, title, pitch, audience,
      servings, prep_minutes, is_leftovers, source_option_id
    )
    values (
      w.household_id, wid, n.day_index, n.night_date, win.title, win.pitch,
      case when n.plates = 2 then 'couple' else 'family' end,
      n.plates, win.prep_minutes, false, win.id
    )
    on conflict (week_id, day_index) do update set
      title = excluded.title,
      pitch = excluded.pitch,
      audience = excluded.audience,
      servings = excluded.servings,
      prep_minutes = excluded.prep_minutes,
      is_leftovers = false,
      leftover_of_meal_id = null,
      source_option_id = excluded.source_option_id
    where public.meals.source_option_id is distinct from excluded.source_option_id
    returning id into mid;

    if mid is not null then
      delete from public.recipes where meal_id = mid;
    end if;
  end loop;

  update public.weeks
  set finalized_at = now()
  where id = wid;

  perform private.lock_week_unchecked(wid);
  return true;
end;
$$;

revoke all on function private.try_finalize_week(uuid) from public;

create or replace function public.set_meal_pick(target_option uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mem public.memberships%rowtype;
  opt public.meal_options%rowtype;
  w public.weeks%rowtype;
  cooking public.weeks%rowtype;
  label text;
  pid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into mem
  from public.memberships
  where user_id = uid
  order by created_at asc
  limit 1;

  select * into opt from public.meal_options where id = target_option;

  if mem.id is null
    or mem.role not in ('owner', 'voter')
    or opt.id is null
    or opt.household_id is distinct from mem.household_id then
    raise exception 'Eaters can look, not vote.';
  end if;

  select * into w
  from public.weeks
  where id = opt.week_id
    and household_id = mem.household_id;

  if w.id is null
    or w.ballot_mode is distinct from 'choice3'
    or w.status is distinct from 'voting'
    or w.finalized_at is not null then
    raise exception 'Voting is closed for this week.';
  end if;

  select * into cooking from private.open_cooking_week(mem.household_id);
  if cooking.id is null
    or (
      w.starts_on is distinct from cooking.starts_on
      and w.starts_on is distinct from cooking.starts_on + 7
    ) then
    raise exception 'Only this week and next week can be locked.';
  end if;

  if not exists (
    select 1
    from private.choice_active_nights(w.id) n
    where n.day_index = opt.day_index
  ) then
    label := (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[
      extract(dow from (w.starts_on + opt.day_index))::int + 1
    ];
    raise exception '% is an off night.', label;
  end if;

  if exists (
    select 1
    from public.week_vote_submissions s
    where s.week_id = w.id
      and s.membership_id = mem.id
  ) then
    raise exception 'You already locked in. Ask an Admin to reopen your vote.';
  end if;

  if exists (
    select 1
    from public.meal_option_requests r
    where r.week_id = w.id
      and r.day_index = opt.day_index
      and r.status = 'pending'
  ) then
    raise exception 'New options are on the way for that night.';
  end if;

  insert into public.meal_option_picks (
    household_id, week_id, day_index, option_id, membership_id
  )
  values (w.household_id, w.id, opt.day_index, opt.id, mem.id)
  on conflict (week_id, day_index, membership_id) do update
    set option_id = excluded.option_id,
        updated_at = now()
  returning id into pid;

  return pid;
end;
$$;

revoke all on function public.set_meal_pick(uuid) from public;
grant execute on function public.set_meal_pick(uuid) to authenticated;

create or replace function public.submit_week_vote(target_week uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mem public.memberships%rowtype;
  w public.weeks%rowtype;
  cooking public.weeks%rowtype;
  gap integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into mem
  from public.memberships
  where user_id = uid
  order by created_at asc
  limit 1;

  if mem.id is null or mem.role not in ('owner', 'voter') then
    raise exception 'Eaters can look, not vote.';
  end if;

  select * into w
  from public.weeks
  where id = target_week
    and household_id = mem.household_id;

  if w.id is null
    or w.ballot_mode is distinct from 'choice3'
    or w.status is distinct from 'voting'
    or w.finalized_at is not null then
    raise exception 'Voting is closed for this week.';
  end if;

  select * into cooking from private.open_cooking_week(mem.household_id);
  if cooking.id is null
    or (
      w.starts_on is distinct from cooking.starts_on
      and w.starts_on is distinct from cooking.starts_on + 7
    ) then
    raise exception 'Only this week and next week can be locked.';
  end if;

  select count(*) into gap
  from private.choice_active_nights(w.id) n
  where (
    select count(*) from public.meal_options o
    where o.week_id = w.id and o.day_index = n.day_index
  ) <> 3
  or exists (
    select 1
    from public.meal_option_requests r
    where r.week_id = w.id
      and r.day_index = n.day_index
      and r.status = 'pending'
  );

  if gap > 0 then
    raise exception 'Some nights are still waiting on options.';
  end if;

  select count(*) into gap
  from private.choice_active_nights(w.id) n
  where not exists (
    select 1
    from public.meal_option_picks p
    where p.week_id = w.id
      and p.day_index = n.day_index
      and p.membership_id = mem.id
  );

  if gap > 0 then
    raise exception 'Pick one dinner for every night first.';
  end if;

  insert into public.week_vote_submissions (week_id, membership_id, household_id)
  values (w.id, mem.id, w.household_id)
  on conflict (week_id, membership_id) do nothing;

  return jsonb_build_object(
    'submitted', true,
    'finalized', private.try_finalize_week(w.id)
  );
end;
$$;

revoke all on function public.submit_week_vote(uuid) from public;
grant execute on function public.submit_week_vote(uuid) to authenticated;

create or replace function public.reopen_week_vote(target_week uuid, target_member uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mem public.memberships%rowtype;
  w public.weeks%rowtype;
  removed integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into mem
  from public.memberships
  where user_id = uid
  order by created_at asc
  limit 1;

  if mem.id is null or mem.role is distinct from 'owner' then
    raise exception 'Only an Admin can reopen a vote.';
  end if;

  select * into w
  from public.weeks
  where id = target_week
    and household_id = mem.household_id;

  if w.id is null
    or w.ballot_mode is distinct from 'choice3'
    or w.finalized_at is not null then
    raise exception 'Voting is closed for this week.';
  end if;

  if target_member is not null and not exists (
    select 1
    from public.memberships other
    where other.id = target_member
      and other.household_id = mem.household_id
  ) then
    raise exception 'That person is not in this household.';
  end if;

  if target_member is null then
    delete from public.week_vote_submissions where week_id = w.id;
  else
    delete from public.week_vote_submissions
    where week_id = w.id
      and membership_id = target_member;
  end if;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.reopen_week_vote(uuid, uuid) from public;
grant execute on function public.reopen_week_vote(uuid, uuid) to authenticated;

create or replace function public.request_night_options(
  target_week uuid,
  target_day smallint,
  note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mem public.memberships%rowtype;
  w public.weeks%rowtype;
  cooking public.weeks%rowtype;
  label text;
  cleaned text;
  rid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into mem
  from public.memberships
  where user_id = uid
  order by created_at asc
  limit 1;

  if mem.id is null or mem.role not in ('owner', 'voter') then
    raise exception 'Eaters can look, not vote.';
  end if;

  select * into w
  from public.weeks
  where id = target_week
    and household_id = mem.household_id;

  if w.id is null
    or w.ballot_mode is distinct from 'choice3'
    or w.status is distinct from 'voting'
    or w.finalized_at is not null then
    raise exception 'Voting is closed for this week.';
  end if;

  select * into cooking from private.open_cooking_week(mem.household_id);
  if cooking.id is null
    or (
      w.starts_on is distinct from cooking.starts_on
      and w.starts_on is distinct from cooking.starts_on + 7
    ) then
    raise exception 'Only this week and next week can be locked.';
  end if;

  if not exists (
    select 1
    from private.choice_active_nights(w.id) n
    where n.day_index = target_day
  ) then
    label := (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[
      extract(dow from (w.starts_on + target_day))::int + 1
    ];
    raise exception '% is an off night.', label;
  end if;

  if exists (
    select 1
    from public.week_vote_submissions s
    where s.week_id = w.id
      and s.membership_id = mem.id
  ) then
    raise exception 'You already locked in. Ask an Admin to reopen your vote.';
  end if;

  if exists (
    select 1
    from public.meal_option_requests r
    where r.week_id = w.id
      and r.day_index = target_day
      and r.status = 'pending'
  ) then
    raise exception 'New options are on the way for that night.';
  end if;

  cleaned := left(btrim(coalesce(note, '')), 280);

  insert into public.meal_option_requests (
    household_id, week_id, day_index, requested_by, note
  )
  values (w.household_id, w.id, target_day, mem.id, cleaned)
  returning id into rid;

  return rid;
end;
$$;

revoke all on function public.request_night_options(uuid, smallint, text) from public;
grant execute on function public.request_night_options(uuid, smallint, text) to authenticated;

create or replace function public.cancel_night_options_request(target_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  mem public.memberships%rowtype;
  req public.meal_option_requests%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into mem
  from public.memberships
  where user_id = uid
  order by created_at asc
  limit 1;

  select * into req
  from public.meal_option_requests
  where id = target_request;

  if mem.id is null
    or req.id is null
    or req.household_id is distinct from mem.household_id then
    raise exception 'That request is not in this household.';
  end if;

  if mem.role is distinct from 'owner' and req.requested_by is distinct from mem.id then
    raise exception 'Only the requester or an Admin can cancel that.';
  end if;

  update public.meal_option_requests
  set status = 'cancelled'
  where id = req.id
    and status = 'pending';
end;
$$;

revoke all on function public.cancel_night_options_request(uuid) from public;
grant execute on function public.cancel_night_options_request(uuid) to authenticated;

create or replace function public.submit_week_options(target_week uuid, nights jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  mem public.memberships%rowtype;
  hid uuid;
  w public.weeks%rowtype;
  cooking public.weeks%rowtype;
  night jsonb;
  opt jsonb;
  di integer;
  seen integer[] := '{}';
  plates integer;
  label text;
  title text;
  titles text[];
  pitch text;
  prep integer;
  servings integer;
  rank_n integer;
  had_options boolean := false;
  written integer[] := '{}';
  recipe_key text;
begin
  if not is_service then
    if uid is null then
      raise exception 'Not authenticated';
    end if;

    select * into mem
    from public.memberships
    where user_id = uid
    order by created_at asc
    limit 1;

    if mem.id is null or mem.role not in ('owner', 'voter') then
      raise exception 'Eaters can look, not vote.';
    end if;

    hid := mem.household_id;
  end if;

  if is_service then
    select * into w from public.weeks where id = target_week;
  else
    select * into w
    from public.weeks
    where id = target_week
      and household_id = hid;
  end if;

  if w.id is null then
    raise exception 'That week is not in this household.';
  end if;

  if w.ballot_mode is distinct from 'choice3'
    or w.status is distinct from 'voting'
    or w.finalized_at is not null then
    raise exception 'Voting is closed for this week.';
  end if;

  select * into cooking from private.open_cooking_week(w.household_id);
  if cooking.id is null
    or (
      w.starts_on is distinct from cooking.starts_on
      and w.starts_on is distinct from cooking.starts_on + 7
    ) then
    raise exception 'Only this week and next week can be locked.';
  end if;

  if nights is null or jsonb_typeof(nights) <> 'array' or jsonb_array_length(nights) = 0 then
    raise exception 'Each night needs exactly 3 options.';
  end if;

  for night in
    select value from jsonb_array_elements(nights)
  loop
    begin
      di := (night->>'day_index')::integer;
    exception
      when others then
        di := null;
    end;

    if di is null or di < 0 or di > 6 then
      raise exception 'Tue is an off night.';
    end if;

    if di = any (seen) then
      raise exception 'Each night needs exactly 3 options.';
    end if;
    seen := seen || di;

    label := (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[
      extract(dow from (w.starts_on + di))::int + 1
    ];

    select n.plates into plates
    from private.choice_active_nights(w.id) n
    where n.day_index = di;

    if not found then
      raise exception '% is an off night.', label;
    end if;

    if jsonb_typeof(night->'options') is distinct from 'array'
      or jsonb_array_length(night->'options') <> 3 then
      raise exception 'Each night needs exactly 3 options.';
    end if;

    titles := '{}';
    for opt in
      select value from jsonb_array_elements(night->'options')
    loop
      title := btrim(coalesce(opt->>'title', ''));
      if title = '' or char_length(title) > 120 then
        raise exception 'Each night needs exactly 3 options.';
      end if;
      if lower(title) = any (titles) then
        raise exception 'Each night needs exactly 3 options.';
      end if;
      titles := titles || lower(title);

      pitch := coalesce(opt->>'pitch', '');
      if char_length(pitch) > 280 then
        raise exception 'Keep each pitch under 280 characters.';
      end if;

      begin
        servings := (opt->>'servings')::integer;
      exception
        when others then
          servings := null;
      end;

      if servings is distinct from plates then
        raise exception 'Servings must match plates for % (%).', label, plates;
      end if;

      begin
        prep := coalesce((opt->>'prep_minutes')::integer, 30);
      exception
        when others then
          prep := null;
      end;

      if prep is null or prep < 5 or prep > 240 then
        raise exception 'Prep time must be between 5 and 240 minutes.';
      end if;
    end loop;
  end loop;

  for night in
    select value from jsonb_array_elements(nights)
  loop
    di := (night->>'day_index')::integer;
    label := (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[
      extract(dow from (w.starts_on + di))::int + 1
    ];
    select n.plates into plates
    from private.choice_active_nights(w.id) n
    where n.day_index = di;

    if exists (
      select 1
      from public.meal_options o
      where o.week_id = w.id
        and o.day_index = di
    ) then
      had_options := true;
    end if;

    delete from public.meal_options
    where week_id = w.id
      and day_index = di;

    rank_n := 0;
    for opt in
      select value from jsonb_array_elements(night->'options')
    loop
      rank_n := rank_n + 1;
      title := btrim(opt->>'title');
      pitch := coalesce(opt->>'pitch', '');
      prep := coalesce((opt->>'prep_minutes')::integer, 30);
      recipe_key := nullif(btrim(coalesce(opt->>'recipe_key', '')), '');
      insert into public.meal_options (
        household_id, week_id, day_index, night_date, rank,
        title, pitch, servings, prep_minutes, recipe_key
      )
      values (
        w.household_id, w.id, di, w.starts_on + di, rank_n,
        title, pitch, plates, prep, recipe_key
      );
    end loop;

    update public.meal_option_requests
    set status = 'fulfilled',
        fulfilled_at = now()
    where week_id = w.id
      and day_index = di
      and status = 'pending';

    written := written || di;
  end loop;

  if had_options then
    delete from public.week_vote_submissions where week_id = w.id;
  end if;

  return jsonb_build_object(
    'week_id', w.id,
    'nights_written', to_jsonb(written),
    'submissions_cleared', had_options
  );
end;
$$;

revoke all on function public.submit_week_options(uuid, jsonb) from public;
grant execute on function public.submit_week_options(uuid, jsonb) to authenticated, service_role;

-- Lock guard. Choice3 weeks lock only after finalize has written the winners.
create or replace function private.enforce_week_lock()
returns trigger
language plpgsql
as $$
declare
  voter_count integer;
  night_count integer;
  blockers integer;
begin
  if new.status = 'locked' and old.status is distinct from 'locked' then
    if new.ballot_mode = 'choice3' and new.finalized_at is null then
      raise exception 'Week cannot lock until every voter has locked in their vote';
    end if;

    select count(*) into voter_count
    from public.memberships mem
    where mem.household_id = new.household_id
      and mem.role in ('owner', 'voter');

    select count(*) into night_count
    from public.meals m
    where m.week_id = new.id;

    with latest as (
      select distinct on (v.meal_id)
        v.meal_id,
        v.choice
      from public.votes v
      join public.memberships mem on mem.id = v.membership_id
      join public.meals m on m.id = v.meal_id
      where m.week_id = new.id
        and mem.role in ('owner', 'voter')
        and v.choice in ('swap', 'remove', 'request_new_meal')
      order by v.meal_id, v.updated_at desc, v.id desc
    )
    select count(*) into blockers
    from latest
    where choice in ('swap', 'request_new_meal');

    if voter_count = 0 then
      raise exception 'Week cannot lock without a voting member';
    end if;
    if night_count = 0 then
      raise exception 'Week cannot lock until this week has at least one night';
    end if;
    if blockers > 0 then
      raise exception 'Week cannot lock while a swap or new-meal request is open';
    end if;
    new.locked_at = coalesce(new.locked_at, now());
  end if;
  if new.status = 'voting' then
    new.locked_at = null;
    if new.ballot_mode = 'choice3' and old.status = 'locked' then
      new.finalized_at = null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.reopen_choice_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'locked' and new.status = 'voting' and new.ballot_mode = 'choice3' then
    delete from public.week_vote_submissions where week_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.reopen_choice_vote() from public;

drop trigger if exists weeks_reopen_choice_vote on public.weeks;
create trigger weeks_reopen_choice_vote
  after update on public.weeks
  for each row execute function private.reopen_choice_vote();

create or replace function private.finalize_after_member_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;

  if not exists (
    select 1 from public.households h where h.id = old.household_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  for wid in
    select w.id
    from public.weeks w
    where w.household_id = old.household_id
      and w.ballot_mode = 'choice3'
      and w.status = 'voting'
      and w.finalized_at is null
  loop
    begin
      perform private.try_finalize_week(wid);
    exception
      when others then
        raise warning '%', sqlerrm;
    end;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.finalize_after_member_change() from public;

drop trigger if exists memberships_finalize_choice_vote on public.memberships;
create trigger memberships_finalize_choice_vote
  after update of role or delete on public.memberships
  for each row execute function private.finalize_after_member_change();

-- Saves plates for the viewed cooking or planning week.
-- Choice3 nights get options instead of a blank meals row.
create or replace function public.save_week_people(
  target_week uuid,
  counts integer[],
  instructions text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  member_role text;
  cooking public.weeks%rowtype;
  target public.weeks%rowtype;
  effective integer[];
  notes text;
  dinners integer;
  is_planning boolean;
  any_meals boolean;
  i integer;
  night date;
  dow integer;
  plates integer;
  prior integer;
  mid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select m.household_id, m.role into hid, member_role
  from public.memberships m
  where m.user_id = uid
  order by m.created_at asc
  limit 1;

  if hid is null or member_role not in ('owner', 'voter') then
    raise exception 'Eaters can look, not change nights.';
  end if;

  if counts is null or cardinality(counts) <> 7 then
    raise exception 'Set at least one dinner night (plates above zero).';
  end if;

  if exists (
    select 1
    from unnest(counts) as headcount
    where headcount is null or headcount < 0 or headcount > 12
  ) then
    raise exception 'Set at least one dinner night (plates above zero).';
  end if;

  select * into target
  from public.weeks
  where id = target_week
    and household_id = hid;

  if target.id is null then
    raise exception 'That week is not in this household.';
  end if;

  select * into cooking from private.open_cooking_week(hid);
  if cooking.id is null
    or (
      target.starts_on is distinct from cooking.starts_on
      and target.starts_on is distinct from cooking.starts_on + 7
    ) then
    raise exception 'Only this week and next week can change nights.';
  end if;

  if target.status = 'locked' then
    raise exception 'Unlock this week before changing nights.';
  end if;

  is_planning := target.starts_on = cooking.starts_on + 7;
  effective := counts;

  for i in 0..6 loop
    night := target.starts_on + i;
    dow := extract(dow from night)::int;
    if target.editable_from is not null and night < target.editable_from then
      if target.night_headcounts is not null and cardinality(target.night_headcounts) = 7 then
        effective[dow + 1] := target.night_headcounts[dow + 1];
      else
        prior := null;
        select m.servings into prior
        from public.meals m
        where m.week_id = target.id
          and m.day_index = i;
        if found then
          effective[dow + 1] := least(12, greatest(0, prior));
        else
          effective[dow + 1] := 0;
        end if;
      end if;
    end if;
  end loop;

  select count(*)::integer into dinners from unnest(effective) as headcount where headcount > 0;
  if dinners < 1 then
    raise exception 'Set at least one dinner night (plates above zero).';
  end if;

  if is_planning
    or (target.special_instructions is not null and btrim(target.special_instructions) <> '') then
    notes := nullif(left(btrim(coalesce(instructions, '')), 500), '');
  else
    notes := null;
  end if;

  update public.weeks
  set
    night_headcounts = effective,
    special_instructions = notes,
    people_confirmed_at = coalesce(people_confirmed_at, now())
  where id = target.id;

  if target.ballot_mode = 'choice3' then
    for i in 0..6 loop
      night := target.starts_on + i;
      dow := extract(dow from night)::int;
      plates := effective[dow + 1];
      if target.editable_from is not null and night < target.editable_from then
        continue;
      end if;

      if plates = 0 then
        delete from public.meal_options
        where week_id = target.id
          and day_index = i;
        update public.meal_option_requests
        set status = 'cancelled'
        where week_id = target.id
          and day_index = i
          and status = 'pending';
      else
        update public.meal_options
        set servings = plates
        where week_id = target.id
          and day_index = i;
      end if;
    end loop;

    if target.finalized_at is null then
      delete from public.week_vote_submissions where week_id = target.id;
    end if;
  end if;

  select exists (select 1 from public.meals m where m.week_id = target.id) into any_meals;

  if any_meals then
    for i in 0..6 loop
      night := target.starts_on + i;
      dow := extract(dow from night)::int;
      plates := effective[dow + 1];
      if target.editable_from is not null and night < target.editable_from then
        continue;
      end if;

      mid := null;
      select m.id into mid
      from public.meals m
      where m.week_id = target.id
        and m.day_index = i;

      if plates = 0 then
        if mid is not null then
          delete from public.meals where id = mid;
        end if;
      elsif mid is null then
        if target.ballot_mode is distinct from 'choice3' then
          insert into public.meals (
            household_id,
            week_id,
            day_index,
            night_date,
            title,
            pitch,
            audience,
            servings,
            prep_minutes,
            is_leftovers
          )
          values (
            hid,
            target.id,
            i,
            night,
            '',
            '',
            case when plates = 2 then 'couple' else 'family' end,
            plates,
            30,
            false
          );
        end if;
      else
        update public.meals
        set
          servings = plates,
          audience = case when plates = 2 then 'couple' else 'family' end
        where id = mid;

        update public.recipes
        set servings = plates
        where meal_id = mid;
      end if;
    end loop;
  end if;

  update public.ballot_requests
  set
    night_headcounts = effective,
    nights_planned = dinners,
    special_instructions = case when is_planning then notes else special_instructions end,
    updated_at = now()
  where week_id = target.id;

  if is_planning and not exists (
    select 1 from public.ballot_requests where week_id = target.id
  ) then
    return private.queue_week_ballot(hid, target.id, uid);
  end if;

  return target.id;
end;
$$;

revoke all on function public.save_week_people(uuid, integer[], text) from public;
grant execute on function public.save_week_people(uuid, integer[], text) to authenticated;
