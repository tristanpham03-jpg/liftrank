-- LiftRank 0004 — leaderboards, champions, lift submission, lift edits.

-- ───────────── Board core ─────────────
-- One row per participant: their best eligible lift, ranked by a total order
-- (score ↓, weight ↓, performed_at ↑, created_at ↑, id ↑), so ranks are unique.
--
-- friends board: viewer + accepted friends; lifts with visibility public/friends.
-- group board:   group members; public lifts + lifts explicitly shared with the group.
--                Identical for every member.
create function public._board(
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
  with bounds as (
    select
      (date_trunc('month', now() at time zone public.app_timezone())) at time zone public.app_timezone() as m_start,
      (date_trunc('month', now() at time zone public.app_timezone()) + interval '1 month') at time zone public.app_timezone() as m_end
  ),
  participants as (
    select p_viewer as id where p_kind = 'friends' and p_viewer is not null
    union
    select case when f.requester_id = p_viewer then f.addressee_id else f.requester_id end
    from public.friendships f
    where p_kind = 'friends' and f.status = 'accepted' and p_viewer in (f.requester_id, f.addressee_id)
    union
    select m.user_id from public.group_members m where p_kind = 'group' and m.group_id = p_group
  ),
  eligible as (
    select l.*
    from public.lifts l
    join participants p on p.id = l.user_id
    cross join bounds b
    where l.exercise_id = p_exercise
      and l.is_ranked
      and l.deleted_at is null
      and (
        p_period = 'all'
        or (l.monthly_eligible and l.performed_at >= b.m_start and l.performed_at < b.m_end)
      )
      and case
        when p_kind = 'friends' then l.visibility in ('public', 'friends')
        else l.visibility = 'public'
          or (l.visibility = 'groups' and exists (
            select 1 from public.lift_group_shares s where s.lift_id = l.id and s.group_id = p_group
          ))
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

create function public._board_row_json(
  p_pos bigint, p_uid uuid, p_lid uuid, p_score numeric, p_weight_kg numeric,
  p_entered_weight numeric, p_entered_unit public.weight_unit, p_reps integer,
  p_performed_at timestamptz, p_vstatus public.verification_status, p_viewer uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rank', p_pos,
    'user_id', p_uid,
    'username', pr.username,
    'display_name', pr.display_name,
    'avatar_path', pr.avatar_path,
    'lift_id', p_lid,
    'score', p_score,
    'weight_kg', p_weight_kg,
    'entered_weight', p_entered_weight,
    'entered_unit', p_entered_unit,
    'reps', p_reps,
    'performed_at', p_performed_at,
    'verification_status', p_vstatus,
    'is_me', p_uid = p_viewer
  )
  from public.profiles pr
  where pr.id = p_uid
$$;

-- ───────────── Champions ─────────────
-- Keeps record_history in sync for one group board (all-time). A board needs
-- at least 3 ranked lifters to have a champion.
create function public._sync_group_champion(p_group uuid, p_exercise uuid)
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
begin
  perform pg_advisory_xact_lock(hashtext(v_key));

  select * into v_cur from public.record_history where board_key = v_key and until is null;
  v_has_cur := found;

  select count(*) into v_total from public._board(null, 'group', p_group, p_exercise, 'all');
  select b.uid, b.lid into v_top_user, v_top_lift
  from public._board(null, 'group', p_group, p_exercise, 'all') b where b.pos = 1;

  v_new_user := case when v_total >= 3 then v_top_user end;

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

-- Re-sync every board in a group (after membership changes).
create function public._sync_group_all(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ex uuid;
begin
  for v_ex in
    select distinct l.exercise_id
    from public.lifts l join public.group_members m on m.user_id = l.user_id and m.group_id = p_group
    where l.is_ranked and l.deleted_at is null
    union
    select rh.exercise_id from public.record_history rh where rh.group_id = p_group and rh.until is null
  loop
    perform public._sync_group_champion(p_group, v_ex);
  end loop;
end;
$$;

-- Sync one exercise across every group a user belongs to.
create function public._sync_user_groups(p_user uuid, p_exercise uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  for v_group in select group_id from public.group_members where user_id = p_user loop
    perform public._sync_group_champion(v_group, p_exercise);
  end loop;
end;
$$;

-- ───────────── Public leaderboard API ─────────────
create function public.get_leaderboard(
  p_exercise_id uuid,
  p_kind text default 'friends',
  p_group_id uuid default null,
  p_period text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
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
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('friends', 'group') then raise exception 'invalid_board'; end if;
  if p_period not in ('all', 'month') then raise exception 'invalid_period'; end if;
  if p_kind = 'group' and (p_group_id is null or not public._member(p_group_id, v_uid)) then
    raise exception 'not_a_member';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  -- Blocked users stay in the ranking (so every member sees the same numbers)
  -- but their row is hidden from the viewer.
  with b as materialized (
    select x.*, public._blocked(v_uid, x.uid) as hidden
    from public._board(v_uid, p_kind, p_group_id, p_exercise_id, p_period) x
  ),
  me as (select * from b where uid = v_uid)
  select jsonb_build_object(
    'total', (select count(*) from b),
    'rows', (
      select coalesce(jsonb_agg(
        public._board_row_json(pg.pos, pg.uid, pg.lid, pg.score, pg.weight_kg, pg.entered_weight,
          pg.entered_unit, pg.reps, pg.performed_at, pg.vstatus, v_uid) order by pg.pos), '[]'::jsonb)
      from (select * from b where not b.hidden order by b.pos limit p_limit offset p_offset) pg
    ),
    'me', (
      select public._board_row_json(m.pos, m.uid, m.lid, m.score, m.weight_kg, m.entered_weight,
        m.entered_unit, m.reps, m.performed_at, m.vstatus, v_uid)
      from me m
    ),
    'above', (
      select public._board_row_json(a.pos, a.uid, a.lid, a.score, a.weight_kg, a.entered_weight,
        a.entered_unit, a.reps, a.performed_at, a.vstatus, v_uid)
      from b a
      where not a.hidden and a.pos < (select m.pos from me m)
      order by a.pos desc
      limit 1
    ),
    'top', (
      select public._board_row_json(t.pos, t.uid, t.lid, t.score, t.weight_kg, t.entered_weight,
        t.entered_unit, t.reps, t.performed_at, t.vstatus, v_uid)
      from b t where t.pos = 1 and not t.hidden
    )
  )
  into v_result;

  if p_kind = 'group' then
    if p_period = 'all' then
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
    elsif (v_result->>'total')::integer >= 3 then
      v_champion := v_result->'top';
    end if;
  end if;

  return (v_result - 'top') || jsonb_build_object('champion', v_champion);
end;
$$;

-- ───────────── Lift submission ─────────────
create function public._my_board_positions(
  p_user uuid, p_exercise uuid, p_include_friends boolean, p_groups uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x->>'kind') = 'friends' desc, x->>'group_name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'kind', 'friends', 'group_id', null, 'group_name', null,
      'rank', (select b.pos from public._board(p_user, 'friends', null, p_exercise, 'all') b where b.uid = p_user),
      'total', (select count(*) from public._board(p_user, 'friends', null, p_exercise, 'all'))
    ) as x
    where p_include_friends
    union all
    select jsonb_build_object(
      'kind', 'group', 'group_id', g.id, 'group_name', g.name,
      'rank', (select b.pos from public._board(p_user, 'group', g.id, p_exercise, 'all') b where b.uid = p_user),
      'total', (select count(*) from public._board(p_user, 'group', g.id, p_exercise, 'all'))
    )
    from public.groups g
    where g.id = any (coalesce(p_groups, '{}'))
  ) s
$$;

create function public._lift_groups(p_user uuid, p_lift uuid, p_visibility public.lift_visibility)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case p_visibility
    when 'public' then array(select group_id from public.group_members where user_id = p_user)
    when 'groups' then array(
      select s.group_id from public.lift_group_shares s
      join public.group_members m on m.group_id = s.group_id and m.user_id = p_user
      where s.lift_id = p_lift
    )
    else '{}'::uuid[]
  end
$$;

create function public.submit_lift(
  p_exercise_id uuid,
  p_weight numeric,
  p_unit public.weight_unit,
  p_reps integer,
  p_performed_at timestamptz default null,
  p_visibility public.lift_visibility default null,
  p_group_ids uuid[] default '{}',
  p_notes text default null,
  p_idempotency_key uuid default null
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
    score, is_ranked, performed_at, visibility, flagged_for_review, notes, idempotency_key
  ) values (
    v_uid, p_exercise_id,
    case when v_weight_kg is null then null else p_weight end,
    case when v_weight_kg is null then null else p_unit end,
    v_weight_kg, p_reps, v_ex.weight_convention,
    v_score, v_ranked, v_performed, v_vis,
    coalesce(v_weight_kg > v_ex.flag_threshold_kg, false),
    v_notes, p_idempotency_key
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

-- ───────────── Lift edits ─────────────
-- Weight, reps, exercise and date are immutable; delete and re-log instead.
create function public.update_lift_sharing(
  p_lift_id uuid,
  p_visibility public.lift_visibility,
  p_group_ids uuid[] default '{}',
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_lift from public.lifts where id = p_lift_id and user_id = v_uid and deleted_at is null for update;
  if not found then raise exception 'not_found'; end if;
  if v_notes is not null and char_length(v_notes) > 280 then raise exception 'notes_too_long'; end if;
  if p_visibility = 'groups' then
    if coalesce(cardinality(p_group_ids), 0) = 0 then raise exception 'groups_required'; end if;
    if exists (select 1 from unnest(p_group_ids) g(id) where not public._member(g.id, v_uid)) then
      raise exception 'not_a_member';
    end if;
  end if;

  update public.lifts set visibility = p_visibility, notes = v_notes where id = p_lift_id;
  delete from public.lift_group_shares where lift_id = p_lift_id;
  if p_visibility = 'groups' then
    insert into public.lift_group_shares (lift_id, group_id)
    select p_lift_id, g from (select distinct unnest(p_group_ids) g) s;
  end if;

  perform public._sync_user_groups(v_uid, v_lift.exercise_id);
end;
$$;

create function public.delete_lift(p_lift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_exercise uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.lifts set deleted_at = now()
  where id = p_lift_id and user_id = v_uid and deleted_at is null
  returning exercise_id into v_exercise;
  if v_exercise is null then raise exception 'not_found'; end if;
  perform public._sync_user_groups(v_uid, v_exercise);
end;
$$;

-- ───────────── Lift reads ─────────────
-- Best visible ranked lift per exercise for a user (their PRs as the viewer may see them).
create function public.get_prs(p_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'exercise_id', b.exercise_id, 'exercise_name', e.name, 'exercise_slug', e.slug,
    'ranking_method', e.ranking_method, 'lift_id', b.id, 'entered_weight', b.entered_weight,
    'entered_unit', b.entered_unit, 'weight_kg', b.weight_kg, 'reps', b.reps, 'score', b.score,
    'performed_at', b.performed_at, 'verification_status', b.verification_status
  ) order by b.performed_at desc), '[]'::jsonb)
  from (
    select distinct on (l.exercise_id) l.*
    from public.lifts l
    where auth.uid() is not null
      and l.user_id = coalesce(p_user_id, auth.uid())
      and l.is_ranked and l.deleted_at is null
      and public._can_view_lift(auth.uid(), l.id, l.user_id, l.visibility)
    order by l.exercise_id, l.score desc, l.weight_kg desc nulls last, l.performed_at, l.created_at, l.id
  ) b
  join public.exercises e on e.id = b.exercise_id
$$;

-- Everything the Add Lift screen needs to prefill in one call.
create function public.get_lift_defaults()
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
        'entered_weight', x.entered_weight, 'entered_unit', x.entered_unit, 'reps', x.reps)), '{}'::jsonb)
      from (
        select distinct on (l.exercise_id) l.exercise_id, l.entered_weight, l.entered_unit, l.reps
        from public.lifts l where l.user_id = auth.uid() and l.deleted_at is null
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
  public.get_leaderboard(uuid, text, uuid, text, integer, integer),
  public.submit_lift(uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid),
  public.update_lift_sharing(uuid, public.lift_visibility, uuid[], text),
  public.delete_lift(uuid),
  public.get_prs(uuid),
  public.get_lift_defaults()
to authenticated;
