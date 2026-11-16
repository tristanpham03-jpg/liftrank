-- LiftRank 0018 — Training sessions (Start / End), optional RIR, exercise
-- notes, training tips, and five SBL exercises.
--
-- 1. training_sessions: one active session per user. While active, its draft
--    (everything typed so far) is stored here as JSON and saved continuously by
--    the app, so closing the browser loses nothing. End saves every completed set
--    in one transaction (finish_training_session): all or nothing, idempotent per
--    finish key, so a double tap or a retry can't duplicate a workout. Discard
--    throws the draft away. Owner-only; never visible to anyone else, never on
--    boards. Opening or starting a day doesn't advance the rotation: only a
--    completed session's sets do (as before).
-- 2. training_sets.session_id (null for every existing set, which stays valid)
--    and training_sets.rir (Reps in Reserve, 0-10; null = not recorded, never
--    assumed 0). Slot uniqueness: unchanged for standalone sets; within a session
--    one row per exercise / side / set number.
-- 3. exercise_preferences.note: a private routine note per exercise that
--    persists between sessions. Session-only notes live on the session.
-- 4. user_settings.training_tips + training_tip_dismissals: tips can be turned
--    off or dismissed one by one.
-- 5. Five exercises (Keenan Flaps, Recline Curl, Kelso Shrug, Bicep Supination,
--    Face Pull) with aliases. Bicep Supinations are training-only (ranking
--    'none'): an estimated 1RM of an off-center rotation isn't a fair number.
--
-- Additive for data: no existing row changes (new columns are null/default).
-- update_training_set gains an optional RIR (old calls behave as before).
-- Leaderboards, lifts and scoring are untouched.

-- ───────────── Exercises ─────────────
insert into public.exercises
  (name, slug, category, muscle_group, equipment_type, ranking_method, weight_convention,
   supports_machine_selection, max_weight_kg, flag_threshold_kg, popular_rank, primary_muscles, secondary_muscles)
values
  ('Keenan Flaps', 'keenan-flaps', 'back', 'Lats', 'cable', 'e1rm', 'stack', true, 150, 70, 64,
    array['Lats (latissimus dorsi)'], array['Teres major', 'Rear shoulders (posterior deltoids)']),
  ('Recline Curl', 'recline-curl', 'arms', 'Biceps', 'cable', 'e1rm', 'stack', true, 150, 70, 65,
    array['Biceps'], array['Forearms (brachialis, brachioradialis)']),
  ('Kelso Shrug', 'kelso-shrug', 'back', 'Upper back', 'dumbbell', 'e1rm', 'per_dumbbell', false, 120, 60, 66,
    array['Middle traps', 'Rhomboids'], array['Rear shoulders (posterior deltoids)']),
  ('Bicep Supination', 'bicep-supination', 'arms', 'Biceps', 'dumbbell', 'none', 'per_dumbbell', false, 40, 20, 67,
    array['Biceps (supination)', 'Supinator'], array['Forearms (brachioradialis)']),
  ('Face Pull', 'face-pull', 'shoulders', 'Rear delts', 'cable', 'e1rm', 'stack', true, 150, 70, 68,
    array['Rear shoulders (posterior deltoids)', 'Upper back (rhomboids, middle traps)'], array['Rotator cuff (external rotators)', 'Traps']);

update public.exercises set supports_unilateral = true where slug in ('keenan-flaps', 'recline-curl', 'bicep-supination');

insert into public.exercise_aliases (exercise_id, alias)
select e.id, a.alias
from (values
  ('keenan-flaps', 'keenan'), ('keenan-flaps', 'keenan flap'), ('keenan-flaps', 'cuffed pulldown'),
  ('keenan-flaps', 'cuffed lat pulldown'), ('keenan-flaps', 'single arm cuffed pulldown'),
  ('recline-curl', 'recline curls'), ('recline-curl', 'reclined curl'), ('recline-curl', 'reclined cable curl'),
  ('recline-curl', 'lying cable curl'),
  ('kelso-shrug', 'kelso'), ('kelso-shrug', 'kelso shrugs'), ('kelso-shrug', 'chest supported shrug'),
  ('kelso-shrug', 'scap retraction'), ('kelso-shrug', 'scapular retraction'),
  ('bicep-supination', 'supinations'), ('bicep-supination', 'supination'), ('bicep-supination', 'biceps supination'),
  ('bicep-supination', 'dumbbell supination'), ('bicep-supination', 'db supination'),
  ('face-pull', 'face pulls'), ('face-pull', 'facepull'), ('face-pull', 'facepulls'), ('face-pull', 'rope face pull')
) as a(slug, alias)
join public.exercises e on e.slug = a.slug;

