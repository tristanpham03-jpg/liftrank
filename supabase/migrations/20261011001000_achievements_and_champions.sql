-- LiftRank 0010 — Phase 6: achievements, champions, record history, monthly champions.
--
-- Reuses what exists: the seeded achievements, record_history (now also for gym
-- records), the board function (now able to rank any past month), and the
-- daily cron (now also closes finished months). No XP, levels or ratings.
--
-- Additive. Data changes: one achievement row is added, and achievements that
-- existing data already earned (first lift, current/past champion, verified
-- lift) are backfilled without notifications.

-- ───────────── Schema ─────────────
insert into public.achievements (id, name, description, sort_order) values
  ('monthly_champion', 'Monthly Champion', 'Finish a month first on a group or gym board with at least 3 lifters.', 9)
on conflict (id) do nothing;

alter table public.record_history add column gym_id uuid references public.gyms (id) on delete cascade;
create index record_history_user_open_idx on public.record_history (user_id) where until is null;

alter table public.notifications add column gym_id uuid references public.gyms (id) on delete cascade;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'friend_request', 'friend_accepted', 'passed', 'first_place', 'group_joined',
  'proof_requested', 'proof_response', 'proof_reviewed',
  'gym_record', 'monthly_champion', 'achievement'
));

-- Finished months, frozen once their late-logging window (3 days) has passed.
create table public.monthly_records (
  id uuid primary key default gen_random_uuid(),
  board_key text not null,
  group_id uuid references public.groups (id) on delete cascade,
  gym_id uuid references public.gyms (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  month date not null,
  user_id uuid references public.profiles (id) on delete set null,
  lift_id uuid references public.lifts (id) on delete set null,
  lifters integer not null,
  created_at timestamptz not null default now(),
  unique (board_key, month)
);
create index monthly_records_board_idx on public.monthly_records (board_key, month desc);
create table public.monthly_closings (
  month date primary key,
  closed_at timestamptz not null default now()
);
alter table public.monthly_records enable row level security;
alter table public.monthly_closings enable row level security;
revoke all on public.monthly_records, public.monthly_closings from anon, authenticated;
grant all on public.monthly_records, public.monthly_closings to service_role;

-- ───────────── Achievements ─────────────
-- Awarded once each, server-side only. Clients can't write user_achievements.
create function public._award(p_user uuid, p_achievement text, p_context jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_achievements (user_id, achievement_id, context)
  select p_user, p_achievement, coalesce(p_context, '{}')
  where p_user is not null and exists (select 1 from public.profiles where id = p_user)
  on conflict do nothing
$$;

create function public._on_lift_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._award(new.user_id, 'first_lift', jsonb_build_object('lift_id', new.id));
  return null;
end;
$$;
create trigger lifts_first_lift after insert on public.lifts
  for each row execute function public._on_lift_inserted();

create function public._on_lift_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._award(new.user_id, 'verified_lifter', jsonb_build_object('lift_id', new.id));
  return null;
end;
$$;
create trigger lifts_verified_lifter after update of verification_status on public.lifts
  for each row when (new.verification_status = 'verified' and old.verification_status <> 'verified')
  execute function public._on_lift_verified();

-- A new champion (group or gym) earns the title's achievement, and five titles
-- held at once earn Five Records.
create function public._on_record_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.board_key like 'group:%' then
    perform public._award(new.user_id, 'group_champion', jsonb_build_object('group_id', new.group_id, 'exercise_id', new.exercise_id));
  elsif new.board_key like 'gym:%' then
    perform public._award(new.user_id, 'gym_champion', jsonb_build_object('gym_id', new.gym_id, 'exercise_id', new.exercise_id));
  end if;
  if (select count(*) from public.record_history where user_id = new.user_id and until is null) >= 5 then
    perform public._award(new.user_id, 'five_records');
  end if;
  return null;
end;
$$;
create trigger record_history_achievements after insert on public.record_history
  for each row when (new.until is null and new.user_id is not null)
  execute function public._on_record_opened();

-- ───────────── Boards can rank any month ─────────────

-- p_month: any instant inside the month to rank (default: this month).
drop function public._board_x(uuid, text, uuid, uuid, text, uuid, double precision, uuid, boolean);

create function public._board_x(
  p_viewer uuid, p_kind text, p_group uuid, p_exercise uuid, p_period text,
  p_gym uuid, p_radius_mi double precision, p_model uuid,
  p_verified boolean default false,
  p_month timestamptz default null
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
      (date_trunc('month', coalesce(p_month, now()) at time zone public.app_timezone())) at time zone public.app_timezone() as m_start,
      (date_trunc('month', coalesce(p_month, now()) at time zone public.app_timezone()) + interval '1 month') at time zone public.app_timezone() as m_end
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
      and (not coalesce(p_verified, false) or l.verification_status = 'verified')
      and l.invalidated_at is null
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


-- ───────────── Gym records ─────────────
-- Like group champions: the #1 of a gym board with at least 3 lifters holds the
-- record (not on machine exercises' combined board). Kept in record_history.
create function public._sync_gym_record(p_gym uuid, p_exercise uuid, p_taking_lift uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'gym:' || p_gym || ':' || p_exercise;
  v_cur public.record_history%rowtype;
  v_has_cur boolean;
  v_total integer := 0;
  v_top_user uuid;
  v_top_lift uuid;
  v_new_user uuid;
  v_machine boolean := coalesce((select supports_machine_selection from public.exercises where id = p_exercise), false);
begin
  if p_gym is null or p_exercise is null then return; end if;
  perform pg_advisory_xact_lock(hashtext(v_key));
  select * into v_cur from public.record_history where board_key = v_key and until is null;
  v_has_cur := found;

  if exists (select 1 from public.gyms where id = p_gym and status = 'approved') and not v_machine then
    select count(*) into v_total from public._board_x(null, 'gym', null, p_exercise, 'all', p_gym, null, null);
    select b.uid, b.lid into v_top_user, v_top_lift
    from public._board_x(null, 'gym', null, p_exercise, 'all', p_gym, null, null) b where b.pos = 1;
  end if;
  v_new_user := case when v_total >= 3 then v_top_user end;

  if v_has_cur and (v_new_user is null or v_cur.user_id is distinct from v_new_user) then
    update public.record_history set until = now() where id = v_cur.id;
  end if;
  if v_new_user is not null and (not v_has_cur or v_cur.user_id is distinct from v_new_user) then
    insert into public.record_history (board_key, gym_id, exercise_id, user_id, lift_id)
    values (v_key, p_gym, p_exercise, v_new_user, v_top_lift);
    -- The person who lost it hears about it, when a new lift took it.
    if v_has_cur and v_cur.user_id is not null and p_taking_lift is not null and v_top_lift = p_taking_lift
       and coalesce((select notify_first_place from public.user_settings where user_id = v_cur.user_id), true)
       and not public._blocked(v_new_user, v_cur.user_id) then
      insert into public.notifications (recipient_id, actor_id, type, gym_id, exercise_id, lift_id)
      values (v_cur.user_id, v_new_user, 'gym_record', p_gym, p_exercise, v_top_lift);
    end if;
  elsif v_new_user is not null and v_cur.lift_id is distinct from v_top_lift then
    update public.record_history set lift_id = v_top_lift where id = v_cur.id;
  end if;
end;
$$;

-- Any change that can move a gym board: a new lift, a delete, a visibility
-- change, a lift ruled invalid (or reinstated).
create function public._on_lift_gym_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gym uuid;
begin
  select primary_gym_id into v_gym from public.profiles where id = new.user_id and public_leaderboard_opt_in;
  if v_gym is not null and new.is_ranked then
    perform public._sync_gym_record(v_gym, new.exercise_id, case when tg_op = 'INSERT' then new.id end);
  end if;
  return null;
end;
$$;
create trigger lifts_gym_records after insert or update of deleted_at, visibility, invalidated_at on public.lifts
  for each row execute function public._on_lift_gym_change();

-- Changing gyms or opting in/out moves you between gym boards.
create function public._on_profile_gym_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ex uuid;
begin
  for v_ex in select distinct exercise_id from public.lifts where user_id = new.id and is_ranked and deleted_at is null loop
    if old.primary_gym_id is not null then perform public._sync_gym_record(old.primary_gym_id, v_ex); end if;
    if new.primary_gym_id is not null and new.primary_gym_id is distinct from old.primary_gym_id then
      perform public._sync_gym_record(new.primary_gym_id, v_ex);
    end if;
  end loop;
  return null;
end;
$$;
create trigger profiles_gym_records after update of primary_gym_id, public_leaderboard_opt_in on public.profiles
  for each row when (old.primary_gym_id is distinct from new.primary_gym_id
                     or old.public_leaderboard_opt_in is distinct from new.public_leaderboard_opt_in)
  execute function public._on_profile_gym_change();

-- ───────────── submit_lift: achievements and new titles in its result ─────────────
create or replace function public.submit_lift(
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
  where user_id = v_uid and exercise_id = p_exercise_id and is_ranked and deleted_at is null and invalidated_at is null;
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
                 and l.deleted_at is null and l.invalidated_at is null and l.visibility <> 'private') as their_best
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

  -- Achievements earned by this lift (gym and group titles are awarded by triggers).
  if v_is_pr then perform public._award(v_uid, 'first_pr', jsonb_build_object('lift_id', v_lift_id)); end if;
  if jsonb_array_length(v_passed) > 0 then
    perform public._award(v_uid, 'rival_overtaken', jsonb_build_object('lift_id', v_lift_id));
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_after) b
    where b->>'kind' = 'group' and (b->>'total')::integer >= 3 and (b->>'rank')::integer <= 3
  ) then
    perform public._award(v_uid, 'top_three', jsonb_build_object('lift_id', v_lift_id));
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
    'champion_of', v_champion_of,
    -- Gym records this lift just took.
    'gym_records', (
      select coalesce(jsonb_agg(jsonb_build_object('gym_id', g.id, 'gym_name', g.name)), '[]'::jsonb)
      from public.record_history rh join public.gyms g on g.id = rh.gym_id
      where rh.user_id = v_uid and rh.lift_id = v_lift_id and rh.until is null and rh.since = now()
    ),
    -- Achievements earned in this request (now() is the transaction's start).
    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'description', a.description)
                                order by a.sort_order), '[]'::jsonb)
      from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id
      where ua.user_id = v_uid and ua.earned_at = now()
    )
  );
