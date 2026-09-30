-- Last cooked is the dinner's night, not the moment the week was locked.
-- A week locked Sunday Sep 27 and a dinner on Tuesday Sep 29 must show Sep 29.
-- The instant is noon in the house timezone so a date-only night does not
-- become the previous evening when the house is behind UTC.

create or replace function private.cook_night_instant(night date, tz text)
returns timestamptz
language plpgsql
stable
as $$
declare
  zone text := coalesce(nullif(btrim(tz), ''), 'America/Los_Angeles');
begin
  return (night::timestamp + time '12:00') at time zone zone;
exception
  when invalid_parameter_value then
    return (night::timestamp + time '12:00') at time zone 'America/Los_Angeles';
end;
$$;

revoke all on function private.cook_night_instant(date, text) from public;

comment on function private.cook_night_instant(date, text) is
  'Noon on a calendar night in the household timezone. Saved meals store this as last_locked_at so the cooked date does not follow the week lock click or UTC midnight.';

create or replace function private.stamp_saved_meals_on_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  zone text;
begin
  if new.status = 'locked' and old.status is distinct from 'locked' then
    select coalesce(nullif(btrim(h.timezone), ''), 'America/Los_Angeles')
      into zone
    from public.households h
    where h.id = new.household_id;

    update public.saved_meals sm
    set
      last_locked_at = private.cook_night_instant(matched.night_date, zone),
      title = matched.title,
      requested_for_week = case
        when sm.requested_for_week is not null and sm.requested_for_week <= new.starts_on then null
        else sm.requested_for_week
      end,
      updated_at = now()
    from (
      select distinct on (recipe_key)
        recipe_key,
        title,
        night_date
      from (
        select
          private.saved_meal_recipe_key(r.recipe_key, m.title) as recipe_key,
          btrim(m.title) as title,
          m.night_date
        from public.meals m
        left join public.recipes r on r.meal_id = m.id
        where m.week_id = new.id
          and m.household_id = new.household_id
          and m.is_leftovers = false
          and char_length(btrim(m.title)) > 0
          and not exists (
            select 1
            from (
              select distinct on (v.meal_id) v.choice
              from public.votes v
              join public.memberships mem on mem.id = v.membership_id
              where v.meal_id = m.id
                and mem.role in ('owner', 'voter')
              order by v.meal_id, v.updated_at desc, v.id desc
            ) latest
            where latest.choice in ('remove', 'skip', 'request_new_meal')
          )
      ) keyed
      where recipe_key is not null
      order by recipe_key, night_date desc
    ) matched
    where sm.household_id = new.household_id
      and sm.recipe_key = matched.recipe_key;
  end if;
  return new;
end;
$$;

comment on column public.saved_meals.last_locked_at is
  'Noon on the last night this meal was a non-removed dinner on a locked week, in the house timezone. Not the week lock click. Random re-suggest waits 21 days after this instant. Null until the first locked cook.';

-- Rows already stamped with the week lock click: move them to that week's dinner night.
update public.saved_meals sm
set
  last_locked_at = picked.instant,
  updated_at = now()
from (
  select distinct on (sm2.id)
    sm2.id,
    private.cook_night_instant(m.night_date, h.timezone) as instant
  from public.saved_meals sm2
  join public.households h on h.id = sm2.household_id
  join public.weeks w
    on w.household_id = sm2.household_id
   and w.status = 'locked'
  join public.meals m
    on m.week_id = w.id
   and m.household_id = w.household_id
   and m.is_leftovers = false
   and char_length(btrim(m.title)) > 0
  left join public.recipes r on r.meal_id = m.id
  where sm2.last_locked_at is not null
    and private.saved_meal_recipe_key(r.recipe_key, m.title) = sm2.recipe_key
    and sm2.last_locked_at >= (
      w.starts_on::timestamp
      at time zone coalesce(nullif(btrim(h.timezone), ''), 'America/Los_Angeles')
    )
    and sm2.last_locked_at < (
      (w.starts_on + 7)::timestamp
      at time zone coalesce(nullif(btrim(h.timezone), ''), 'America/Los_Angeles')
    )
    and not exists (
      select 1
      from (
        select distinct on (v.meal_id) v.choice
        from public.votes v
        join public.memberships mem on mem.id = v.membership_id
        where v.meal_id = m.id
          and mem.role in ('owner', 'voter')
        order by v.meal_id, v.updated_at desc, v.id desc
      ) latest
      where latest.choice in ('remove', 'skip', 'request_new_meal')
    )
  order by sm2.id, m.night_date desc
) picked
where sm.id = picked.id
  and sm.last_locked_at is distinct from picked.instant;
