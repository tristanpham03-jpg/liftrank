-- LiftRank 0009 — Proof refinements.
--
-- 1. The person who asked for proof may watch the video (same short-lived,
--    rate-limited grants as everyone else; never anyone else).
-- 2. "Insufficient evidence" and "confirmed invalid" are now different:
--    • insufficient → lift stays 'disputed' and keeps competing;
--    • rejected (confirmed invalid) → lifts.invalidated_at is set: the lift no
--      longer counts on any leaderboard, champion title, PR or feed item, but the
--      lift and its history are kept. The owner may appeal once, with a new
--      video, decided by a different moderator.
--
-- Additive. The only data change backfills invalidated_at for lifts already
-- 'rejected' (none at the time of writing).

alter table public.lifts add column invalidated_at timestamptz;
update public.lifts set invalidated_at = now() where verification_status = 'rejected' and invalidated_at is null;

create table public.proof_appeals (
  id uuid primary key default gen_random_uuid(),
  lift_id uuid not null unique references public.lifts (id) on delete cascade, -- one appeal per lift
  user_id uuid not null references public.profiles (id) on delete cascade,
  note text not null check (char_length(note) between 3 and 500),
  rejected_by uuid references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz
);
alter table public.proof_appeals enable row level security;
revoke all on public.proof_appeals from anon, authenticated;
grant all on public.proof_appeals to service_role;