end;
$$;


-- ───────────── Monthly champions ─────────────
-- Run daily by the cron (service role). Closes each month once its 3-day
-- late-logging window has passed: the #1 of every group and gym board with at
-- least 3 lifters becomes that month's champion, is told, and earns Monthly
-- Champion. Looks back three months so a missed run catches up.
create function public.close_monthly_records()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text := public.app_timezone();
  v_local timestamp;
  v_start timestamptz;
  v_end timestamptz;
  v_rec record;
  v_total integer;
  v_top_user uuid;
  v_top_lift uuid;
  v_closed integer := 0;
  v_id uuid;
begin
  for v_local in
    select generate_series(
      date_trunc('month', now() at time zone v_tz) - interval '3 months',
      date_trunc('month', now() at time zone v_tz) - interval '1 month',
      interval '1 month')
  loop
    v_start := v_local at time zone v_tz;
    v_end := (v_local + interval '1 month') at time zone v_tz;
    continue when now() < v_end + interval '3 days';
    continue when exists (select 1 from public.monthly_closings where month = v_local::date);

    for v_rec in
      select distinct 'group' as kind, m.group_id as scope, l.exercise_id
      from public.lifts l
      join public.group_members m on m.user_id = l.user_id
      join public.exercises e on e.id = l.exercise_id and not e.supports_machine_selection
      where l.is_ranked and l.deleted_at is null and l.invalidated_at is null and l.monthly_eligible
        and l.performed_at >= v_start and l.performed_at < v_end
      union
      select distinct 'gym', g.id, l.exercise_id
      from public.lifts l
      join public.profiles p on p.id = l.user_id and p.public_leaderboard_opt_in
      join public.gyms g on g.id = p.primary_gym_id and g.status = 'approved'
      join public.exercises e on e.id = l.exercise_id and not e.supports_machine_selection
      where l.is_ranked and l.deleted_at is null and l.invalidated_at is null and l.monthly_eligible
        and l.visibility = 'public' and l.performed_at >= v_start and l.performed_at < v_end
    loop
      select count(*) into v_total from public._board_x(
        null, v_rec.kind, case when v_rec.kind = 'group' then v_rec.scope end, v_rec.exercise_id, 'month',
        case when v_rec.kind = 'gym' then v_rec.scope end, null, null, false, v_start);
      continue when v_total < 3;
      select b.uid, b.lid into v_top_user, v_top_lift from public._board_x(
        null, v_rec.kind, case when v_rec.kind = 'group' then v_rec.scope end, v_rec.exercise_id, 'month',
        case when v_rec.kind = 'gym' then v_rec.scope end, null, null, false, v_start) b
      where b.pos = 1;

      v_id := null;
      insert into public.monthly_records (board_key, group_id, gym_id, exercise_id, month, user_id, lift_id, lifters)
      values (v_rec.kind || ':' || v_rec.scope || ':' || v_rec.exercise_id,
              case when v_rec.kind = 'group' then v_rec.scope end,
              case when v_rec.kind = 'gym' then v_rec.scope end,
              v_rec.exercise_id, v_local::date, v_top_user, v_top_lift, v_total)
      on conflict (board_key, month) do nothing
      returning id into v_id;
      if v_id is not null then
        insert into public.notifications (recipient_id, type, group_id, gym_id, exercise_id, lift_id, detail)
        values (v_top_user, 'monthly_champion',
                case when v_rec.kind = 'group' then v_rec.scope end,
                case when v_rec.kind = 'gym' then v_rec.scope end,
                v_rec.exercise_id, v_top_lift, to_char(v_local, 'YYYY-MM'));
        perform public._award(v_top_user, 'monthly_champion', jsonb_build_object('month', to_char(v_local, 'YYYY-MM')));
        v_closed := v_closed + 1;
      end if;
    end loop;
    insert into public.monthly_closings (month) values (v_local::date);
  end loop;
  return v_closed;
