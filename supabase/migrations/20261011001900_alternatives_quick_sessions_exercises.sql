-- SBLift 0019 — alternative exercise slots, quick sessions, 19 more exercises (68 → 87).
--
-- 1. training_day_exercises.alt_group: rows of one day that share an alt_group
--    are one slot ("do one of these"). Null = an ordinary exercise. Existing
--    rows keep null, so every saved routine reads exactly as before.
--    _write_day_exercises accepts an optional alt_group per item (and up to 30
--    items, the existing position limit, so alternatives fit).
-- 2. start_training_session accepts a null day: a quick session ("Workout")
--    from My Exercises. It never touches any routine.
-- 3. Catalog: 19 new exercises with aliases; "Preacher Curl" is renamed
--    "Barbell Preacher Curl" (same row, slug, boards and lifts; old name kept
--    as an alias). No other exercise, lift, score or ranking changes.
--
-- No table, row or permission is removed. Function grants are restated in full
-- (unchanged list: no new functions).

-- ───────────── 1. Alternative slots ─────────────
alter table public.training_day_exercises
  add column alt_group smallint check (alt_group is null or alt_group between 0 and 30);

-- p_exercises: [{exercise_id, set_count, alt_group?}] in order. Items sharing an
-- alt_group form one slot; a slot needs 2+ different exercises.
create or replace function public._write_day_exercises(p_uid uuid, p_day_id uuid, p_exercises jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_pos integer := 0;
  v_ex uuid;
  v_sets integer;
  v_group smallint;
begin
  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' then raise exception 'invalid_routine'; end if;
  if jsonb_array_length(p_exercises) > 30 then raise exception 'too_many_exercises'; end if;
  delete from public.training_day_exercises where day_id = p_day_id and user_id = p_uid;
  for v_item in select * from jsonb_array_elements(p_exercises) loop
    v_ex := (v_item ->> 'exercise_id')::uuid;
    v_sets := coalesce((v_item ->> 'set_count')::integer, 2);
    v_group := nullif(v_item ->> 'alt_group', '')::smallint;
    if not exists (select 1 from public.exercises where id = v_ex and is_active) then raise exception 'invalid_exercise'; end if;
    if v_sets < 1 or v_sets > 10 then raise exception 'invalid_set_count'; end if;
    if v_group is not null and (v_group < 0 or v_group > 30) then raise exception 'invalid_routine'; end if;
    insert into public.training_day_exercises (user_id, day_id, exercise_id, position, set_count, alt_group)
    values (p_uid, p_day_id, v_ex, v_pos, v_sets, v_group);
    v_pos := v_pos + 1;
  end loop;
  -- A slot is 2+ different exercises; a group of one is just an exercise.
  update public.training_day_exercises d set alt_group = null
  where d.day_id = p_day_id and d.user_id = p_uid and d.alt_group is not null
    and (select count(distinct x.exercise_id) from public.training_day_exercises x
         where x.day_id = p_day_id and x.alt_group = d.alt_group) < 2;
end;
$$;

-- ───────────── 2. Quick sessions ─────────────
create or replace function public.start_training_session(p_day_id uuid, p_local_date date, p_draft jsonb)
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
  if p_day_id is not null then
    select * into v_day from public.training_days where id = p_day_id and user_id = v_uid;
    if not found then raise exception 'not_found'; end if;
  end if;
  if p_local_date is null or p_local_date > (now() + interval '1 day')::date or p_local_date < (now() - interval '2 days')::date then
    raise exception 'invalid_date';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' or pg_column_size(p_draft) >= 262144 then raise exception 'invalid_request'; end if;
  if (select count(*) from public.training_sessions where user_id = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too_many_sessions';
  end if;
  insert into public.training_sessions (user_id, split_id, day_id, day_name, local_date, draft, draft_version)
  values (v_uid, v_day.split_id, v_day.id, coalesce(v_day.name, 'Workout'), p_local_date, p_draft, 1)
  returning id into v_id;
  return jsonb_build_object('session_id', v_id, 'resumed', false, 'day_id', v_day.id);
end;
$$;

-- ───────────── 3. Exercises ─────────────
-- Owner-confirmed mechanics: Cable Triceps Extension keeps the elbow fixed and
-- extends downward (unlike a pushdown or overhead extension); close-grip lat
-- rows come as a cable and a machine version; the chest-supported grip
-- variants are plate-loaded machines (like Chest-Supported Row); Back Extension
-- is bodyweight by reps and Weighted Back Extension records the held plate or
-- barbell (like Pull-Up / Weighted Pull-Up); preacher curls come as barbell,
-- dumbbell and machine.
update public.exercises set name = 'Barbell Preacher Curl' where slug = 'preacher-curl' and name = 'Preacher Curl';

insert into public.exercises
  (name, slug, category, muscle_group, equipment_type, ranking_method, weight_convention,
   supports_machine_selection, max_weight_kg, flag_threshold_kg, popular_rank, primary_muscles, secondary_muscles)
values
  ('Reverse Cable Curl', 'reverse-cable-curl', 'arms', 'Forearms & biceps', 'cable', 'e1rm', 'stack', true, 150, 70, 69,
    array['Forearms (brachioradialis)', 'Brachialis'], array['Biceps']),
  ('Machine Lateral Raise', 'machine-lateral-raise', 'shoulders', 'Side delts', 'selectorized', 'e1rm', 'stack', true, 150, 80, 70,
    array['Side shoulders (lateral deltoids)'], array['Traps']),
  ('Dumbbell Front Raise', 'dumbbell-front-raise', 'shoulders', 'Front delts', 'dumbbell', 'e1rm', 'per_dumbbell', false, 40, 25, 71,
    array['Front shoulders (anterior deltoids)'], array['Side shoulders (lateral deltoids)', 'Upper chest']),
  ('Behind-the-Back Cable Lateral Raise', 'behind-the-back-cable-lateral-raise', 'shoulders', 'Side delts', 'cable', 'e1rm', 'stack', true, 80, 40, 72,
    array['Side shoulders (lateral deltoids)'], array['Rear shoulders (posterior deltoids)', 'Traps']),
  ('Smith Machine Decline Press', 'smith-decline-press', 'chest', 'Lower chest', 'smith_machine', 'e1rm', 'total', true, 300, 170, 73,
    array['Chest (lower pectoralis major)'], array['Triceps', 'Front shoulders (anterior deltoids)']),
  ('Low-to-High Cable Fly', 'low-to-high-cable-fly', 'chest', 'Upper chest', 'cable', 'e1rm', 'stack', true, 150, 70, 74,
    array['Upper chest (clavicular pectoralis)'], array['Front shoulders (anterior deltoids)']),
  ('High-to-Low Cable Fly', 'high-to-low-cable-fly', 'chest', 'Lower chest', 'cable', 'e1rm', 'stack', true, 150, 70, 75,
    array['Chest (lower pectoralis major)'], array['Front shoulders (anterior deltoids)']),
  ('Chest-Supported Wide-Grip Row', 'chest-supported-wide-grip-row', 'back', 'Upper back', 'plate_loaded', 'e1rm', 'plates_total', true, 350, 200, 76,
    array['Upper back (rhomboids, middle traps)', 'Rear shoulders (posterior deltoids)'], array['Lats (latissimus dorsi)', 'Biceps']),
  ('Chest-Supported Close-Grip Row', 'chest-supported-close-grip-row', 'back', 'Back', 'plate_loaded', 'e1rm', 'plates_total', true, 350, 200, 77,
    array['Lats (latissimus dorsi)', 'Upper back (rhomboids, middle traps)'], array['Biceps', 'Rear shoulders (posterior deltoids)']),
  ('Cable Close-Grip Lat Row', 'close-grip-lat-row', 'back', 'Lats', 'cable', 'e1rm', 'stack', true, 300, 170, 78,
    array['Lats (latissimus dorsi)'], array['Upper back (rhomboids, middle traps)', 'Biceps']),
  ('Back Extension', 'back-extension', 'back', 'Lower back & glutes', 'bodyweight', 'max_reps', 'bodyweight', false, null, null, 79,
    array['Lower back (spinal erectors)', 'Glutes'], array['Hamstrings']),
  ('Smith Machine Romanian Deadlift', 'smith-romanian-deadlift', 'back', 'Hamstrings', 'smith_machine', 'e1rm', 'total', true, 400, 220, 80,
    array['Hamstrings', 'Glutes'], array['Lower back (spinal erectors)', 'Forearms (grip)']),
  ('Smith Machine Shoulder Press', 'smith-shoulder-press', 'shoulders', 'Shoulders', 'smith_machine', 'e1rm', 'total', true, 200, 110, 81,
    array['Front shoulders (anterior deltoids)', 'Side shoulders (lateral deltoids)'], array['Triceps']),
  ('Smith Machine Hip Thrust', 'smith-hip-thrust', 'legs', 'Glutes', 'smith_machine', 'e1rm', 'total', true, 450, 250, 82,
    array['Glutes'], array['Hamstrings', 'Quads']),
  ('Smith Machine Split Squat', 'smith-split-squat', 'legs', 'Quads & glutes', 'smith_machine', 'e1rm', 'total', true, 300, 160, 83,
    array['Quads', 'Glutes'], array['Hamstrings', 'Inner thighs (adductors)']),
  ('Cable Triceps Extension', 'cable-triceps-extension', 'arms', 'Triceps', 'cable', 'e1rm', 'stack', true, 150, 70, 84,
    array['Triceps'], array[]::text[]),
  ('Machine Close-Grip Lat Row', 'machine-close-grip-lat-row', 'back', 'Lats', 'plate_loaded', 'e1rm', 'plates_total', true, 350, 200, 85,
    array['Lats (latissimus dorsi)'], array['Upper back (rhomboids, middle traps)', 'Biceps']),
  ('Weighted Back Extension', 'weighted-back-extension', 'back', 'Lower back & glutes', 'bodyweight', 'added_load_e1rm', 'added', false, 150, 80, 86,
    array['Lower back (spinal erectors)', 'Glutes'], array['Hamstrings']),
  ('Dumbbell Preacher Curl', 'dumbbell-preacher-curl', 'arms', 'Biceps', 'dumbbell', 'e1rm', 'per_dumbbell', false, 60, 35, 87,
    array['Biceps'], array['Forearms']);

update public.exercises set supports_unilateral = true where slug in (
  'reverse-cable-curl', 'machine-lateral-raise', 'dumbbell-front-raise', 'behind-the-back-cable-lateral-raise',
  'low-to-high-cable-fly', 'high-to-low-cable-fly', 'chest-supported-wide-grip-row', 'chest-supported-close-grip-row',
  'close-grip-lat-row', 'smith-split-squat', 'cable-triceps-extension', 'machine-close-grip-lat-row', 'dumbbell-preacher-curl');

insert into public.exercise_aliases (exercise_id, alias)
select e.id, a.alias
from (values
  ('preacher-curl', 'barbell preacher curl'), ('preacher-curl', 'bb preacher curl'), ('preacher-curl', 'ez bar preacher curl'),
  ('reverse-cable-curl', 'reverse curl'), ('reverse-cable-curl', 'cable reverse curl'), ('reverse-cable-curl', 'reverse grip cable curl'),
  ('machine-lateral-raise', 'lateral raise machine'), ('machine-lateral-raise', 'machine side raise'), ('machine-lateral-raise', 'machine laterals'),
  ('dumbbell-front-raise', 'front raise'), ('dumbbell-front-raise', 'db front raise'), ('dumbbell-front-raise', 'front raises'),
  ('behind-the-back-cable-lateral-raise', 'behind the back lateral raise'), ('behind-the-back-cable-lateral-raise', 'btb lateral raise'),
  ('behind-the-back-cable-lateral-raise', 'behind the back cable raise'),
  ('smith-decline-press', 'smith decline'), ('smith-decline-press', 'decline smith press'), ('smith-decline-press', 'smith decline bench'),
  ('low-to-high-cable-fly', 'low to high fly'), ('low-to-high-cable-fly', 'low cable fly'), ('low-to-high-cable-fly', 'incline cable fly'),
  ('high-to-low-cable-fly', 'high to low fly'), ('high-to-low-cable-fly', 'high cable fly'), ('high-to-low-cable-fly', 'decline cable fly'),
  ('chest-supported-wide-grip-row', 'wide grip chest supported row'), ('chest-supported-wide-grip-row', 'wide chest supported row'),
  ('chest-supported-wide-grip-row', 'wide grip row'),
  ('chest-supported-close-grip-row', 'close grip chest supported row'), ('chest-supported-close-grip-row', 'close chest supported row'),
  ('chest-supported-close-grip-row', 'neutral grip chest supported row'),
  ('close-grip-lat-row', 'lat row'), ('close-grip-lat-row', 'close grip lat row'), ('close-grip-lat-row', 'cable lat row'),
  ('machine-close-grip-lat-row', 'machine lat row'), ('machine-close-grip-lat-row', 'close grip machine row'),
  ('machine-close-grip-lat-row', 'machine close grip row'),
  ('cable-triceps-extension', 'tricep extension'), ('cable-triceps-extension', 'triceps extension'),
  ('cable-triceps-extension', 'standard cable triceps extension'), ('cable-triceps-extension', 'cable tricep extension'),
  ('weighted-back-extension', 'weighted hyperextension'), ('weighted-back-extension', 'back extension with plate'),
  ('weighted-back-extension', 'barbell back extension'),
  ('dumbbell-preacher-curl', 'db preacher curl'), ('dumbbell-preacher-curl', 'single arm preacher curl'),
  ('dumbbell-preacher-curl', 'one arm preacher curl'),
  ('back-extension', 'back extensions'), ('back-extension', 'hyperextension'), ('back-extension', 'hyperextensions'),
  ('back-extension', '45 degree back extension'),
  ('smith-romanian-deadlift', 'smith rdl'), ('smith-romanian-deadlift', 'smith machine rdl'),
  ('smith-shoulder-press', 'smith ohp'), ('smith-shoulder-press', 'smith overhead press'), ('smith-shoulder-press', 'smith machine ohp'),
  ('smith-hip-thrust', 'hip thrust'), ('smith-hip-thrust', 'smith glute bridge'), ('smith-hip-thrust', 'hip thrusts'),
  ('smith-split-squat', 'smith lunge'), ('smith-split-squat', 'smith machine lunge'), ('smith-split-squat', 'smith bulgarian split squat')
) as a(slug, alias)
join public.exercises e on e.slug = a.slug
on conflict do nothing;

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