-- Everyone sees a confirmed-invalid lift as what it is (it no longer counts
-- anywhere); 'under_review' is unused and reads as 'proof_uploaded'.
create or replace function public._public_vstatus(p_status public.verification_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status when 'under_review' then 'proof_uploaded' else p_status::text end
$$;

-- ───────────── Confirmed-invalid lifts leave every board (and so every champion title) ─────────────
create or replace function public._board_x(
  p_viewer uuid, p_kind text, p_group uuid, p_exercise uuid, p_period text,
  p_gym uuid, p_radius_mi double precision, p_model uuid,
  p_verified boolean default false
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


-- PRs (profiles, share cards) skip confirmed-invalid lifts. The lift stays in its owner's history.
create or replace function public.get_prs(p_user_id uuid default null)
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
      and l.is_ranked and l.deleted_at is null and l.invalidated_at is null
      and public._can_view_lift(auth.uid(), l.id, l.user_id, l.visibility)
    order by l.exercise_id, l.score desc, l.weight_kg desc nulls last, l.performed_at, l.created_at, l.id
  ) b
  join public.exercises e on e.id = b.exercise_id
$$;


-- Feed items about a confirmed-invalid lift disappear.
create or replace function public._can_view_activity(p_viewer uuid, p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.activities a
    left join public.lifts l on l.id = a.lift_id
    where a.id = p_activity
      and p_viewer is not null
      and not public._blocked(p_viewer, a.actor_id)
      and (a.target_user_id is null or not public._blocked(p_viewer, a.target_user_id))
      and (a.lift_id is null or (l.deleted_at is null and l.invalidated_at is null and public._can_view_lift(p_viewer, l.id, l.user_id, l.visibility)))
      and (
        a.actor_id = p_viewer
        or (a.group_id is null and public._friends(p_viewer, a.actor_id))
        or (a.group_id is not null and public._member(a.group_id, p_viewer))
      )
  )
$$;


-- PR detection and "you passed" comparisons ignore confirmed-invalid lifts.
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


-- New proof is welcome on unverified and disputed lifts; on a rejected
-- (confirmed-invalid) lift only as part of its one open appeal.
create function public._proof_upload_allowed(p_lift uuid, p_status public.verification_status)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_status in ('unverified', 'disputed')
    or (p_status = 'rejected' and exists (select 1 from public.proof_appeals a where a.lift_id = p_lift and a.status = 'open'))
$$;

create or replace function public.begin_proof_upload(p_lift_id uuid, p_bytes bigint, p_mime text, p_seconds numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_s public.proof_settings := public._proof_settings();
  v_used bigint;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_stale text[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_lift from public.lifts where id = p_lift_id and user_id = v_uid and deleted_at is null;
  if v_lift.id is null then raise exception 'not_found'; end if;
  if not public._proof_upload_allowed(v_lift.id, v_lift.verification_status) then
    raise exception 'proof_not_needed';
  end if;
  if p_mime is null or p_mime not in ('video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'invalid_video_type';
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > v_s.max_bytes then raise exception 'video_too_large'; end if;
  if p_seconds is null or p_seconds <= 0 or p_seconds > v_s.max_seconds + 0.5 then raise exception 'video_too_long'; end if;
  if (select count(*) from public.proof_uploads
      where user_id = v_uid and created_at > now() - interval '24 hours') >= v_s.uploads_per_day then
    raise exception 'too_many_uploads';
  end if;

  -- Your own abandoned slots are given up; the app removes any half-written files.
  with stale as (
    update public.proof_uploads set status = 'discarded'
    where user_id = v_uid and status = 'pending'
    returning path
  )
  select coalesce(array_agg(path), '{}') into v_stale from stale;

  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into v_used
  from storage.objects o where o.bucket_id = 'lift-proofs';
  v_used := v_used + coalesce((
    select sum(bytes) from public.proof_uploads
    where status = 'pending' and created_at > now() - interval '1 hour'
  ), 0);
  if v_used + p_bytes > v_s.storage_budget_bytes then raise exception 'proof_storage_full'; end if;

  v_path := v_uid || '/' || p_lift_id || '/' || v_id || case p_mime
    when 'video/mp4' then '.mp4' when 'video/quicktime' then '.mov' else '.webm' end;
  insert into public.proof_uploads (id, user_id, lift_id, path, bytes, mime, seconds)
  values (v_id, v_uid, p_lift_id, v_path, p_bytes, p_mime, p_seconds);

  return jsonb_build_object('upload_id', v_id, 'path', v_path, 'bucket', 'lift-proofs', 'stale_paths', to_jsonb(v_stale));
end;
$$;


create or replace function public.complete_proof_upload(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_up public.proof_uploads%rowtype;
  v_obj jsonb;
  v_lift public.lifts%rowtype;
  v_ch public.lift_challenges%rowtype;
  v_s public.proof_settings := public._proof_settings();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_up from public.proof_uploads
  where id = p_upload_id and user_id = v_uid and status = 'pending' and created_at > now() - interval '1 hour'
  for update;
  if v_up.id is null then raise exception 'upload_expired'; end if;

  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'lift-proofs' and o.name = v_up.path;
  if v_obj is null then raise exception 'upload_missing'; end if;
  if coalesce((v_obj ->> 'size')::bigint, 0) > v_s.max_bytes
     or coalesce(v_obj ->> 'mimetype', '') not in ('video/mp4', 'video/quicktime', 'video/webm') then
    update public.proof_uploads set status = 'discarded' where id = v_up.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_video_type', 'remove_paths', jsonb_build_array(v_up.path));
  end if;

  select * into v_lift from public.lifts where id = v_up.lift_id and user_id = v_uid and deleted_at is null for update;
  if v_lift.id is null or not public._proof_upload_allowed(v_lift.id, v_lift.verification_status) then
    update public.proof_uploads set status = 'discarded' where id = v_up.id;
    return jsonb_build_object('ok', false, 'error', 'proof_not_needed', 'remove_paths', jsonb_build_array(v_up.path));
  end if;

  update public.lifts set video_path = v_up.path, verification_status = 'proof_uploaded' where id = v_lift.id;
  update public.proof_uploads set status = 'complete', completed_at = now(), bytes = coalesce((v_obj ->> 'size')::bigint, bytes)
  where id = v_up.id;

  update public.lift_challenges set status = 'proof_submitted', answered_at = now()
  where lift_id = v_lift.id and status = 'open'
  returning * into v_ch;
  if v_ch.id is not null then
    insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
    values (v_ch.challenger_id, v_uid, 'proof_response', v_lift.exercise_id, v_lift.id, 'uploaded');
  end if;

  return jsonb_build_object(
    'ok', true,
    'remove_paths', case when v_lift.video_path is not null and v_lift.video_path <> v_up.path
                         then jsonb_build_array(v_lift.video_path) else '[]'::jsonb end
  );
end;
$$;


-- One appeal per confirmed-invalid lift, by its owner, with a short note.
-- The owner then uploads a new video; a different moderator decides.
create function public.appeal_proof(p_lift_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_lift public.lifts%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_lift from public.lifts where id = p_lift_id and user_id = v_uid and deleted_at is null;
  if v_lift.id is null then raise exception 'not_found'; end if;
  if v_lift.verification_status <> 'rejected' or v_lift.invalidated_at is null then raise exception 'cannot_appeal'; end if;
  if exists (select 1 from public.proof_appeals where lift_id = p_lift_id) then raise exception 'already_appealed'; end if;
  if char_length(v_note) < 3 or char_length(v_note) > 500 then raise exception 'appeal_note_invalid'; end if;
  insert into public.proof_appeals (lift_id, user_id, note, rejected_by)
  values (p_lift_id, v_uid, v_note, (
    select r.reviewer_id from public.verification_reviews r
    where r.lift_id = p_lift_id and r.decision = 'rejected' order by r.created_at desc limit 1
  ));
end;
$$;

-- The person who asked for proof of this lift, once a video was submitted,
-- while they can still see the lift (not blocked, still allowed by visibility).
create function public._is_proof_requester(p_viewer uuid, p_lift uuid, p_owner uuid, p_visibility public.lift_visibility)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null and p_viewer <> p_owner
    and exists (
      select 1 from public.lift_challenges c
      where c.lift_id = p_lift and c.challenger_id = p_viewer and c.status in ('proof_submitted', 'resolved')
    )
    and public._can_view_lift(p_viewer, p_lift, p_owner, p_visibility)
$$;

-- Playback: the owner, moderators, and now the person who asked for this proof.
-- Same grant, daily limit and monthly budget for everyone but moderators.
create or replace function public.request_proof_view(p_lift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_mod boolean;
  v_s public.proof_settings := public._proof_settings();
  v_bytes bigint;
  v_month_start timestamptz := date_trunc('month', now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_mod := public._is_moderator(v_uid);
  select * into v_lift from public.lifts where id = p_lift_id and deleted_at is null;
  if v_lift.id is null or v_lift.video_path is null or not (
    v_lift.user_id = v_uid or v_mod or public._is_proof_requester(v_uid, v_lift.id, v_lift.user_id, v_lift.visibility)
  ) then
    raise exception 'not_found';
  end if;

  -- Re-opening the same video within its grant is free.
  if exists (select 1 from public.proof_view_grants
             where user_id = v_uid and path = v_lift.video_path and expires_at > now()) then
    return jsonb_build_object('path', v_lift.video_path, 'bucket', 'lift-proofs');
  end if;

  if (select count(*) from public.proof_view_grants where user_id = v_uid and created_at > now() - interval '24 hours')
     >= (case when v_mod then v_s.moderator_views_per_day else v_s.views_per_day end) then
    raise exception 'too_many_views';
  end if;
  select coalesce((o.metadata ->> 'size')::bigint, 0) into v_bytes
  from storage.objects o where o.bucket_id = 'lift-proofs' and o.name = v_lift.video_path;
  if v_bytes is null then raise exception 'not_found'; end if;
  if coalesce((select sum(bytes) from public.proof_view_grants where created_at >= v_month_start), 0) + v_bytes
     > v_s.monthly_view_budget_bytes then
    raise exception 'proof_view_budget';
  end if;

  insert into public.proof_view_grants (user_id, lift_id, path, bytes, expires_at)
  values (v_uid, v_lift.id, v_lift.video_path, v_bytes, now() + interval '2 minutes');
  return jsonb_build_object('path', v_lift.video_path, 'bucket', 'lift-proofs');
end;
$$;


create or replace function public.get_proof_state(p_lift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_owner boolean;
  v_mod boolean;
  v_settings public.proof_settings;
  v_active public.lift_challenges%rowtype;
  v_mine public.lift_challenges%rowtype;
  v_review jsonb;
  v_can_request boolean;
  v_appeal public.proof_appeals%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_lift from public.lifts where id = p_lift_id and deleted_at is null;
  if v_lift.id is null or not public._can_view_lift(v_uid, v_lift.id, v_lift.user_id, v_lift.visibility) then
    raise exception 'not_found';
  end if;
  v_owner := v_lift.user_id = v_uid;
  v_mod := public._is_moderator(v_uid);
  v_settings := public._proof_settings();

  select * into v_active from public.lift_challenges
  where lift_id = p_lift_id and status in ('open', 'proof_submitted') limit 1;
  select * into v_mine from public.lift_challenges
  where lift_id = p_lift_id and challenger_id = v_uid order by created_at desc limit 1;

  v_can_request := not v_owner
    and public._friends(v_uid, v_lift.user_id)
    and v_lift.verification_status in ('unverified', 'disputed', 'rejected')
    and v_active.id is null
    and v_mine.id is null;

  select * into v_appeal from public.proof_appeals where lift_id = p_lift_id;

  if v_owner then
    select jsonb_build_object('decision', r.decision, 'notes', r.notes, 'created_at', r.created_at)
    into v_review
    from public.verification_reviews r where r.lift_id = p_lift_id order by r.created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'status', case when v_owner then v_lift.verification_status::text else public._public_vstatus(v_lift.verification_status) end,
    'is_owner', v_owner,
    'has_video', v_lift.video_path is not null
      and (v_owner or v_mod or public._is_proof_requester(v_uid, v_lift.id, v_lift.user_id, v_lift.visibility)),
    'can_upload', v_owner and public._proof_upload_allowed(v_lift.id, v_lift.verification_status),
    'invalidated', v_lift.invalidated_at is not null,
    'can_appeal', v_owner and v_lift.invalidated_at is not null and v_lift.verification_status = 'rejected' and v_appeal.id is null,
    'appeal', case when v_owner and v_appeal.id is not null then
      jsonb_build_object('status', v_appeal.status, 'note', v_appeal.note, 'created_at', v_appeal.created_at) end,
    'can_request', v_can_request,
    -- The owner sees who asked; the person who asked sees their own request.
    'challenge', case
      when v_owner and v_active.id is not null then (
        select jsonb_build_object(
          'id', v_active.id, 'status', v_active.status, 'reason', v_active.reason, 'created_at', v_active.created_at,
          'challenger', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name))
        from public.profiles p where p.id = v_active.challenger_id
      )
      when v_mine.id is not null then jsonb_build_object(
        'id', v_mine.id, 'status', v_mine.status, 'response', v_mine.response, 'created_at', v_mine.created_at, 'mine', true)
    end,
    'review', v_review,
    'limits', case when v_owner then jsonb_build_object(
      'max_bytes', v_settings.max_bytes, 'max_seconds', v_settings.max_seconds,
      'mime_types', jsonb_build_array('video/mp4', 'video/quicktime', 'video/webm')) end
  );
end;
$$;


create or replace function public.mod_proof_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_moderator(auth.uid()) then raise exception 'forbidden'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'lift_id', l.id, 'user_id', l.user_id, 'username', p.username,
      'exercise', jsonb_build_object('name', e.name, 'ranking_method', e.ranking_method, 'weight_convention', e.weight_convention),
      'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit, 'weight_kg', l.weight_kg,
      'reps', l.reps, 'score', l.score, 'performed_at', l.performed_at,
      'uploaded_at', u.completed_at, 'seconds', u.seconds, 'bytes', u.bytes,
      'requested', exists (select 1 from public.lift_challenges c where c.lift_id = l.id and c.status = 'proof_submitted'),
      'appeal', (select jsonb_build_object('note', a.note, 'created_at', a.created_at)
                 from public.proof_appeals a where a.lift_id = l.id and a.status = 'open')
    ) order by q.uploaded_at nulls first), '[]'::jsonb)
    from (
      select l.id, u.completed_at as uploaded_at
      from public.lifts l
      left join public.proof_uploads u on u.path = l.video_path
      where l.deleted_at is null and l.verification_status = 'proof_uploaded' and l.video_path is not null
        and l.user_id <> auth.uid()
        -- An appeal goes to someone other than the moderator who rejected it.
        and not exists (select 1 from public.proof_appeals a
                        where a.lift_id = l.id and a.status = 'open' and a.rejected_by = auth.uid())
      order by u.completed_at nulls first
      limit 100
    ) q
    join public.lifts l on l.id = q.id
    join public.profiles p on p.id = l.user_id
    join public.exercises e on e.id = l.exercise_id
    left join public.proof_uploads u on u.path = l.video_path
  );
end;
$$;


-- Review outcomes. verified: keeps the video. insufficient: 'disputed', still
-- competes, video removed, the owner may try again. rejected: confirmed invalid,
-- leaves every board and title, video removed; the owner may appeal once and a
-- different moderator decides. Returns the file to remove.
create or replace function public.mod_review_proof(p_lift_id uuid, p_decision text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_ch public.lift_challenges%rowtype;
  v_appeal public.proof_appeals%rowtype;
begin
  if not public._is_moderator(v_uid) then raise exception 'forbidden'; end if;
  if p_decision not in ('verified', 'insufficient', 'rejected') then raise exception 'invalid_decision'; end if;
  if char_length(coalesce(v_notes, '')) > 500 then raise exception 'notes_too_long'; end if;
  select * into v_lift from public.lifts
  where id = p_lift_id and deleted_at is null and verification_status = 'proof_uploaded' and video_path is not null
  for update;
  if v_lift.id is null then raise exception 'not_found'; end if;
  if v_lift.user_id = v_uid then raise exception 'cannot_review_own'; end if;
  select * into v_appeal from public.proof_appeals where lift_id = v_lift.id and status = 'open' for update;
  if v_appeal.id is not null and v_appeal.rejected_by = v_uid then raise exception 'appeal_needs_other_reviewer'; end if;

  insert into public.verification_reviews (lift_id, reviewer_id, decision, notes)
  values (v_lift.id, v_uid, case p_decision when 'insufficient' then 'disputed' else p_decision end, v_notes);
  update public.lifts set
    verification_status = case p_decision when 'verified' then 'verified' when 'insufficient' then 'disputed' else 'rejected' end::public.verification_status,
    video_path = case when p_decision = 'verified' then video_path end,
    -- Only a rejection marks the lift invalid; anything else (including a successful appeal) clears it.
    invalidated_at = case when p_decision = 'rejected' then coalesce(invalidated_at, now()) end
  where id = v_lift.id;
  if v_appeal.id is not null then
    update public.proof_appeals
    set status = case when p_decision = 'rejected' then 'upheld' else 'overturned' end, decided_by = v_uid, decided_at = now()
    where id = v_appeal.id;
  end if;
  -- Group champions follow the lift in or out of contention.
  if (p_decision = 'rejected') <> (v_lift.invalidated_at is not null) then
    perform public._sync_user_groups(v_lift.user_id, v_lift.exercise_id);
  end if;

  -- The owner hears the outcome (no reviewer named); so does whoever asked.
  insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
  values (v_lift.user_id, null, 'proof_reviewed', v_lift.exercise_id, v_lift.id, p_decision);
  update public.lift_challenges set status = 'resolved', resolved_at = now()
  where lift_id = v_lift.id and status in ('open', 'proof_submitted')
  returning * into v_ch;
  if v_ch.id is not null then
    insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
    values (v_ch.challenger_id, v_lift.user_id, 'proof_reviewed', v_lift.exercise_id, v_lift.id, p_decision);
  end if;

  return jsonb_build_object(
    'remove_paths', case when p_decision = 'verified' then '[]'::jsonb else jsonb_build_array(v_lift.video_path) end
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
  -- Storage evaluates its policies as the signed-in user, so these must be callable.
  -- They only answer yes/no about the caller's own access to one path.
  public._proof_can_upload(text),
  public._proof_can_read(text),
  public._proof_can_delete(text)
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans() to service_role;

grant execute on function public.get_invite_preview(text) to anon;
