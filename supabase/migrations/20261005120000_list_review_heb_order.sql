-- 20261005120000_list_review_heb_order.sql
-- List review (soft remove / manual add) → approve → bot H-E-B order with status tracking.

-- ---------- 4.1 Columns ----------
alter table public.households
  add column if not exists heb_checkout_mode text not null default 'review',
  add column if not exists delivery_days smallint[],
  add column if not exists delivery_window_start time,
  add column if not exists delivery_window_end time,
  add column if not exists order_max_cents integer,
  add column if not exists list_approver_role text not null default 'owner';

alter table public.households
  drop constraint if exists households_heb_checkout_mode_check,
  add constraint households_heb_checkout_mode_check check (heb_checkout_mode in ('auto','review')),
  drop constraint if exists households_list_approver_role_check,
  add constraint households_list_approver_role_check check (list_approver_role in ('owner','voter')),
  drop constraint if exists households_order_max_cents_check,
  add constraint households_order_max_cents_check check (order_max_cents is null or order_max_cents between 100 and 500000),
  drop constraint if exists households_delivery_days_check,
  add constraint households_delivery_days_check check (delivery_days is null or delivery_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  drop constraint if exists households_delivery_window_check,
  add constraint households_delivery_window_check check (
    delivery_window_start is null or delivery_window_end is null or delivery_window_end > delivery_window_start);

alter table public.shopping_lists
  add column if not exists status text not null default 'review',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.memberships(id) on delete set null,
  add column if not exists order_status_at timestamptz,
  add column if not exists ordered_at timestamptz,
  add column if not exists delivery_window_start timestamptz,
  add column if not exists delivery_window_end timestamptz,
  add column if not exists delivery_label text,
  add column if not exists subtotal_cents integer,
  add column if not exists order_total_cents integer,
  add column if not exists order_number text,
  add column if not exists cart_url text,
  add column if not exists order_message text,
  add column if not exists over_guard boolean not null default false;

alter table public.shopping_lists
  drop constraint if exists shopping_lists_status_check,
  add constraint shopping_lists_status_check check (
    status in ('review','approved','carting','awaiting_review','ordered','failed'));

alter table public.shopping_items
  add column if not exists source text not null default 'recipe',
  add column if not exists note text,
  add column if not exists added_by uuid references public.memberships(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.memberships(id) on delete set null,
  add column if not exists cart_status text,
  add column if not exists cart_product text,
  add column if not exists cart_quantity numeric,
  add column if not exists cart_price_cents integer,
  add column if not exists cart_note text,
  add column if not exists cart_updated_at timestamptz;

alter table public.shopping_items
  drop constraint if exists shopping_items_source_check,
  add constraint shopping_items_source_check check (source in ('recipe','manual')),
  drop constraint if exists shopping_items_cart_status_check,
  add constraint shopping_items_cart_status_check check (
    cart_status is null or cart_status in ('added','not_found','substituted','skipped')),
  drop constraint if exists shopping_items_note_len,
  add constraint shopping_items_note_len check (note is null or char_length(note) <= 140);

-- Writes only through RPCs from here on.
drop policy if exists items_member_update on public.shopping_items;

-- ---------- 4.2 Helpers ----------
create or replace function private.list_actor(target_list uuid, need_edit boolean default true)
returns public.memberships
language plpgsql
stable
security definer
set search_path = public
as $$
declare mem public.memberships%rowtype; hid uuid;
begin
  select household_id into hid from public.shopping_lists where id = target_list;
  if hid is null then raise exception 'That list is gone.' using errcode = 'P0002'; end if;
  select m.* into mem from public.memberships m
  where m.household_id = hid and m.user_id = auth.uid();
  if mem.id is null then raise exception 'Not in this household' using errcode = '42501'; end if;
  if need_edit and mem.role not in ('owner','voter') then
    raise exception 'Eaters can look, not change the list.' using errcode = '42501';
  end if;
  return mem;
end;
$$;
revoke all on function private.list_actor(uuid, boolean) from public;

-- ---------- 4.3 Rebuild keeps review edits; frozen after approval ----------
-- Same signature and lock behavior as 20261003120000. Only the list part changes.
create or replace function private.lock_week_unchecked(wid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  lid uuid;
  lstatus text;
  removed jsonb;
begin
  select household_id into hid from public.weeks where id = wid;
  if hid is null then
    raise exception 'That week is not in this household.';
  end if;

  update public.weeks set status = 'locked' where id = wid;

  select id, status into lid, lstatus from public.shopping_lists where week_id = wid for update;
  if lid is not null and lstatus <> 'review' then
    return lid; -- approved / in flight / ordered / failed: never rebuild under the bot
  end if;

  if lid is null then
    insert into public.shopping_lists (household_id, week_id) values (hid, wid) returning id into lid;
  else
    update public.shopping_lists set generated_at = now() where id = lid;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'k', lower(btrim(name)), 'u', unit, 's', store_id, 'at', removed_at, 'by', removed_by)), '[]'::jsonb)
  into removed
  from public.shopping_items
  where shopping_list_id = lid and source = 'recipe' and removed_at is not null;

  delete from public.shopping_items where shopping_list_id = lid and source = 'recipe';

  insert into public.shopping_items (
    household_id, shopping_list_id, store_id, name, quantity, unit, source
  )
  select hid, lid, ri.store_id, ri.name, sum(ri.quantity), ri.unit, 'recipe'
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

  update public.shopping_items si
  set removed_at = (r ->> 'at')::timestamptz,
      removed_by = nullif(r ->> 'by', '')::uuid
  from jsonb_array_elements(removed) r
  where si.shopping_list_id = lid
    and si.source = 'recipe'
    and lower(btrim(si.name)) = r ->> 'k'
    and si.unit = r ->> 'u'
    and si.store_id is not distinct from nullif(r ->> 's', '')::uuid;

  return lid;
