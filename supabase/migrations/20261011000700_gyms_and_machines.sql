-- LiftRank 0007 — Phase 4: gyms and machines.
--
-- Additive: new columns, indexes and functions. Existing data is kept. The only
-- data change is that group champion records on machine exercises are closed
-- (until = now()), because machine exercises have no champion on the combined
-- board (machines differ); history rows are kept.

-- ───────────── Schema ─────────────
alter table public.lifts
  add column machine_manufacturer_id uuid references public.machine_manufacturers (id) on delete set null;

create index lifts_machine_model_idx on public.lifts (exercise_id, machine_model_id)
  where deleted_at is null and machine_model_id is not null;
create index gyms_status_idx on public.gyms (status, lower(name));
create index profiles_primary_gym_idx on public.profiles (primary_gym_id) where public_leaderboard_opt_in;
create unique index gym_memberships_one_primary_uidx on public.gym_memberships (user_id) where is_primary;
create index machine_models_status_idx on public.machine_models (status, manufacturer_id);

-- ───────────── Helpers ─────────────
create function public._is_moderator(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_moderator from public.profiles where id = p_user), false)
$$;

-- Great-circle distance in miles.
create function public._miles(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 3958.8 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ))
$$;

create function public._gym_json(p_gym uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'address', g.address, 'city', g.city, 'region', g.region,
    'country', g.country, 'status', g.status,
    'has_location', g.latitude is not null and g.longitude is not null
  )
  from public.gyms g where g.id = p_gym
$$;

-- ───────────── Gyms ─────────────
-- Users submit gyms. A submitted gym is usable by its submitter right away,
-- but stays out of search and boards until a moderator approves it.
create function public.submit_gym(
  p_name text, p_address text, p_city text, p_region text, p_country text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_country text := btrim(coalesce(p_country, ''));
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_region text := nullif(btrim(coalesce(p_region, '')), '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then raise exception 'invalid_gym_name'; end if;
  if char_length(v_city) < 1 or char_length(v_city) > 100 then raise exception 'invalid_city'; end if;
  if char_length(v_country) < 2 or char_length(v_country) > 100 then raise exception 'invalid_country'; end if;
  if char_length(coalesce(v_address, '')) > 200 or char_length(coalesce(v_region, '')) > 100 then
    raise exception 'invalid_address';
  end if;

  -- Same gym already known (approved, or your own submission)?
  select id into v_id from public.gyms
  where lower(name) = lower(v_name) and lower(city) = lower(v_city) and lower(country) = lower(v_country)
    and (status = 'approved' or (status = 'pending' and submitted_by = v_uid))
  order by status = 'approved' desc
  limit 1;
  if v_id is not null then return v_id; end if;

  if (select count(*) from public.gyms where submitted_by = v_uid and status = 'pending') >= 3 then
    raise exception 'too_many_pending';
  end if;

  insert into public.gyms (name, address, city, region, country, submitted_by)
  values (v_name, v_address, v_city, v_region, v_country, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.search_gyms(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public._gym_json(g.id) order by g.rank, g.name), '[]'::jsonb)
  from (
    select gy.id, gy.name,
      case when lower(gy.name) like lower(btrim(p_query)) || '%' then 0 else 1 end as rank
    from public.gyms gy
    where auth.uid() is not null
      and char_length(btrim(coalesce(p_query, ''))) >= 2
      and (gy.status = 'approved' or (gy.status = 'pending' and gy.submitted_by = auth.uid()))
      and (
        gy.name ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%'
        or gy.city ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%'
      )
    order by rank, gy.name
    limit 20
  ) g
$$;

create function public.set_primary_gym(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_gym_id is null then
    update public.profiles set primary_gym_id = null, updated_at = now() where id = v_uid;
    delete from public.gym_memberships where user_id = v_uid;
    return;
  end if;
  if not exists (
    select 1 from public.gyms
    where id = p_gym_id and (status = 'approved' or (status = 'pending' and submitted_by = v_uid))
  ) then
    raise exception 'invalid_gym';
  end if;
  delete from public.gym_memberships where user_id = v_uid and gym_id <> p_gym_id;
  insert into public.gym_memberships (user_id, gym_id, is_primary) values (v_uid, p_gym_id, true)
  on conflict (user_id, gym_id) do update set is_primary = true;
  update public.profiles set primary_gym_id = p_gym_id, updated_at = now() where id = v_uid;
end;
$$;

-- Opt in to appearing on gym and nearby boards (public lifts only).
create function public.set_gym_board_opt_in(p_opt_in boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.profiles set public_leaderboard_opt_in = coalesce(p_opt_in, false), updated_at = now()
  where id = auth.uid();
end;
$$;

-- ───────────── Moderation ─────────────
create function public.mod_pending()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_moderator(auth.uid()) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'gyms', (
      select coalesce(jsonb_agg(public._gym_json(g.id) || jsonb_build_object(
        'submitted_by', pr.username, 'created_at', g.created_at) order by g.created_at), '[]'::jsonb)
      from public.gyms g left join public.profiles pr on pr.id = g.submitted_by
      where g.status = 'pending'
    ),
    'models', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'manufacturer', mf.name, 'equipment_type', m.equipment_type,
        'submitted_by', pr.username, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
      from public.machine_models m
      join public.machine_manufacturers mf on mf.id = m.manufacturer_id
      left join public.profiles pr on pr.id = m.submitted_by
      where m.status = 'pending'
    )
  );
end;
$$;

-- Approving a gym requires coordinates (nearby boards use them). Rejecting it
-- removes it as anyone's primary gym.
create function public.mod_review_gym(
  p_gym_id uuid, p_approve boolean, p_latitude double precision default null, p_longitude double precision default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._is_moderator(auth.uid()) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.gyms where id = p_gym_id) then raise exception 'not_found'; end if;
  if p_approve then
    if p_latitude is null or p_longitude is null
       or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      raise exception 'location_required';
    end if;
    update public.gyms set status = 'approved', latitude = p_latitude, longitude = p_longitude where id = p_gym_id;
  else
    update public.gyms set status = 'rejected' where id = p_gym_id;
    update public.profiles set primary_gym_id = null where primary_gym_id = p_gym_id;
    delete from public.gym_memberships where gym_id = p_gym_id;
  end if;
end;
$$;

create function public.mod_review_model(p_model_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._is_moderator(auth.uid()) then raise exception 'forbidden'; end if;
  update public.machine_models set status = case when p_approve then 'approved' else 'rejected' end::public.moderation_status
  where id = p_model_id;
  if not found then raise exception 'not_found'; end if;
end;
$$;

-- ───────────── Machines ─────────────
-- Manufacturers are seeded; models are user-submitted and moderated. Models
-- are listed per equipment type, so an exercise only offers matching machines.
create function public.get_machine_options(p_exercise_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'manufacturers', (
      select coalesce(jsonb_agg(jsonb_build_object('id', mf.id, 'name', mf.name)
        order by mf.name = 'Other', mf.name), '[]'::jsonb)
      from public.machine_manufacturers mf
    ),
    'models', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'manufacturer_id', m.manufacturer_id, 'name', m.name, 'status', m.status)
        order by m.name), '[]'::jsonb)
      from public.machine_models m
      join public.exercises e on e.id = p_exercise_id and e.equipment_type = m.equipment_type
      where m.status = 'approved' or (m.status = 'pending' and m.submitted_by = auth.uid())
    )
  )
  where auth.uid() is not null