end;
$$;

-- ───────────── Reads ─────────────
-- A record row as a viewer may see it: the lift's numbers only if the viewer
-- can still see that lift.
create function public._record_json(p_viewer uuid, p_user uuid, p_lift uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user', case when pr.id is null then null else jsonb_build_object(
      'id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_path', pr.avatar_path) end,
    'lift', (
      select jsonb_build_object('id', l.id, 'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit,
                                'weight_kg', l.weight_kg, 'reps', l.reps, 'score', l.score,
                                'verification_status', l.verification_status)
      from public.lifts l
      where l.id = p_lift and l.deleted_at is null and l.invalidated_at is null
        and public._can_view_lift(p_viewer, l.id, l.user_id, l.visibility)
    )
  )
  from (select 1) one
  left join public.profiles pr on pr.id = p_user
$$;

-- Past and present holders of one group or gym board, and its monthly champions.
-- Group: members only. Gym: lifters whose primary gym it is.
create function public.get_record_history(p_kind text, p_scope_id uuid, p_exercise_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind = 'group' then
    if not public._member(p_scope_id, v_uid) then raise exception 'not_a_member'; end if;
  elsif p_kind = 'gym' then
    if not exists (select 1 from public.profiles p join public.gyms g on g.id = p.primary_gym_id
                   where p.id = v_uid and g.id = p_scope_id and g.status = 'approved') then
      raise exception 'not_found';
    end if;
  else
    raise exception 'invalid_board';
  end if;
  v_key := p_kind || ':' || p_scope_id || ':' || p_exercise_id;

  return jsonb_build_object(
    'reigns', (
      select coalesce(jsonb_agg(public._record_json(v_uid, r.user_id, r.lift_id)
               || jsonb_build_object('since', r.since, 'until', r.until) order by r.since desc), '[]'::jsonb)
      from (
        select rh.* from public.record_history rh
        left join public.lifts l on l.id = rh.lift_id
        where rh.board_key = v_key
          and (rh.user_id is null or not public._blocked(v_uid, rh.user_id))
          and (l.id is null or l.invalidated_at is null)  -- reigns of confirmed-invalid lifts aren't shown
        order by rh.since desc
        limit 30
      ) r
    ),
    'monthly', (
      select coalesce(jsonb_agg(public._record_json(v_uid, m.user_id, m.lift_id)
               || jsonb_build_object('month', m.month, 'lifters', m.lifters) order by m.month desc), '[]'::jsonb)
      from (
        select mr.* from public.monthly_records mr
        where mr.board_key = v_key and (mr.user_id is null or not public._blocked(v_uid, mr.user_id))
        order by mr.month desc
        limit 12
      ) m
    )
  );
end;
$$;

-- Titles a person holds right now, as the viewer may see them: group titles
-- only to fellow members, gym titles to anyone who may see the profile.
create function public._titles(p_viewer uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'board_key', rh.board_key,
    'kind', case when rh.group_id is not null then 'group' else 'gym' end,
    'exercise', jsonb_build_object('id', e.id, 'name', e.name, 'slug', e.slug, 'ranking_method', e.ranking_method),
    'group', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
    'gym', case when gy.id is null then null else jsonb_build_object('id', gy.id, 'name', gy.name) end,
    'since', rh.since
  ) || jsonb_build_object('lift', public._record_json(p_viewer, rh.user_id, rh.lift_id) -> 'lift')
    order by rh.since desc), '[]'::jsonb)
  from public.record_history rh
  join public.exercises e on e.id = rh.exercise_id
  left join public.groups g on g.id = rh.group_id
  left join public.gyms gy on gy.id = rh.gym_id
  where rh.user_id = p_user and rh.until is null
    and ((rh.group_id is not null and public._member(rh.group_id, p_viewer))
         or (rh.gym_id is not null and gy.status = 'approved'))