end;
$$;
revoke all on function private.lock_week_unchecked(uuid) from public;

-- Unlock: block while the bot is mid-order; un-approve otherwise.
create or replace function private.guard_week_unlock_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare lstatus text;
begin
  if old.status = 'locked' and new.status is distinct from 'locked' then
    select status into lstatus from public.shopping_lists where week_id = new.id;
    if lstatus in ('carting', 'awaiting_review') then
      raise exception 'The H-E-B order is in progress. Reopen the list or wait for it to finish.'
        using errcode = '55000';
    end if;
    if lstatus in ('approved', 'failed') then
      update public.shopping_lists
      set status = 'review', approved_at = null, approved_by = null, order_message = null,
          order_status_at = now(), over_guard = false
      where week_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists weeks_guard_unlock_order on public.weeks;
create trigger weeks_guard_unlock_order
  before update of status on public.weeks
  for each row execute function private.guard_week_unlock_order();

-- ---------- 4.4 Member RPCs ----------
create or replace function public.remove_shopping_item(target_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare it public.shopping_items%rowtype; lstatus text; mem public.memberships%rowtype;
begin
  select * into it from public.shopping_items where id = target_item;
  if it.id is null then raise exception 'That item is gone.' using errcode = 'P0002'; end if;
  mem := private.list_actor(it.shopping_list_id);
  select status into lstatus from public.shopping_lists where id = it.shopping_list_id for update;
  if lstatus <> 'review' then
    raise exception 'This list is approved. Reopen it to make changes.' using errcode = '55000';
  end if;
  update public.shopping_items set removed_at = now(), removed_by = mem.id
  where id = it.id and removed_at is null;
end;
$$;

create or replace function public.restore_shopping_item(target_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare it public.shopping_items%rowtype; lstatus text; mem public.memberships%rowtype;
begin
  select * into it from public.shopping_items where id = target_item;
  if it.id is null then raise exception 'That item is gone.' using errcode = 'P0002'; end if;
  mem := private.list_actor(it.shopping_list_id);
  select status into lstatus from public.shopping_lists where id = it.shopping_list_id for update;
  if lstatus <> 'review' then
    raise exception 'This list is approved. Reopen it to make changes.' using errcode = '55000';
  end if;
  update public.shopping_items set removed_at = null, removed_by = null where id = it.id;
end;
$$;

create or replace function public.add_shopping_item(
  target_list uuid,
  item_name text,
  item_quantity numeric default 1,
  item_unit text default '',
  item_note text default null,
  target_store uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mem public.memberships%rowtype;
  l public.shopping_lists%rowtype;
  sid uuid;
  nm text := regexp_replace(btrim(coalesce(item_name, '')), '\s+', ' ', 'g');
  un text := btrim(coalesce(item_unit, ''));
  nt text := nullif(btrim(coalesce(item_note, '')), '');
  rid uuid;
begin
  mem := private.list_actor(target_list);
  select * into l from public.shopping_lists where id = target_list for update;
  if l.status <> 'review' then
    raise exception 'This list is approved. Reopen it to make changes.' using errcode = '55000';
  end if;
  if nm = '' or char_length(nm) > 80 then
    raise exception 'Item name must be 1–80 characters.' using errcode = '22023';
  end if;
  if item_quantity is null or item_quantity <= 0 or item_quantity > 999 then
    raise exception 'Quantity must be between 0 and 999.' using errcode = '22023';
  end if;
  if char_length(un) > 20 or (nt is not null and char_length(nt) > 140) then
    raise exception 'Unit or note is too long.' using errcode = '22023';
  end if;

  select s.id into sid from public.household_stores s
  where s.household_id = l.household_id and (target_store is null or s.id = target_store)
  order by s.sort_order, s.name
  limit 1;
  if sid is null then
    raise exception 'Add a store in House first.' using errcode = '22023';
  end if;

  insert into public.shopping_items (
    household_id, shopping_list_id, store_id, name, quantity, unit, note, source, added_by
  )
  values (l.household_id, l.id, sid, nm, round(item_quantity, 2), un, nt, 'manual', mem.id)
  returning id into rid;
  return rid;
end;
$$;

create or replace function public.approve_shopping_list(target_list uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  mem public.memberships%rowtype;
  l public.shopping_lists%rowtype;
  approver text;
  active integer;
  wstatus text;
begin
  mem := private.list_actor(target_list);
  select * into l from public.shopping_lists where id = target_list for update;
  select h.list_approver_role into approver from public.households h where h.id = l.household_id;
  if not (mem.role = 'owner' or (approver = 'voter' and mem.role = 'voter')) then
    raise exception 'Only an Admin can approve the list.' using errcode = '42501';
  end if;
  select status into wstatus from public.weeks where id = l.week_id;
  if wstatus <> 'locked' then
    raise exception 'Lock the week first.' using errcode = '55000';
  end if;
  if l.status <> 'review' then
    raise exception 'This list is already approved.' using errcode = '55000';
  end if;
  select count(*) into active from public.shopping_items
  where shopping_list_id = l.id and removed_at is null;
  if active = 0 then
    raise exception 'Nothing to buy. Add an item or put one back.' using errcode = '55000';
  end if;

  update public.shopping_lists
  set status = 'approved', approved_at = now(), approved_by = mem.id, order_status_at = now(),
      order_message = null, over_guard = false
  where id = l.id;
  return jsonb_build_object('list_id', l.id, 'status', 'approved', 'items', active);
end;
$$;

create or replace function public.reopen_shopping_list(target_list uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare mem public.memberships%rowtype; l public.shopping_lists%rowtype;
begin
  mem := private.list_actor(target_list);
  if mem.role <> 'owner' then
    raise exception 'Only an Admin can reopen the list.' using errcode = '42501';
  end if;
  select * into l from public.shopping_lists where id = target_list for update;
  if l.status not in ('approved', 'awaiting_review', 'failed') then
    raise exception 'This list can''t be reopened now.' using errcode = '55000';
  end if;
  update public.shopping_lists
  set status = 'review', approved_at = null, approved_by = null, order_status_at = now(),
      delivery_window_start = null, delivery_window_end = null, delivery_label = null,
      subtotal_cents = null, order_total_cents = null, order_number = null, cart_url = null,
      order_message = null, over_guard = false
  where id = l.id;
  update public.shopping_items
  set cart_status = null, cart_product = null, cart_quantity = null, cart_price_cents = null,
      cart_note = null, cart_updated_at = null
  where shopping_list_id = l.id;
end;
$$;

create or replace function public.retry_shopping_order(target_list uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare mem public.memberships%rowtype; l public.shopping_lists%rowtype; approver text;
begin
  mem := private.list_actor(target_list);
  select * into l from public.shopping_lists where id = target_list for update;
  select h.list_approver_role into approver from public.households h where h.id = l.household_id;
  if not (mem.role = 'owner' or (approver = 'voter' and mem.role = 'voter')) then
    raise exception 'Only an Admin can retry the order.' using errcode = '42501';
  end if;
  if l.status <> 'failed' then
    raise exception 'Only a failed order can be retried.' using errcode = '55000';
  end if;
  update public.shopping_lists
  set status = 'approved', order_message = null, order_status_at = now(), over_guard = false
  where id = l.id;
end;
$$;

create or replace function public.mark_order_placed(target_list uuid, placed_order_number text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare mem public.memberships%rowtype; l public.shopping_lists%rowtype;
begin
  mem := private.list_actor(target_list);
  select * into l from public.shopping_lists where id = target_list for update;
  if l.status <> 'awaiting_review' then
    raise exception 'There''s no cart waiting for checkout.' using errcode = '55000';
  end if;
  update public.shopping_lists
  set status = 'ordered', ordered_at = now(), order_status_at = now(),
      order_number = coalesce(nullif(btrim(placed_order_number), ''), order_number)
  where id = l.id;
end;
$$;

-- ---------- 4.5 Bot RPC ----------
-- Auth like submit_week_options: service_role, or an owner/voter member JWT of the list's household.
create or replace function public.report_order_status(
  target_list uuid,
  new_status text,
  details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  l public.shopping_lists%rowtype;
  h public.households%rowtype;
  mem public.memberships%rowtype;
  d jsonb := coalesce(details, '{}'::jsonb);
  it jsonb;
  guard integer;
  total integer;
  updated_items integer := 0;
  ok_transition boolean;
begin
  select * into l from public.shopping_lists where id = target_list for update;
  if l.id is null then raise exception 'That list is gone.' using errcode = 'P0002'; end if;
  if not is_service then
    mem := private.list_actor(target_list); -- owner/voter of this household
  end if;
  select * into h from public.households where id = l.household_id;

  if new_status not in ('carting', 'awaiting_review', 'ordered', 'failed') then
    raise exception 'Status must be carting, awaiting_review, ordered, or failed.' using errcode = '22023';
  end if;

  ok_transition := case l.status
    when 'approved'        then new_status in ('carting', 'failed')
    when 'carting'         then new_status in ('carting', 'awaiting_review', 'ordered', 'failed')
    when 'awaiting_review' then new_status in ('carting', 'awaiting_review', 'ordered', 'failed')
    when 'ordered'         then new_status = 'ordered' -- detail updates only (e.g. window moved)
    else false
  end;
  if not ok_transition then
    raise exception 'Can''t go from % to %.', l.status, new_status using errcode = '55000';
  end if;

  if new_status = 'ordered' and h.heb_checkout_mode = 'review' and l.status not in ('awaiting_review', 'ordered') then
    raise exception 'This house reviews the cart first. Report awaiting_review.' using errcode = '42501';
  end if;

  -- per-item cart results
  for it in select value from jsonb_array_elements(coalesce(d -> 'items', '[]'::jsonb)) loop
    if coalesce(it ->> 'result', '') not in ('added', 'not_found', 'substituted', 'skipped') then
      raise exception 'Item result must be added, not_found, substituted, or skipped.' using errcode = '22023';
    end if;
    update public.shopping_items
    set cart_status = it ->> 'result',
        cart_product = left(nullif(btrim(it ->> 'product'), ''), 200),
        cart_quantity = nullif(it ->> 'quantity', '')::numeric,
        cart_price_cents = nullif(it ->> 'price_cents', '')::integer,
        cart_note = left(nullif(btrim(it ->> 'note'), ''), 200),
        cart_updated_at = now()
    where id = (it ->> 'item_id')::uuid and shopping_list_id = l.id;
    if found then updated_items := updated_items + 1; end if;
  end loop;

  total := coalesce(nullif(d ->> 'order_total_cents', '')::integer, l.order_total_cents);
  guard := coalesce(h.order_max_cents, h.weekly_budget_cents);

  update public.shopping_lists
  set status = new_status,
      order_status_at = now(),
      ordered_at = case when new_status = 'ordered' then coalesce(ordered_at, now()) else ordered_at end,
      delivery_window_start = coalesce(nullif(d ->> 'delivery_window_start', '')::timestamptz, delivery_window_start),
      delivery_window_end = coalesce(nullif(d ->> 'delivery_window_end', '')::timestamptz, delivery_window_end),
      delivery_label = coalesce(left(nullif(btrim(d ->> 'delivery_label'), ''), 80), delivery_label),
      subtotal_cents = coalesce(nullif(d ->> 'subtotal_cents', '')::integer, subtotal_cents),
      order_total_cents = total,
      order_number = coalesce(left(nullif(btrim(d ->> 'order_number'), ''), 40), order_number),
      cart_url = coalesce(nullif(btrim(d ->> 'cart_url'), ''), cart_url),
      order_message = case when d ? 'message' then left(nullif(btrim(d ->> 'message'), ''), 300) else order_message end,
      over_guard = (guard is not null and total is not null and total > guard)
  where id = l.id;

  return jsonb_build_object(
    'list_id', l.id, 'status', new_status, 'items_updated', updated_items,
    'guard_cents', guard, 'over_guard', (guard is not null and total is not null and total > guard)
  );
end;
$$;

-- ---------- 4.6 Grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.remove_shopping_item(uuid)',
    'public.restore_shopping_item(uuid)',
    'public.add_shopping_item(uuid, text, numeric, text, text, uuid)',
    'public.approve_shopping_list(uuid)',
    'public.reopen_shopping_list(uuid)',
    'public.retry_shopping_order(uuid)',
    'public.mark_order_placed(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.report_order_status(uuid, text, jsonb) from public;
grant execute on function public.report_order_status(uuid, text, jsonb) to authenticated, service_role;

-- ---------- 4.7 Push: order events (extends 20261004120000) ----------
alter table private.push_outbox drop constraint if exists push_outbox_kind_check;
alter table private.push_outbox add constraint push_outbox_kind_check check (kind in (
  'menu_ready','options_refreshed','week_locked','cart_ready','order_placed','order_failed'));

create or replace function private.push_on_list_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare k text; msg text;
begin
  if new.status is not distinct from old.status then return null; end if;
  k := case new.status
         when 'awaiting_review' then 'cart_ready'
         when 'ordered' then 'order_placed'
         when 'failed' then 'order_failed'
       end;
  if k is null then return null; end if;
  msg := case k
    when 'cart_ready' then coalesce(
      'Your H-E-B cart is ready. ' || nullif(new.order_message, '') || ' ',
      'Your H-E-B cart is ready. ') || 'Review and check out on heb.com.'
    when 'order_placed' then 'H-E-B order placed' ||
      coalesce(' · ' || nullif(new.delivery_label, ''), '') ||
      coalesce(' · $' || to_char(new.order_total_cents / 100.0, 'FM999990.00'), '') || '.'
    else 'The H-E-B order didn''t go through' || coalesce(': ' || nullif(new.order_message, ''), '.') end;
  insert into private.push_outbox (household_id, week_id, kind, dedupe_key, body, url)
  values (new.household_id, new.week_id, k,
          k || ':' || new.id || ':' || coalesce(new.order_status_at, now())::text,
          left(msg, 240), '/list')
  on conflict (dedupe_key) do nothing;
  return null;
end;
$$;

drop trigger if exists shopping_lists_push_status on public.shopping_lists;
create trigger shopping_lists_push_status
  after update of status on public.shopping_lists
  for each row execute function private.push_on_list_status();

-- Copied from 20261004120000. Pref maps order kinds to `orders`. Menu/lock lines stay.
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

  pref := case
    when o.kind = 'week_locked' then 'week_locked'
    when o.kind in ('menu_ready', 'options_refreshed') then 'menu_ready'
    else 'orders'
  end;
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

create or replace function public.set_push_order_prefs(p_endpoint text, p_orders boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions s
  set prefs = s.prefs || jsonb_build_object('orders', p_orders), updated_at = now()
  where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;
revoke all on function public.set_push_order_prefs(text, boolean) from public;
grant execute on function public.set_push_order_prefs(text, boolean) to authenticated;

-- Merge so menu switches do not wipe the orders pref.
create or replace function public.set_push_prefs(p_endpoint text, p_menu_ready boolean, p_week_locked boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions s
  set prefs = s.prefs || jsonb_build_object('menu_ready', p_menu_ready, 'week_locked', p_week_locked),
      updated_at = now()
  where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;
revoke all on function public.set_push_prefs(text, boolean, boolean) from public;
grant execute on function public.set_push_prefs(text, boolean, boolean) to authenticated;