-- ───────────── Sessions ─────────────
create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  split_id uuid references public.training_splits (id) on delete set null,
  day_id uuid references public.training_days (id) on delete set null,
  day_name text not null check (char_length(day_name) between 1 and 30),
  status text not null default 'active' check (status in ('active', 'completed', 'discarded')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  local_date date not null,
  -- The in-progress draft (app-defined JSON) and its version for safe autosave.
  draft jsonb not null default '{}'::jsonb check (pg_column_size(draft) < 262144),
  draft_version integer not null default 0,
  finish_key uuid,
  result jsonb,
  notes text check (notes is null or char_length(notes) <= 1000),
  exercise_notes jsonb not null default '{}'::jsonb check (pg_column_size(exercise_notes) < 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index training_sessions_one_active on public.training_sessions (user_id) where status = 'active';
create index training_sessions_user_idx on public.training_sessions (user_id, started_at desc);

alter table public.training_sets add column session_id uuid references public.training_sessions (id) on delete set null;
alter table public.training_sets add column rir smallint check (rir is null or rir between 0 and 10);
drop index public.training_sets_slot_uidx;
create unique index training_sets_slot_uidx on public.training_sets (user_id, exercise_id, local_date, set_number, side)
  nulls not distinct where session_id is null;
create unique index training_sets_session_slot_uidx on public.training_sets (session_id, exercise_id, set_number, side)
  nulls not distinct where session_id is not null;
create index training_sets_session_idx on public.training_sets (session_id) where session_id is not null;

alter table public.exercise_preferences add column note text check (note is null or char_length(note) <= 500);

alter table public.user_settings add column training_tips boolean not null default true;
grant update (training_tips) on public.user_settings to authenticated;

create table public.training_tip_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tip_key text not null check (char_length(tip_key) between 1 and 120),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, tip_key)
);

alter table public.training_sessions enable row level security;
alter table public.training_tip_dismissals enable row level security;
revoke all on public.training_sessions, public.training_tip_dismissals from anon, authenticated;
grant select on public.training_sessions, public.training_tip_dismissals to authenticated;
grant all on public.training_sessions, public.training_tip_dismissals to service_role;
create policy training_sessions_own on public.training_sessions for select to authenticated using (user_id = auth.uid());
create policy training_tip_dismissals_own on public.training_tip_dismissals for select to authenticated using (user_id = auth.uid());