$$;

create function public.submit_machine_model(p_manufacturer_id uuid, p_name text, p_exercise_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_type public.equipment_type;
  v_model public.machine_models%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 100 then raise exception 'invalid_model_name'; end if;
  select equipment_type into v_type from public.exercises where id = p_exercise_id and supports_machine_selection;
  if v_type is null then raise exception 'machine_not_allowed'; end if;
  if not exists (select 1 from public.machine_manufacturers where id = p_manufacturer_id and name <> 'Other') then
    raise exception 'invalid_manufacturer';
  end if;

  select * into v_model from public.machine_models
  where manufacturer_id = p_manufacturer_id and lower(name) = lower(v_name)
  limit 1;
  if found then
    if v_model.status = 'rejected' then raise exception 'model_rejected'; end if;
    return jsonb_build_object('id', v_model.id, 'name', v_model.name, 'status', v_model.status);
  end if;

  if (select count(*) from public.machine_models
      where submitted_by = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_pending';
  end if;

  insert into public.machine_models (manufacturer_id, name, equipment_type, submitted_by)
  values (p_manufacturer_id, v_name, v_type, v_uid)
  returning * into v_model;
  return jsonb_build_object('id', v_model.id, 'name', v_model.name, 'status', v_model.status);
end;
$$;

-- ───────────── Boards ─────────────
-- Generalised board. Adds:
--   gym:    lifters whose primary gym is p_gym (approved) and who opted in; public lifts only.
--   nearby: opted-in lifters whose approved primary gym is within p_radius_mi of p_gym.
--   p_model: only lifts on that exact machine model.
create function public._board_x(
  p_viewer uuid, p_kind text, p_group uuid, p_exercise uuid, p_period text,
  p_gym uuid, p_radius_mi double precision, p_model uuid
)
returns table (
  pos bigint, uid uuid, lid uuid, score numeric, weight_kg numeric,
  entered_weight numeric, entered_unit public.weight_unit, reps integer,
  performed_at timestamptz, vstatus public.verification_status
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('month', now() at time zone public.app_timezone())) at time zone public.app_timezone() as m_start,
      (date_trunc('month', now() at time zone public.app_timezone()) + interval '1 month') at time zone public.app_timezone() as m_end
  ),
  origin as (
    select g.latitude, g.longitude from public.gyms g
    where g.id = p_gym and g.status = 'approved' and g.latitude is not null and g.longitude is not null
  ),
  participants as (
    select p_viewer as id where p_kind = 'friends' and p_viewer is not null
    union
    select case when f.requester_id = p_viewer then f.addressee_id else f.requester_id end
    from public.friendships f
    where p_kind = 'friends' and f.status = 'accepted' and p_viewer in (f.requester_id, f.addressee_id)
    union
    select m.user_id from public.group_members m where p_kind = 'group' and m.group_id = p_group
    union
    select pr.id from public.profiles pr
    join public.gyms g on g.id = pr.primary_gym_id and g.status = 'approved'
    where p_kind = 'gym' and pr.primary_gym_id = p_gym and pr.public_leaderboard_opt_in
    union
    select pr.id from public.profiles pr
    join public.gyms g on g.id = pr.primary_gym_id and g.status = 'approved'
    cross join origin o
    where p_kind = 'nearby' and pr.public_leaderboard_opt_in
      and g.latitude is not null and g.longitude is not null
      and public._miles(o.latitude, o.longitude, g.latitude, g.longitude) <= p_radius_mi
  ),
  eligible as (
    select l.*
    from public.lifts l
    join participants p on p.id = l.user_id
    cross join bounds b
    where l.exercise_id = p_exercise
      and l.is_ranked
      and l.deleted_at is null
      and (p_model is null or l.machine_model_id = p_model)
      and (
        p_period = 'all'
        or (l.monthly_eligible and l.performed_at >= b.m_start and l.performed_at < b.m_end)
      )
      and case
        when p_kind = 'friends' then l.visibility in ('public', 'friends')
        when p_kind = 'group' then l.visibility = 'public'
          or (l.visibility = 'groups' and exists (
            select 1 from public.lift_group_shares s where s.lift_id = l.id and s.group_id = p_group
          ))
        else l.visibility = 'public'
      end
  ),
  best as (
    select distinct on (e.user_id) e.*
    from eligible e
    order by e.user_id, e.score desc, e.weight_kg desc nulls last, e.performed_at, e.created_at, e.id
  )
  select
    row_number() over (order by b.score desc, b.weight_kg desc nulls last, b.performed_at, b.created_at, b.id),
    b.user_id, b.id, b.score, b.weight_kg, b.entered_weight, b.entered_unit, b.reps, b.performed_at,
    b.verification_status
  from best b
$$;

-- The original board keeps its signature (champions, home, result screen use it).
create or replace function public._board(
  p_viewer uuid, p_kind text, p_group uuid, p_exercise uuid, p_period text
)
returns table (
  pos bigint, uid uuid, lid uuid, score numeric, weight_kg numeric,
  entered_weight numeric, entered_unit public.weight_unit, reps integer,
  performed_at timestamptz, vstatus public.verification_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public._board_x(p_viewer, p_kind, p_group, p_exercise, p_period, null, null, null)
$$;

-- One board row, read from the lift itself. Shows the machine: manufacturer
-- always, model name only once approved.
create function public._board_row(p_pos bigint, p_lid uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rank', p_pos,
    'user_id', l.user_id,
    'username', pr.username,
    'display_name', pr.display_name,
    'avatar_path', pr.avatar_path,
    'lift_id', l.id,
    'score', l.score,
    'weight_kg', l.weight_kg,
    'entered_weight', l.entered_weight,
    'entered_unit', l.entered_unit,
    'reps', l.reps,
    'performed_at', l.performed_at,
    'verification_status', l.verification_status,
    'is_me', l.user_id = p_viewer,
    'machine', case when l.machine_manufacturer_id is not null then jsonb_build_object(
      'manufacturer', mf.name,
      'model_id', case when mm.status = 'approved' then mm.id end,
      'model', case when mm.status = 'approved' then mm.name end
    ) end
  )
  from public.lifts l
  join public.profiles pr on pr.id = l.user_id
  left join public.machine_manufacturers mf on mf.id = l.machine_manufacturer_id
  left join public.machine_models mm on mm.id = l.machine_model_id
  where l.id = p_lid
$$;

-- Machine exercises have no champion on the combined board (machines differ).
create or replace function public._sync_group_champion(p_group uuid, p_exercise uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'group:' || p_group || ':' || p_exercise;
  v_cur public.record_history%rowtype;
  v_has_cur boolean;
  v_total integer;
  v_top_user uuid;
  v_top_lift uuid;
  v_new_user uuid;
  v_changed boolean := false;
  v_machine boolean := coalesce((select supports_machine_selection from public.exercises where id = p_exercise), false);
begin
  perform pg_advisory_xact_lock(hashtext(v_key));

  select * into v_cur from public.record_history where board_key = v_key and until is null;
  v_has_cur := found;

  select count(*) into v_total from public._board(null, 'group', p_group, p_exercise, 'all');
  select b.uid, b.lid into v_top_user, v_top_lift
  from public._board(null, 'group', p_group, p_exercise, 'all') b where b.pos = 1;

  v_new_user := case when v_total >= 3 and not v_machine then v_top_user end;

  if v_has_cur and (v_new_user is null or v_cur.user_id is distinct from v_new_user) then
    update public.record_history set until = now() where id = v_cur.id;
  end if;

  if v_new_user is not null and (not v_has_cur or v_cur.user_id is distinct from v_new_user) then
    insert into public.record_history (board_key, group_id, exercise_id, user_id, lift_id)
    values (v_key, p_group, p_exercise, v_new_user, v_top_lift);
    v_changed := true;
  elsif v_new_user is not null and v_cur.lift_id is distinct from v_top_lift then
    update public.record_history set lift_id = v_top_lift where id = v_cur.id;
  end if;

  return jsonb_build_object(
    'changed', v_changed or (v_has_cur and v_new_user is null),
    'previous_user_id', case when v_has_cur then v_cur.user_id end,
    'champion_user_id', v_new_user
  );
end;
$$;

update public.record_history set until = now()
where until is null
  and exercise_id in (select id from public.exercises where supports_machine_selection);

drop function public.get_leaderboard(uuid, text, uuid, text, integer, integer);

-- p_kind: friends | group | gym | nearby. Gym and nearby use the viewer's
-- primary gym. p_machine_model_id narrows any board to one exact machine.
create function public.get_leaderboard(
  p_exercise_id uuid,
  p_kind text default 'friends',
  p_group_id uuid default null,
  p_period text default 'all',
  p_limit integer default 50,
  p_offset integer default 0,
  p_radius_mi integer default null,
  p_machine_model_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_champion jsonb;
  v_gym public.gyms%rowtype;
  v_radius double precision;
  v_machine boolean;
  v_reason text;
  v_opted boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('friends', 'group', 'gym', 'nearby') then raise exception 'invalid_board'; end if;
  if p_period not in ('all', 'month') then raise exception 'invalid_period'; end if;
  if p_kind = 'group' and (p_group_id is null or not public._member(p_group_id, v_uid)) then
    raise exception 'not_a_member';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  select coalesce(supports_machine_selection, false) into v_machine from public.exercises where id = p_exercise_id;
  if p_machine_model_id is not null and not v_machine then raise exception 'invalid_machine'; end if;

  if p_kind in ('gym', 'nearby') then
    select g.* into v_gym from public.profiles pr join public.gyms g on g.id = pr.primary_gym_id where pr.id = v_uid;
    select public_leaderboard_opt_in into v_opted from public.profiles where id = v_uid;
    v_reason := case
      when v_gym.id is null then 'no_gym'
      when v_gym.status <> 'approved' then 'gym_pending'
      when p_kind = 'nearby' and (v_gym.latitude is null or v_gym.longitude is null) then 'no_location'
    end;
    if p_kind = 'nearby' then
      if coalesce(p_radius_mi, 10) not in (5, 10, 25) then raise exception 'invalid_radius'; end if;
      v_radius := coalesce(p_radius_mi, 10);
    end if;
    if v_reason is not null then
      return jsonb_build_object(
        'total', 0, 'rows', '[]'::jsonb, 'me', null, 'above', null, 'champion', null,
        'gym', case when v_gym.id is not null then public._gym_json(v_gym.id) end,
        'reason', v_reason, 'opted_in', coalesce(v_opted, false)
      );
    end if;
  end if;

  -- Blocked users stay in the ranking (so every viewer sees the same numbers)
  -- but their row is hidden from the viewer.
  with b as materialized (
    select x.*, public._blocked(v_uid, x.uid) as hidden
    from public._board_x(v_uid, p_kind, p_group_id, p_exercise_id, p_period, v_gym.id, v_radius, p_machine_model_id) x
  ),
  me as (select * from b where uid = v_uid)
  select jsonb_build_object(
    'total', (select count(*) from b),
    'rows', (
      select coalesce(jsonb_agg(public._board_row(pg.pos, pg.lid, v_uid) order by pg.pos), '[]'::jsonb)
      from (select * from b where not b.hidden order by b.pos limit p_limit offset p_offset) pg
    ),
    'me', (select public._board_row(m.pos, m.lid, v_uid) from me m),
    'above', (
      select public._board_row(a.pos, a.lid, v_uid)
      from b a
      where not a.hidden and a.pos < (select m.pos from me m)
      order by a.pos desc
      limit 1
    ),
    'top', (select public._board_row(t.pos, t.lid, v_uid) from b t where t.pos = 1 and not t.hidden)
  )
  into v_result;

  if p_kind = 'group' and not v_machine and p_period = 'all' then
    select jsonb_build_object(
      'user_id', rh.user_id, 'username', pr.username, 'display_name', pr.display_name,
      'avatar_path', pr.avatar_path, 'lift_id', rh.lift_id, 'since', rh.since,
      'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit, 'reps', l.reps,
      'score', l.score, 'weight_kg', l.weight_kg
    )
    into v_champion
    from public.record_history rh
    left join public.profiles pr on pr.id = rh.user_id
    left join public.lifts l on l.id = rh.lift_id
    where rh.board_key = 'group:' || p_group_id || ':' || p_exercise_id and rh.until is null
      and (rh.user_id is null or not public._blocked(v_uid, rh.user_id));
  elsif p_kind in ('group', 'gym') and (v_result->>'total')::integer >= 3
        and (not v_machine or p_machine_model_id is not null) then
    -- Monthly boards, gym boards and exact-machine boards: current leader, 3+ lifters.
    v_champion := v_result->'top';
  end if;

  v_result := (v_result - 'top') || jsonb_build_object('champion', v_champion);
  if p_kind in ('gym', 'nearby') then
    v_result := v_result || jsonb_build_object(
      'gym', public._gym_json(v_gym.id), 'reason', null, 'opted_in', coalesce(v_opted, false),
      'radius_mi', v_radius
    );
  end if;
  return v_result;
end;
$$;

drop function public.submit_lift(uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid);

create function public.submit_lift(
  p_exercise_id uuid,
  p_weight numeric,
  p_unit public.weight_unit,
  p_reps integer,
  p_performed_at timestamptz default null,
  p_visibility public.lift_visibility default null,
  p_group_ids uuid[] default '{}',
  p_notes text default null,
  p_idempotency_key uuid default null,
  p_machine_manufacturer_id uuid default null,
  p_machine_model_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ex public.exercises%rowtype;
  v_weight_kg numeric;
  v_score numeric;
  v_ranked boolean;
  v_vis public.lift_visibility;
  v_performed timestamptz := coalesce(p_performed_at, now());
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_existing uuid;
  v_prev_best numeric;
  v_had_any boolean;
  v_lift_id uuid;
  v_groups uuid[];
  v_in_friends boolean;
  v_before jsonb;
  v_after jsonb;
  v_is_pr boolean;
  v_group uuid;
  v_sync jsonb;
  v_champion_of jsonb := '[]'::jsonb;
  v_passed jsonb := '[]'::jsonb;
  v_rec record;
  v_top_passed uuid;
  v_mfr uuid := p_machine_manufacturer_id;
  v_model public.machine_models%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'onboarding_required';
  end if;

  -- Serialize one user's submissions so dedupe and idempotency are race-free.
  perform pg_advisory_xact_lock(hashtext('submit:' || v_uid));

  select * into v_ex from public.exercises where id = p_exercise_id and is_active;
  if not found then raise exception 'invalid_exercise'; end if;

  -- Validation (mirrored by the Zod schema in src/lib/validation.ts).
  if v_ex.ranking_method = 'max_reps' then
    if p_weight is not null then raise exception 'weight_not_allowed'; end if;
    if p_reps is null or p_reps < 1 or p_reps > 200 then raise exception 'invalid_reps'; end if;
  else
    if p_weight is null or p_weight <= 0 or p_weight <> round(p_weight, 2) then raise exception 'invalid_weight'; end if;
    if p_unit is null then raise exception 'invalid_unit'; end if;
    if p_reps is null or p_reps < 1 or p_reps > 50 then raise exception 'invalid_reps'; end if;
    v_weight_kg := case when p_unit = 'kg' then p_weight else p_weight * 0.45359237 end;
    if v_weight_kg > v_ex.max_weight_kg then raise exception 'weight_too_high'; end if;
  end if;
  if v_performed > now() + interval '5 minutes' then raise exception 'future_date'; end if;
  if v_performed < now() - interval '5 years' then raise exception 'date_too_old'; end if;
  if v_notes is not null and char_length(v_notes) > 280 then raise exception 'notes_too_long'; end if;

  -- Machine (optional, machine exercises only). Unknown manufacturer/model is always allowed.
  if p_machine_model_id is not null or p_machine_manufacturer_id is not null then
    if not v_ex.supports_machine_selection then raise exception 'machine_not_allowed'; end if;
  end if;
  if p_machine_model_id is not null then
    select * into v_model from public.machine_models where id = p_machine_model_id and status <> 'rejected';
    if not found then raise exception 'invalid_machine'; end if;
    if v_mfr is not null and v_mfr <> v_model.manufacturer_id then raise exception 'invalid_machine'; end if;
    v_mfr := v_model.manufacturer_id;
  elsif v_mfr is not null and not exists (select 1 from public.machine_manufacturers where id = v_mfr) then
    raise exception 'invalid_machine';
  end if;

  v_vis := coalesce(
    p_visibility,
    (select default_visibility from public.user_settings where user_id = v_uid),
    'public'
  );
  if v_vis = 'groups' then
    if coalesce(cardinality(p_group_ids), 0) = 0 then raise exception 'groups_required'; end if;
    if exists (
      select 1 from unnest(p_group_ids) g(id)
      where not public._member(g.id, v_uid)
    ) then
      raise exception 'not_a_member';
    end if;
  end if;

  -- Idempotency key, then a 10-minute duplicate window.
  if p_idempotency_key is not null then
    select id into v_existing from public.lifts where user_id = v_uid and idempotency_key = p_idempotency_key;
  end if;
  if v_existing is null then
    select id into v_existing
    from public.lifts
    where user_id = v_uid and exercise_id = p_exercise_id and deleted_at is null
      and reps = p_reps and weight_kg is not distinct from v_weight_kg
      and created_at > now() - interval '10 minutes'
    order by created_at desc
    limit 1;
  end if;
  if v_existing is not null then
    select l.score, l.is_ranked, l.visibility into v_score, v_ranked, v_vis from public.lifts l where l.id = v_existing;
    v_groups := public._lift_groups(v_uid, v_existing, v_vis);
    v_after := public._my_board_positions(v_uid, p_exercise_id, v_vis in ('public', 'friends'), v_groups);
    return jsonb_build_object(
      'lift_id', v_existing, 'duplicate', true, 'is_pr', false, 'is_first', false,
      'score', v_score, 'is_ranked', v_ranked, 'previous_best', null,
      'boards', v_after, 'boards_before', v_after, 'passed', '[]'::jsonb, 'champion_of', '[]'::jsonb
    );
  end if;

  select s.score, s.is_ranked into v_score, v_ranked
  from public.compute_score(v_ex.ranking_method, v_weight_kg, p_reps) s;

  -- Where will this lift appear?
  v_in_friends := v_vis in ('public', 'friends');
  v_groups := case v_vis
    when 'public' then array(select group_id from public.group_members where user_id = v_uid)
    when 'groups' then array(select distinct g from unnest(p_group_ids) g)
    else '{}'::uuid[]
  end;

  select max(score) into v_prev_best
  from public.lifts
  where user_id = v_uid and exercise_id = p_exercise_id and is_ranked and deleted_at is null;
  v_had_any := exists (
    select 1 from public.lifts where user_id = v_uid and exercise_id = p_exercise_id and deleted_at is null
  );
  v_before := public._my_board_positions(v_uid, p_exercise_id, v_in_friends, v_groups);

  insert into public.lifts (
    user_id, exercise_id, entered_weight, entered_unit, weight_kg, reps, weight_convention,
    score, is_ranked, performed_at, visibility, flagged_for_review, notes, idempotency_key,
    machine_manufacturer_id, machine_model_id
  ) values (
    v_uid, p_exercise_id,
    case when v_weight_kg is null then null else p_weight end,
    case when v_weight_kg is null then null else p_unit end,
    v_weight_kg, p_reps, v_ex.weight_convention,
    v_score, v_ranked, v_performed, v_vis,
    coalesce(v_weight_kg > v_ex.flag_threshold_kg, false),
    v_notes, p_idempotency_key,
    v_mfr, p_machine_model_id
  )
  returning id into v_lift_id;

  if v_vis = 'groups' then
    insert into public.lift_group_shares (lift_id, group_id)
    select v_lift_id, g from unnest(v_groups) g;
  end if;

  v_after := public._my_board_positions(v_uid, p_exercise_id, v_in_friends, v_groups);
  v_is_pr := v_ranked and v_prev_best is not null and v_score > v_prev_best;

  -- Champions on every group board this lift touches.
  foreach v_group in array v_groups loop
    v_sync := public._sync_group_champion(v_group, p_exercise_id);
    if (v_sync->>'changed')::boolean and (v_sync->>'champion_user_id')::uuid = v_uid then
      v_champion_of := v_champion_of || jsonb_build_object(
        'group_id', v_group, 'group_name', (select name from public.groups where id = v_group)
      );
      insert into public.activities (actor_id, type, lift_id, group_id, exercise_id)
      values (v_uid, 'first_place', v_lift_id, v_group, p_exercise_id);

      if (v_sync->>'previous_user_id') is not null
         and (v_sync->>'previous_user_id')::uuid <> v_uid
         and coalesce((select notify_first_place from public.user_settings
                       where user_id = (v_sync->>'previous_user_id')::uuid), true)
         and not public._blocked(v_uid, (v_sync->>'previous_user_id')::uuid) then
        insert into public.notifications (recipient_id, actor_id, type, group_id, exercise_id, lift_id)
        values ((v_sync->>'previous_user_id')::uuid, v_uid, 'first_place', v_group, p_exercise_id, v_lift_id);
      end if;
    end if;
  end loop;

  -- "You passed someone": only people who can see this lift, compared by score.
  if v_ranked and (v_prev_best is null or v_score > v_prev_best) and v_vis <> 'private' then
    for v_rec in
      with audience as (
        select case when f.requester_id = v_uid then f.addressee_id else f.requester_id end as id
        from public.friendships f
        where v_in_friends and f.status = 'accepted' and v_uid in (f.requester_id, f.addressee_id)
        union
        select m.user_id from public.group_members m where m.group_id = any (v_groups)
      )
      select a.id as recipient_id, pr.username,
             (select max(l.score) from public.lifts l
               where l.user_id = a.id and l.exercise_id = p_exercise_id and l.is_ranked
                 and l.deleted_at is null and l.visibility <> 'private') as their_best
      from audience a
      join public.profiles pr on pr.id = a.id
      where a.id <> v_uid and not public._blocked(v_uid, a.id)
    loop
      continue when v_rec.their_best is null;
      continue when not (v_score > v_rec.their_best and (v_prev_best is null or v_prev_best <= v_rec.their_best));
      v_passed := v_passed || jsonb_build_object(
        'user_id', v_rec.recipient_id, 'username', v_rec.username, 'their_best', v_rec.their_best
      );
      if coalesce((select notify_passed from public.user_settings where user_id = v_rec.recipient_id), true)
         and not exists (
           select 1 from public.notifications n
           where n.recipient_id = v_rec.recipient_id and n.actor_id = v_uid and n.type = 'passed'
             and n.exercise_id = p_exercise_id and n.created_at > now() - interval '24 hours'
         ) then
        insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id)
        values (v_rec.recipient_id, v_uid, 'passed', p_exercise_id, v_lift_id);
      end if;
    end loop;
  end if;

  if v_vis <> 'private' then
    if v_is_pr then
      insert into public.activities (actor_id, type, lift_id, exercise_id)
      values (v_uid, 'pr', v_lift_id, p_exercise_id);
    end if;
    if jsonb_array_length(v_passed) > 0 then
      select (p->>'user_id')::uuid into v_top_passed
      from jsonb_array_elements(v_passed) p
      order by (p->>'their_best')::numeric desc
      limit 1;
      insert into public.activities (actor_id, type, lift_id, exercise_id, target_user_id)
      values (v_uid, 'passed', v_lift_id, p_exercise_id, v_top_passed);
    end if;
  end if;

  return jsonb_build_object(
    'lift_id', v_lift_id,
    'duplicate', false,
    'is_pr', v_is_pr,
    'is_first', not v_had_any,
    'score', v_score,
    'is_ranked', v_ranked,
    'previous_best', v_prev_best,
    'boards_before', v_before,
    'boards', v_after,
    'passed', (select coalesce(jsonb_agg(p - 'their_best'), '[]'::jsonb) from jsonb_array_elements(v_passed) p),
    'champion_of', v_champion_of
  );
end;
$$;

-- Remembered defaults now include the last machine per exercise.
create or replace function public.get_lift_defaults()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'last', (
      select jsonb_build_object('exercise_id', l.exercise_id, 'entered_weight', l.entered_weight,
                                'entered_unit', l.entered_unit, 'reps', l.reps)
      from public.lifts l where l.user_id = auth.uid() and l.deleted_at is null
      order by l.created_at desc limit 1
    ),
    'last_by_exercise', (
      select coalesce(jsonb_object_agg(x.exercise_id, jsonb_build_object(
        'entered_weight', x.entered_weight, 'entered_unit', x.entered_unit, 'reps', x.reps,
        'machine_manufacturer_id', x.machine_manufacturer_id, 'machine_model_id', x.machine_model_id)), '{}'::jsonb)
      from (
        select distinct on (l.exercise_id) l.exercise_id, l.entered_weight, l.entered_unit, l.reps,
          l.machine_manufacturer_id,
          case when mm.status = 'approved' or mm.submitted_by = auth.uid() then l.machine_model_id end as machine_model_id
        from public.lifts l
        left join public.machine_models mm on mm.id = l.machine_model_id
        where l.user_id = auth.uid() and l.deleted_at is null
        order by l.exercise_id, l.created_at desc
      ) x
    ),
    'recent_exercise_ids', (
      select coalesce(jsonb_agg(r.exercise_id order by r.last_used desc), '[]'::jsonb)
      from (
        select l.exercise_id, max(l.created_at) as last_used
        from public.lifts l where l.user_id = auth.uid() and l.deleted_at is null
        group by l.exercise_id order by 2 desc limit 8
      ) r
    ),
    'favorite_exercise_ids', (
      select coalesce(jsonb_agg(f.exercise_id), '[]'::jsonb)
      from public.favorite_exercises f where f.user_id = auth.uid()
    ),
    'preferred_unit', (select preferred_unit from public.profiles where id = auth.uid()),
    'default_visibility', (select default_visibility from public.user_settings where user_id = auth.uid()),
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name), '[]'::jsonb)
      from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
    )
  )
  where auth.uid() is not null