$$;

-- The share card for a title you hold right now.
create function public.get_champion_card(p_board_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t
  from jsonb_array_elements(public._titles(auth.uid(), auth.uid())) t
  where auth.uid() is not null and t ->> 'board_key' = p_board_key
  limit 1
$$;

-- Profiles show current titles and earned achievements.
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
    -- Current titles and achievements, behind the same visibility as the bio.
    'titles', case when v_details then public._titles(v_uid, v_p.id) else '[]'::jsonb end,
    'achievements', case when v_details then (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'description', a.description,
                                                   'earned_at', ua.earned_at) order by a.sort_order), '[]'::jsonb)
      from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id
      where ua.user_id = v_p.id
    ) else '[]'::jsonb end,
    'friend_count', (select count(*) from public.friendships f
                     where f.status = 'accepted' and v_p.id in (f.requester_id, f.addressee_id))
  );
end;
$$;


-- Notifications carry the gym and achievement they're about.
create or replace function public.get_notifications(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'type', n.type, 'created_at', n.created_at, 'read_at', n.read_at,
    'actor', case when a.id is null then null else jsonb_build_object(
      'id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_path', a.avatar_path) end,
    'group', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
    'gym', (select jsonb_build_object('id', gy.id, 'name', gy.name) from public.gyms gy where gy.id = n.gym_id),
    'achievement', (select jsonb_build_object('id', ac.id, 'name', ac.name, 'description', ac.description)
                    from public.achievements ac where n.type = 'achievement' and ac.id = n.detail),
    'exercise', case when e.id is null then null else jsonb_build_object(
      'id', e.id, 'name', e.name, 'ranking_method', e.ranking_method) end,
    'lift', case when l.id is null then null else jsonb_build_object(
      'id', l.id, 'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit,
      'weight_kg', l.weight_kg, 'reps', l.reps, 'score', l.score, 'user_id', l.user_id) end,
    'detail', n.detail,
    'friendship_id', n.friendship_id,
    'friendship_pending', exists (select 1 from public.friendships f where f.id = n.friendship_id and f.status = 'pending')
  ) order by n.created_at desc), '[]'::jsonb)
  from (
    select * from public._visible_notifications(auth.uid())
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) n
  left join public.profiles a on a.id = n.actor_id
  left join public.groups g on g.id = n.group_id
  left join public.exercises e on e.id = n.exercise_id
  left join public.lifts l on l.id = n.lift_id