-- Start a session for one of your training days. If you already have an active
-- session (any day), that one is returned instead: one at a time.
create function public.start_training_session(p_day_id uuid, p_local_date date, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day public.training_days%rowtype;
  v_active public.training_sessions%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext('session:' || v_uid));
  select * into v_active from public.training_sessions where user_id = v_uid and status = 'active';
  if found then
    return jsonb_build_object('session_id', v_active.id, 'resumed', true, 'day_id', v_active.day_id);
  end if;
  select * into v_day from public.training_days where id = p_day_id and user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if p_local_date is null or p_local_date > (now() + interval '1 day')::date or p_local_date < (now() - interval '2 days')::date then
    raise exception 'invalid_date';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' or pg_column_size(p_draft) >= 262144 then raise exception 'invalid_request'; end if;
  if (select count(*) from public.training_sessions where user_id = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too_many_sessions';
  end if;
  insert into public.training_sessions (user_id, split_id, day_id, day_name, local_date, draft, draft_version)
  values (v_uid, v_day.split_id, v_day.id, v_day.name, p_local_date, p_draft, 1)
  returning id into v_id;
  return jsonb_build_object('session_id', v_id, 'resumed', false, 'day_id', v_day.id);
end;
$$;

-- Autosave of the active session's draft. p_base_version must match the stored
-- version (otherwise another device saved first: 'draft_conflict').
create function public.save_training_draft(p_session_id uuid, p_draft jsonb, p_base_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.training_sessions%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_s from public.training_sessions where id = p_session_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.status <> 'active' then raise exception 'session_not_active'; end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' or pg_column_size(p_draft) >= 262144 then raise exception 'invalid_request'; end if;
  if p_base_version is distinct from v_s.draft_version then raise exception 'draft_conflict'; end if;
  update public.training_sessions set draft = p_draft, draft_version = draft_version + 1, updated_at = now()
  where id = p_session_id;
  return v_s.draft_version + 1;
end;
$$;

-- End: saves every completed set of the session in one transaction (all or
-- nothing) and closes it. Retrying with the same finish key returns the same
-- result; nothing is saved twice. Sets stay private: no board, feed or
-- notification. Returns the sets that beat your earlier best (both-sides,
-- ranked) so the app can *suggest* a submission.
-- p_sets: [{exercise_id, side (null|left|right), weight (null for bodyweight), unit, reps, rir (null|0-10)}] in order.
create function public.finish_training_session(p_session_id uuid, p_finish_key uuid, p_local_date date, p_sets jsonb,
  p_notes text, p_exercise_notes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.training_sessions%rowtype;
  v_item jsonb;
  v_vals record;
  v_ex uuid;
  v_side text;
  v_weight numeric;
  v_unit public.weight_unit;
  v_reps integer;
  v_rir smallint;
  v_num integer;
  v_counts jsonb := '{}'::jsonb;
  v_slot text;
  v_set_id uuid;
  v_ended timestamptz := now();
  v_bests jsonb := '{}'::jsonb;  -- exercise_id -> {best, prior}, taken before this session's sets are inserted
  v_b jsonb;
  v_rec record;
  v_prs jsonb := '[]'::jsonb;
  v_result jsonb;
  v_n integer := 0;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_finish_key is null then raise exception 'invalid_request'; end if;
  select * into v_s from public.training_sessions where id = p_session_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.status = 'completed' then
    if v_s.finish_key = p_finish_key then return v_s.result || jsonb_build_object('already', true); end if;
    raise exception 'session_already_ended';
  end if;
  if v_s.status <> 'active' then raise exception 'session_not_active'; end if;
  perform public._check_training_date(p_local_date, v_ended);
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) > 300 then raise exception 'invalid_request'; end if;
  if v_notes is not null and char_length(v_notes) > 1000 then raise exception 'notes_too_long'; end if;
  if p_exercise_notes is not null and (jsonb_typeof(p_exercise_notes) <> 'object' or pg_column_size(p_exercise_notes) >= 65536) then
    raise exception 'invalid_request';
  end if;

  for v_item in select * from jsonb_array_elements(p_sets) loop
    v_ex := (v_item ->> 'exercise_id')::uuid;
    v_side := nullif(v_item ->> 'side', '');
    v_weight := (v_item ->> 'weight')::numeric;
    v_unit := nullif(v_item ->> 'unit', '')::public.weight_unit;
    v_reps := (v_item ->> 'reps')::integer;
    v_rir := (v_item ->> 'rir')::smallint;
    if v_rir is not null and (v_rir < 0 or v_rir > 10) then raise exception 'invalid_rir'; end if;
    select * into v_vals from public._training_values(v_ex, v_weight, v_unit, v_reps);
    perform public._check_side(v_ex, v_side);
    if not v_bests ? v_ex::text then
      v_bests := v_bests || jsonb_build_object(v_ex::text, jsonb_build_object(
        'best', public._personal_best(v_uid, v_ex, null),
        'prior', exists (select 1 from public.training_sets where user_id = v_uid and exercise_id = v_ex and is_ranked and side is null and local_date < p_local_date)
              or exists (select 1 from public.lifts where user_id = v_uid and exercise_id = v_ex and is_ranked and deleted_at is null and invalidated_at is null)));
    end if;
    -- Set numbers count per exercise and side, in the order given.
    v_slot := v_ex::text || ':' || coalesce(v_side, '');
    v_num := coalesce((v_counts ->> v_slot)::integer, 0) + 1;
    if v_num > 30 then raise exception 'invalid_set_number'; end if;
    v_counts := v_counts || jsonb_build_object(v_slot, v_num);
    insert into public.training_sets (user_id, exercise_id, day_id, session_id, set_number, side, entered_weight, entered_unit,
      weight_kg, reps, rir, score, is_ranked, local_date, performed_at, client_key)
    values (v_uid, v_ex, v_s.day_id, v_s.id, v_num, v_side, v_weight, case when v_weight is null then null else v_unit end,
      v_vals.weight_kg, v_reps, v_rir, v_vals.score, v_vals.is_ranked, p_local_date, v_ended, gen_random_uuid());
    v_n := v_n + 1;
  end loop;

  -- One PR suggestion per exercise: this session's best both-sides set, if it beats every earlier one.
  for v_rec in
    select distinct on (t.exercise_id) t.id, t.exercise_id, t.score
    from public.training_sets t
    where t.session_id = v_s.id and t.side is null and t.is_ranked
    order by t.exercise_id, t.score desc, t.set_number
  loop
    v_b := v_bests -> v_rec.exercise_id::text;
    if (v_b ->> 'prior')::boolean and v_b ->> 'best' is not null and v_rec.score > (v_b ->> 'best')::numeric then
      v_prs := v_prs || jsonb_build_object('set_id', v_rec.id, 'exercise_id', v_rec.exercise_id);
    end if;
  end loop;

  v_result := jsonb_build_object('session_id', v_s.id, 'sets', v_n, 'prs', v_prs);
  update public.training_sessions set
    status = 'completed', ended_at = v_ended, local_date = p_local_date, finish_key = p_finish_key,
    result = v_result, notes = v_notes, exercise_notes = coalesce(p_exercise_notes, '{}'::jsonb),
    draft = '{}'::jsonb, updated_at = now()
  where id = v_s.id;
  return v_result || jsonb_build_object('already', false);
end;
$$;

-- Throw away the active session's draft. Nothing was saved, so nothing else changes.
create function public.discard_training_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.training_sessions set status = 'discarded', ended_at = now(), draft = '{}'::jsonb, updated_at = now()
  where id = p_session_id and user_id = v_uid and status = 'active';
  if not found then raise exception 'session_not_active'; end if;
end;
$$;

-- A private note on an exercise, kept for future sessions (null/blank clears it).
create function public.set_exercise_note(p_exercise_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.exercises where id = p_exercise_id and is_active) then raise exception 'invalid_exercise'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'notes_too_long'; end if;
  insert into public.exercise_preferences (user_id, exercise_id, note) values (v_uid, p_exercise_id, v_note)
  on conflict (user_id, exercise_id) do update set note = excluded.note, updated_at = now();
end;
$$;

create function public.dismiss_training_tip(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_key is null or char_length(p_key) not between 1 and 120 then raise exception 'invalid_request'; end if;
  insert into public.training_tip_dismissals (user_id, tip_key) values (v_uid, p_key) on conflict do nothing;
end;
$$;

drop function public.update_training_set(uuid, numeric, public.weight_unit, integer, date, timestamptz, text);

-- Corrects a saved set (numbers, date, side, RIR). Not a new performance.
-- p_side 'keep' (default) / 'left' / 'right' / 'none'; p_rir -1 (default) keeps
-- it, null clears it, 0-10 sets it. Board-linked sets keep their numbers.
create function public.update_training_set(p_set_id uuid, p_weight numeric, p_unit public.weight_unit, p_reps integer,
  p_local_date date, p_performed_at timestamptz, p_side text default 'keep', p_rir smallint default -1)
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
  v_rir smallint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.training_sets where id = p_set_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  v_date := coalesce(p_local_date, v_row.local_date);
  v_side := case coalesce(p_side, 'keep') when 'keep' then v_row.side when 'none' then null else p_side end;
  v_rir := case when p_rir = -1 then v_row.rir else p_rir end;
  if v_rir is not null and (v_rir < 0 or v_rir > 10) then raise exception 'invalid_rir'; end if;
  perform public._check_training_date(v_date, coalesce(p_performed_at, v_row.performed_at));
  select * into v_vals from public._training_values(v_row.exercise_id, p_weight, p_unit, p_reps);
  if v_side is distinct from v_row.side then perform public._check_side(v_row.exercise_id, v_side); end if;
  if exists (select 1 from public.lifts where training_set_id = p_set_id and deleted_at is null)
     and (v_vals.weight_kg is distinct from v_row.weight_kg or p_reps <> v_row.reps or v_date <> v_row.local_date
          or v_side is distinct from v_row.side) then
    raise exception 'training_set_submitted';
  end if;
  -- Slot rules: standalone sets by date; session sets within their session.
  if (v_date <> v_row.local_date or v_side is distinct from v_row.side) and exists (
    select 1 from public.training_sets
    where user_id = v_uid and exercise_id = v_row.exercise_id and set_number = v_row.set_number
      and side is not distinct from v_side and id <> p_set_id
      and session_id is not distinct from v_row.session_id
      and (v_row.session_id is not null or local_date = v_date)
  ) then
    raise exception 'set_slot_taken';
  end if;
  update public.training_sets set
    entered_weight = p_weight,
    entered_unit = case when p_weight is null then null else p_unit end,
    weight_kg = v_vals.weight_kg,
    reps = p_reps,
    rir = v_rir,
    score = v_vals.score,
    is_ranked = v_vals.is_ranked,
    local_date = v_date,
    side = v_side,
    performed_at = coalesce(p_performed_at, v_row.performed_at),
    updated_at = now()
  where id = p_set_id;
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
  public.update_training_set(uuid, numeric, public.weight_unit, integer, date, timestamptz, text, smallint),
  public.start_training_session(uuid, date, jsonb),
  public.save_training_draft(uuid, jsonb, integer),
  public.finish_training_session(uuid, uuid, date, jsonb, text, jsonb),
  public.discard_training_session(uuid),
  public.set_exercise_note(uuid, text),
  public.dismiss_training_tip(text),
  public.set_unilateral_preference(uuid, boolean),
  public.delete_training_set(uuid),
  public.dismiss_training_pr(uuid),
  public.submit_training_set(uuid, public.lift_visibility, uuid[])
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;

grant execute on function public.get_invite_preview(text), public.get_friend_invite_preview(text) to anon;