$$;

-- Your own profile now carries your primary gym and moderator flag.
create or replace function public.get_my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
    'bio', p.bio, 'preferred_unit', p.preferred_unit, 'profile_visibility', p.profile_visibility,
    'public_leaderboard_opt_in', p.public_leaderboard_opt_in, 'onboarded_at', p.onboarded_at,
    'created_at', p.created_at,
    'primary_gym', case when p.primary_gym_id is not null then public._gym_json(p.primary_gym_id) end,
    'is_moderator', p.is_moderator,
    'settings', to_jsonb(s) - 'user_id' - 'updated_at'
  )
  from public.profiles p
  left join public.user_settings s on s.user_id = p.id
  where p.id = auth.uid()
$$;

-- Profiles show the gym, behind the same visibility as the bio.
create or replace function public.get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles%rowtype;
  v_rel text;
  v_details boolean;
  v_featured uuid[];
  v_friendship uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_p from public.profiles where username = lower(p_username);
  if not found then return null; end if;
  if v_p.id <> v_uid and exists (
    select 1 from public.blocks where blocker_id = v_p.id and blocked_id = v_uid
  ) then
    return null;
  end if;

  v_rel := public._relationship(v_uid, v_p.id);
  v_details := v_rel <> 'blocked' and (
    v_p.id = v_uid
    or v_p.profile_visibility = 'public'
    or (v_p.profile_visibility = 'friends' and v_rel = 'friends')
  );
  select featured_exercise_ids into v_featured from public.user_settings where user_id = v_p.id;
  select f.id into v_friendship from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(v_uid, v_p.id)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_uid, v_p.id);

  return jsonb_build_object(
    'id', v_p.id, 'username', v_p.username, 'display_name', v_p.display_name,
    'avatar_path', v_p.avatar_path, 'created_at', v_p.created_at,
    'relationship', v_rel, 'friendship_id', v_friendship,
    'can_see_details', v_details,
    'bio', case when v_details then v_p.bio end,
    'featured_exercise_ids', case when v_details then to_jsonb(coalesce(v_featured, '{}')) else '[]'::jsonb end,
    'prs', case when v_details and v_rel <> 'blocked' then public.get_prs(v_p.id) else '[]'::jsonb end,
    -- Gym: name and place only (never coordinates), behind the same visibility as the bio.
    -- A gym still waiting for review is shown only to its owner.
    'gym', case when v_details then (
      select jsonb_build_object('id', g.id, 'name', g.name, 'city', g.city, 'region', g.region, 'country', g.country)
      from public.gyms g
      where g.id = v_p.primary_gym_id and (g.status = 'approved' or v_p.id = v_uid)
    ) end,
    'friend_count', (select count(*) from public.friendships f
                     where f.status = 'accepted' and v_p.id in (f.requester_id, f.addressee_id))
  );