$$;


-- ───────────── Backfill (no notifications) ─────────────
insert into public.user_achievements (user_id, achievement_id, earned_at)
select distinct on (l.user_id) l.user_id, 'first_lift', l.created_at
from public.lifts l join public.profiles p on p.id = l.user_id
order by l.user_id, l.created_at
on conflict do nothing;
insert into public.user_achievements (user_id, achievement_id, earned_at)
select distinct on (rh.user_id) rh.user_id, 'group_champion', rh.since
from public.record_history rh join public.profiles p on p.id = rh.user_id
where rh.board_key like 'group:%'
order by rh.user_id, rh.since
on conflict do nothing;
insert into public.user_achievements (user_id, achievement_id, earned_at)
select distinct on (l.user_id) l.user_id, 'verified_lifter', now()
from public.lifts l join public.profiles p on p.id = l.user_id
where l.verification_status = 'verified' and l.deleted_at is null
order by l.user_id
on conflict do nothing;

-- From now on, new achievements (except the first lift, which the result screen
-- already celebrates) arrive as a notification.
create function public._on_achievement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.achievement_id <> 'first_lift' then
    insert into public.notifications (recipient_id, type, detail) values (new.user_id, 'achievement', new.achievement_id);
  end if;
  return null;
end;
$$;
create trigger user_achievements_notify after insert on public.user_achievements
  for each row execute function public._on_achievement();

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
  public.get_leaderboard(uuid, text, uuid, text, integer, integer, integer, uuid, boolean),
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
  public.submit_machine_model(uuid, text, uuid),
  public.get_proof_state(uuid),
  public.request_proof(uuid, text),
  public.decline_proof_request(uuid, text),
  public.begin_proof_upload(uuid, bigint, text, numeric),
  public.complete_proof_upload(uuid),
  public.request_proof_view(uuid),
  public.my_proof_paths(),
  public.mod_proof_queue(),
  public.mod_review_proof(uuid, text, text),
  public.appeal_proof(uuid, text),
  public.get_record_history(text, uuid, uuid),
  public.get_champion_card(text),
  -- Storage evaluates its policies as the signed-in user, so these must be callable.
  -- They only answer yes/no about the caller's own access to one path.
  public._proof_can_upload(text),
  public._proof_can_read(text),
  public._proof_can_delete(text)
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records() to service_role;

grant execute on function public.get_invite_preview(text) to anon;
