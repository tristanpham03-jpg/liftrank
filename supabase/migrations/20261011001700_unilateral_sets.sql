-- LiftRank 0017 — Unilateral (left / right) sets in My Training.
--
-- 1. exercises.supports_unilateral: true for the 28 exercises that are really
--    done one arm or one leg at a time (dumbbell, cable, iso-lateral machine and
--    leg-machine work, Bulgarian split squats). Barbell, Smith, bodyweight and
--    fixed-path movements stay bilateral. Nothing else on exercises changes.
-- 2. training_sets.side: 'left' | 'right' | null. Null means bilateral or
--    unspecified, so every existing row stays valid and is never assigned a side.
--    The one-row-per-slot rule now includes side (Left set 1 and Right set 1
--    can both exist; a bilateral set 1 still can't be saved twice).
-- 3. exercise_preferences: a user's "log this one left/right" choice per
--    exercise. Owner-only, written through set_unilateral_preference.
-- 4. log_training_set / update_training_set gain an optional side (the old
--    signatures are replaced; callers that don't pass a side behave as before;
--    an edit keeps its side unless asked). Sided sets never count toward
--    personal-best prompts and can't be submitted to boards: unilateral
--    competitive scoring needs its own approved rule first.
--
-- Additive for data: no existing row is changed or deleted. Leaderboards,
-- lifts, scoring and submit_lift are untouched.

alter table public.exercises add column supports_unilateral boolean not null default false;
update public.exercises set supports_unilateral = true where slug in (
  'dumbbell-curl', 'hammer-curl', 'incline-dumbbell-curl', 'cable-curl', 'machine-preacher-curl', 'cable-wrist-curl',
  'triceps-pushdown', 'overhead-triceps-extension',
  'lateral-raise', 'cable-lateral-raise', 'rear-delt-fly', 'dumbbell-shoulder-press', 'machine-shoulder-press',
  'dumbbell-bench-press', 'incline-dumbbell-bench-press', 'machine-chest-press', 'incline-machine-chest-press', 'cable-fly',
  'lat-pulldown', 'seated-cable-row', 'machine-row', 'chest-supported-row',
  'bulgarian-split-squat', 'leg-press', 'leg-extension', 'seated-leg-curl', 'lying-leg-curl', 'calf-raise'
);

alter table public.training_sets add column side text check (side in ('left', 'right'));
drop index public.training_sets_slot_uidx;
create unique index training_sets_slot_uidx on public.training_sets (user_id, exercise_id, local_date, set_number, side) nulls not distinct;

create table public.exercise_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  unilateral boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
alter table public.exercise_preferences enable row level security;
revoke all on public.exercise_preferences from anon, authenticated;
grant select on public.exercise_preferences to authenticated;
grant all on public.exercise_preferences to service_role;
create policy exercise_preferences_own on public.exercise_preferences for select to authenticated using (user_id = auth.uid());

-- Remember whether you log an exercise left/right. Only for exercises that allow it.
create function public.set_unilateral_preference(p_exercise_id uuid, p_unilateral boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unilateral is null then raise exception 'invalid_request'; end if;
  if not exists (select 1 from public.exercises where id = p_exercise_id and is_active) then raise exception 'invalid_exercise'; end if;
  if p_unilateral and not (select supports_unilateral from public.exercises where id = p_exercise_id) then
    raise exception 'unilateral_not_supported';
  end if;
  insert into public.exercise_preferences (user_id, exercise_id, unilateral) values (v_uid, p_exercise_id, p_unilateral)
  on conflict (user_id, exercise_id) do update set unilateral = excluded.unilateral, updated_at = now();
end;
$$;

-- Validates a side for an exercise: null (bilateral) always; left/right only where supported.
create function public._check_side(p_exercise_id uuid, p_side text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_side is null then return; end if;
  if p_side not in ('left', 'right') then raise exception 'invalid_side'; end if;
  if not coalesce((select supports_unilateral from public.exercises where id = p_exercise_id), false) then
    raise exception 'unilateral_not_supported';
  end if;
end;
$$;

-- Personal bests (and PR prompts) compare bilateral performances only.
create or replace function public._personal_best(p_uid uuid, p_exercise_id uuid, p_exclude uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select max(s) from (
    select score s from public.training_sets
    where user_id = p_uid and exercise_id = p_exercise_id and is_ranked and side is null
      and id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
    union all
    select score from public.lifts
    where user_id = p_uid and exercise_id = p_exercise_id and is_ranked and deleted_at is null and invalidated_at is null
  ) x
$$;

drop function public.log_training_set(uuid, uuid, integer, numeric, public.weight_unit, integer, date, timestamptz, uuid);

-- Saves one confirmed working set (optionally one side). Opening a day writes
-- nothing; only this does. The same slot (exercise, day, set number, side) or
-- the same client key returns the saved row instead of creating a second one.
create function public.log_training_set(
  p_exercise_id uuid,
  p_day_id uuid,
  p_set_number integer,
  p_weight numeric,
  p_unit public.weight_unit,
  p_reps integer,
  p_local_date date,
  p_performed_at timestamptz,
  p_client_key uuid,
  p_side text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_vals record;
  v_row public.training_sets%rowtype;
  v_best numeric;
  v_prior boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_client_key is null then raise exception 'invalid_request'; end if;
  if p_set_number is null or p_set_number not between 1 and 30 then raise exception 'invalid_set_number'; end if;
  if p_day_id is not null and not exists (select 1 from public.training_days where id = p_day_id and user_id = v_uid) then
    raise exception 'not_found';
  end if;
  perform public._check_training_date(p_local_date, p_performed_at);
  select * into v_vals from public._training_values(p_exercise_id, p_weight, p_unit, p_reps);
  perform public._check_side(p_exercise_id, p_side);

  perform pg_advisory_xact_lock(hashtext('training-set:' || v_uid));
  select * into v_row from public.training_sets
  where user_id = v_uid and (client_key = p_client_key
    or (exercise_id = p_exercise_id and local_date = p_local_date and set_number = p_set_number and side is not distinct from p_side));
  if found then
    return jsonb_build_object('id', v_row.id, 'duplicate', true, 'is_pr', false);
  end if;
  if (select count(*) from public.training_sets where user_id = v_uid and created_at > now() - interval '1 day') >= 400 then
    raise exception 'too_many_sets';
  end if;

  v_best := public._personal_best(v_uid, p_exercise_id, null);
  v_prior := exists (select 1 from public.training_sets where user_id = v_uid and exercise_id = p_exercise_id and is_ranked and side is null and local_date < p_local_date)
    or exists (select 1 from public.lifts where user_id = v_uid and exercise_id = p_exercise_id and is_ranked and deleted_at is null and invalidated_at is null);
  insert into public.training_sets (user_id, exercise_id, day_id, set_number, side, entered_weight, entered_unit, weight_kg,
    reps, score, is_ranked, local_date, performed_at, client_key)
  values (v_uid, p_exercise_id, p_day_id, p_set_number, p_side, p_weight, case when p_weight is null then null else p_unit end,
    v_vals.weight_kg, p_reps, v_vals.score, v_vals.is_ranked, p_local_date, p_performed_at, p_client_key)
  returning * into v_row;

  -- PR prompts are for bilateral sets only (they lead to the boards).
  return jsonb_build_object('id', v_row.id, 'duplicate', false,
    'is_pr', p_side is null and v_row.is_ranked and v_prior and v_best is not null and v_row.score > v_best);
end;
$$;

drop function public.update_training_set(uuid, numeric, public.weight_unit, integer, date, timestamptz);

-- Corrects a saved set (numbers, date, side). Not a new performance. p_side:
-- 'keep' (default) leaves the side as it is; 'left' / 'right' / 'none' change it.
-- A set that is on a board keeps its numbers: edit the board entry instead.
create function public.update_training_set(p_set_id uuid, p_weight numeric, p_unit public.weight_unit, p_reps integer,
  p_local_date date, p_performed_at timestamptz, p_side text default 'keep')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.training_sets%rowtype;
  v_vals record;
  v_date date;
  v_side text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.training_sets where id = p_set_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  v_date := coalesce(p_local_date, v_row.local_date);
  v_side := case coalesce(p_side, 'keep') when 'keep' then v_row.side when 'none' then null else p_side end;
  perform public._check_training_date(v_date, coalesce(p_performed_at, v_row.performed_at));
  select * into v_vals from public._training_values(v_row.exercise_id, p_weight, p_unit, p_reps);
  if v_side is distinct from v_row.side then perform public._check_side(v_row.exercise_id, v_side); end if;
  if exists (select 1 from public.lifts where training_set_id = p_set_id and deleted_at is null)
     and (v_vals.weight_kg is distinct from v_row.weight_kg or p_reps <> v_row.reps or v_date <> v_row.local_date
          or v_side is distinct from v_row.side) then
    raise exception 'training_set_submitted';
  end if;
  if (v_date <> v_row.local_date or v_side is distinct from v_row.side) and exists (
    select 1 from public.training_sets
    where user_id = v_uid and exercise_id = v_row.exercise_id and local_date = v_date and set_number = v_row.set_number
      and side is not distinct from v_side and id <> p_set_id
  ) then
    raise exception 'set_slot_taken';
  end if;
  update public.training_sets set
    entered_weight = p_weight,
    entered_unit = case when p_weight is null then null else p_unit end,
    weight_kg = v_vals.weight_kg,
    reps = p_reps,
    score = v_vals.score,
    is_ranked = v_vals.is_ranked,
    local_date = v_date,
    side = v_side,
    performed_at = coalesce(p_performed_at, v_row.performed_at),
    updated_at = now()
  where id = p_set_id;
end;
$$;

-- Same as 0015, plus: one-side sets can't go on the boards (no approved unilateral scoring yet).
create or replace function public.submit_training_set(p_set_id uuid, p_visibility public.lift_visibility, p_group_ids uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_set public.training_sets%rowtype;
  v_res jsonb;
  v_lift uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_set from public.training_sets where id = p_set_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_set.side is not null then raise exception 'unilateral_not_on_boards'; end if;
  if exists (select 1 from public.lifts where training_set_id = p_set_id and deleted_at is null) then
    raise exception 'already_submitted';
  end if;
  v_res := public.submit_lift(
    v_set.exercise_id, v_set.entered_weight, v_set.entered_unit, v_set.reps, v_set.performed_at,
    p_visibility, coalesce(p_group_ids, '{}'), null, gen_random_uuid(),
    v_set.machine_manufacturer_id, v_set.machine_model_id
  );
  v_lift := (v_res ->> 'lift_id')::uuid;
  if exists (select 1 from public.lifts where id = v_lift and training_set_id is not null and training_set_id <> p_set_id) then
    raise exception 'already_submitted';
  end if;
  update public.lifts set training_set_id = p_set_id where id = v_lift;
  update public.training_sets set pr_dismissed = true where id = p_set_id;
  return v_res;
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
  public.get_record_history(text, uuid, uuid),
  public.get_champion_card(text),
  public.set_avatar(text),
  public.verify_proof(uuid, text),
  public.edit_lift(uuid, uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid, uuid),
  public.create_friend_invite(),
  public.get_friend_invite_preview(text),
  public.accept_friend_invite(text),
  public.get_proofs_to_check(),
  public.my_avatar_paths(),
  public.submit_report(text, uuid, text, text),
  public.mod_reports(),
  public.mod_resolve_reports(text, uuid, text),
  public._avatar_can_upload(text),
  public._avatar_can_manage(text),
  -- Storage evaluates its policies as the signed-in user, so these must be callable.
  -- They only answer yes/no about the caller's own access to one path.
  public._proof_can_upload(text),
  public._proof_can_read(text),
  public._proof_can_delete(text),
  public.import_training_split(text, text, text, jsonb),
  public.set_active_training_split(uuid),
  public.save_training_day(uuid, text, jsonb),
  public.add_training_day(uuid, text),
  public.delete_training_day(uuid),
  public.log_training_set(uuid, uuid, integer, numeric, public.weight_unit, integer, date, timestamptz, uuid, text),
  public.update_training_set(uuid, numeric, public.weight_unit, integer, date, timestamptz, text),
  public.set_unilateral_preference(uuid, boolean),
  public.delete_training_set(uuid),
  public.dismiss_training_pr(uuid),
  public.submit_training_set(uuid, public.lift_visibility, uuid[])
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;

grant execute on function public.get_invite_preview(text), public.get_friend_invite_preview(text) to anon;