end;
$$;

-- ───────────── Grants ─────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.can_view_lift(uuid, uuid, public.lift_visibility),
  public.is_blocked_with_me(uuid),
  public.am_group_member(uuid),
  public.am_group_admin(uuid),
  public.app_timezone(),
  public.is_reserved_username(text),
  public.compute_score(public.ranking_method, numeric, integer),
  public.get_leaderboard(uuid, text, uuid, text, integer, integer, integer, uuid),
  public.submit_lift(uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid, uuid, uuid),
  public.update_lift_sharing(uuid, public.lift_visibility, uuid[], text),
  public.delete_lift(uuid),
  public.get_prs(uuid),
  public.get_lift_defaults(),
  public.complete_username(text, text),
  public.update_my_profile(text, text, public.weight_unit, public.profile_visibility),
  public.get_my_profile(),
  public.get_profile(text),
  public.create_group(text, text),
  public.update_group(uuid, text, text),
  public.delete_group(uuid),
  public.get_my_groups(),
  public.get_group(uuid),
  public.leave_group(uuid),
  public.remove_group_member(uuid, uuid),
  public.set_group_member_role(uuid, uuid, public.group_role),
  public.create_group_invite(uuid, integer, integer),
  public.revoke_group_invite(uuid),
  public.get_invite_preview(text),
  public.accept_group_invite(text),
  public.search_users(text),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid),
  public.remove_friend(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.get_friends(),
  public.get_notifications(integer),
  public.unread_notification_count(),
  public.mark_notifications_read(uuid[]),
  public.get_feed(integer, timestamptz, uuid, uuid),
  public.toggle_reaction(uuid, text),
  public.get_home(),
  public.prepare_account_deletion(),
  public.submit_gym(text, text, text, text, text),
  public.search_gyms(text),
  public.set_primary_gym(uuid),
  public.set_gym_board_opt_in(boolean),
  public.mod_pending(),
  public.mod_review_gym(uuid, boolean, double precision, double precision),
  public.mod_review_model(uuid, boolean),
  public.get_machine_options(uuid),
  public.submit_machine_model(uuid, text, uuid)
to authenticated;

grant execute on function public.get_invite_preview(text) to anon;
