-- 20261005130000_try_finalize_week_loop_nt.sql
-- Copy of live private.try_finalize_week. The night loop row was named n, and
-- PL/pgSQL substituted that record into the SQL that also aliased
-- choice_active_nights as n. Live names the loop row nt and that alias an.

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
  nt record;
  win public.meal_options%rowtype;
  mid uuid;
begin
  select * into w from public.weeks where id = wid for update;

  if w.id is null
    or w.ballot_mode is distinct from 'choice3'
    or w.status is distinct from 'voting'
    or w.finalized_at is not null then
    return false;
  end if;

  select count(*) into voters
  from public.memberships mem
  where mem.household_id = w.household_id and mem.role in ('owner', 'voter');

  if voters = 0 then return false; end if;

  select count(*) into missing
  from public.memberships mem
  where mem.household_id = w.household_id
    and mem.role in ('owner', 'voter')
    and not exists (
      select 1 from public.week_vote_submissions s
      where s.week_id = w.id and s.membership_id = mem.id
    );

  if missing > 0 then return false; end if;

  select count(*) into nights from private.choice_active_nights(w.id);
  if nights = 0 then return false; end if;

  select count(*) into bad
  from private.choice_active_nights(w.id) an
  where (
    select count(*) from public.meal_options o
    where o.week_id = w.id and o.day_index = an.day_index
  ) <> 3
  or exists (
    select 1 from public.meal_option_requests r
    where r.week_id = w.id and r.day_index = an.day_index and r.status = 'pending'
  );

  if bad > 0 then return false; end if;

  for nt in select * from private.choice_active_nights(w.id)
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
    where o.week_id = wid and o.day_index = nt.day_index
    order by c.votes desc, ow.owner_at asc nulls last, o.rank asc
    limit 1;

    mid := null;
    insert into public.meals (
      household_id, week_id, day_index, night_date, title, pitch, audience,
      servings, prep_minutes, is_leftovers, source_option_id
    )
    values (
      w.household_id, wid, nt.day_index, nt.night_date, win.title, win.pitch,
      case when nt.plates = 2 then 'couple' else 'family' end,
      nt.plates, win.prep_minutes, false, win.id
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

  update public.weeks set finalized_at = now() where id = wid;

  perform private.lock_week_unchecked(wid);
  return true;
end;
$$;

revoke all on function private.try_finalize_week(uuid) from public;
