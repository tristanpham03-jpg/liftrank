-- LiftRank 0015 — Personal training tracker.
--
-- A private, spreadsheet-style training log kept apart from competition:
--
-- 1. training_splits / training_days / training_day_exercises: a user's
--    routines (imported from a template or custom). Rotation (1x, 2x, 3x,
--    infinite) only describes how the days repeat; it never copies exercises.
--    Changing or deleting routines never touches logged sets.
-- 2. training_sets: one row per confirmed working set (exercise, weight,
--    unit, reps, local date, set number, optional machine). Owner-only: no
--    one else can read them, and they never feed boards, the feed or
--    notifications. Personal bests come from these plus the user's own lifts.
-- 3. lifts.training_set_id: a competitive lift can point at the training set
--    it came from. A partial unique index allows one live board entry per set,
--    so double taps and races can't submit it twice.
--    Rule for linked sets: once a set is on a board its numbers can't be
--    edited here (edit the board entry instead); deleting the set leaves the
--    board entry as it is, just unlinked. A published result never changes
--    silently.
--
-- Additive: new tables, functions and one nullable column. No existing rows
-- change, and no existing function is replaced.

create table public.training_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  template text not null check (template in ('ul', 'ppl', 'ap', 'arnold', 'full_body', 'fbeod', 'custom')),
  rotation text not null check (rotation in ('1x', '2x', '3x', 'infinite')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index training_splits_one_active on public.training_splits (user_id) where is_active;
create index training_splits_user_idx on public.training_splits (user_id, created_at desc);

create table public.training_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  split_id uuid not null references public.training_splits (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  position integer not null check (position between 0 and 20),
  created_at timestamptz not null default now()
);
create index training_days_split_idx on public.training_days (split_id, position);

create table public.training_day_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  day_id uuid not null references public.training_days (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position integer not null check (position between 0 and 30),
  set_count integer not null check (set_count between 1 and 10)
);
create index training_day_exercises_day_idx on public.training_day_exercises (day_id, position);

create table public.training_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  -- The routine day it was logged from; kept null if the day is later removed.
  day_id uuid references public.training_days (id) on delete set null,
  set_number integer not null check (set_number between 1 and 30),
  entered_weight numeric check (entered_weight is null or entered_weight > 0),
  entered_unit public.weight_unit,
  weight_kg numeric check (weight_kg is null or weight_kg > 0),
  reps integer not null check (reps between 1 and 200),
  -- Same scoring as lifts (compute_score); is_ranked = counts for personal bests.
  score numeric,
  is_ranked boolean not null,
  -- The lifter's own calendar day (from their device), and the moment.
  local_date date not null,
  performed_at timestamptz not null,
  machine_manufacturer_id uuid references public.machine_manufacturers (id) on delete set null,
  machine_model_id uuid references public.machine_models (id) on delete set null,
  pr_dismissed boolean not null default false,
  client_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((entered_weight is null) = (weight_kg is null)),
  check ((entered_weight is null) = (entered_unit is null))
);
-- One row per set number per exercise per day, and per client key: no duplicates.
create unique index training_sets_slot_uidx on public.training_sets (user_id, exercise_id, local_date, set_number);
create unique index training_sets_client_key_uidx on public.training_sets (user_id, client_key);
create index training_sets_history_idx on public.training_sets (user_id, exercise_id, local_date desc);
create index training_sets_recent_idx on public.training_sets (user_id, created_at desc);

alter table public.lifts add column training_set_id uuid references public.training_sets (id) on delete set null;
create unique index lifts_training_set_uidx on public.lifts (training_set_id) where training_set_id is not null and deleted_at is null;

-- Owner-only reads; every write goes through the functions below.
alter table public.training_splits enable row level security;
alter table public.training_days enable row level security;
alter table public.training_day_exercises enable row level security;
alter table public.training_sets enable row level security;
revoke all on public.training_splits, public.training_days, public.training_day_exercises, public.training_sets from anon, authenticated;
grant select on public.training_splits, public.training_days, public.training_day_exercises, public.training_sets to authenticated;
grant all on public.training_splits, public.training_days, public.training_day_exercises, public.training_sets to service_role;
create policy training_splits_own on public.training_splits for select to authenticated using (user_id = auth.uid());
create policy training_days_own on public.training_days for select to authenticated using (user_id = auth.uid());
create policy training_day_exercises_own on public.training_day_exercises for select to authenticated using (user_id = auth.uid());
create policy training_sets_own on public.training_sets for select to authenticated using (user_id = auth.uid());

-- ───────────── Routines ─────────────

-- Replaces one day's exercise list. p_exercises: [{exercise_id, set_count}] in order.
create function public._write_day_exercises(p_uid uuid, p_day_id uuid, p_exercises jsonb)
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
begin
  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' then raise exception 'invalid_routine'; end if;
  if jsonb_array_length(p_exercises) > 20 then raise exception 'too_many_exercises'; end if;
  delete from public.training_day_exercises where day_id = p_day_id and user_id = p_uid;
  for v_item in select * from jsonb_array_elements(p_exercises) loop
    v_ex := (v_item ->> 'exercise_id')::uuid;
    v_sets := coalesce((v_item ->> 'set_count')::integer, 2);
    if not exists (select 1 from public.exercises where id = v_ex and is_active) then raise exception 'invalid_exercise'; end if;
    if v_sets < 1 or v_sets > 10 then raise exception 'invalid_set_count'; end if;
    insert into public.training_day_exercises (user_id, day_id, exercise_id, position, set_count)
    values (p_uid, p_day_id, v_ex, v_pos, v_sets);
    v_pos := v_pos + 1;
  end loop;
end;
$$;

-- Imports a template (or a custom split) and makes it the active one. Older
-- splits stay (inactive) and every logged set is kept.
-- p_days: [{name, exercises: [{exercise_id, set_count}]}]
create function public.import_training_split(p_name text, p_template text, p_rotation text, p_days jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_split uuid;
  v_day uuid;
  v_item jsonb;
  v_pos integer := 0;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then raise exception 'onboarding_required'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  if p_template not in ('ul', 'ppl', 'ap', 'arnold', 'full_body', 'fbeod', 'custom') then raise exception 'invalid_template'; end if;
  if p_rotation not in ('1x', '2x', '3x', 'infinite') then raise exception 'invalid_rotation'; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) not between 1 and 7 then raise exception 'invalid_routine'; end if;
  if (select count(*) from public.training_splits where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_splits';
  end if;

  perform pg_advisory_xact_lock(hashtext('training:' || v_uid));
  update public.training_splits set is_active = false where user_id = v_uid and is_active;
  insert into public.training_splits (user_id, name, template, rotation) values (v_uid, v_name, p_template, p_rotation)
  returning id into v_split;
  for v_item in select * from jsonb_array_elements(p_days) loop
    if char_length(btrim(coalesce(v_item ->> 'name', ''))) not between 1 and 30 then raise exception 'invalid_name'; end if;
    insert into public.training_days (user_id, split_id, name, position)
    values (v_uid, v_split, btrim(v_item ->> 'name'), v_pos) returning id into v_day;
    perform public._write_day_exercises(v_uid, v_day, coalesce(v_item -> 'exercises', '[]'::jsonb));
    v_pos := v_pos + 1;
  end loop;
  return v_split;
end;
$$;

-- Switch back to an older split you own.
create function public.set_active_training_split(p_split_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.training_splits where id = p_split_id and user_id = v_uid) then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('training:' || v_uid));
  update public.training_splits set is_active = false where user_id = v_uid and is_active and id <> p_split_id;
  update public.training_splits set is_active = true where id = p_split_id;
end;
$$;

-- Rename a day and replace its exercises (order, set counts) in one save.
create function public.save_training_day(p_day_id uuid, p_name text, p_exercises jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform 1 from public.training_days where id = p_day_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if char_length(v_name) not between 1 and 30 then raise exception 'invalid_name'; end if;
  update public.training_days set name = v_name where id = p_day_id;
  perform public._write_day_exercises(v_uid, p_day_id, p_exercises);
end;
$$;

create function public.add_training_day(p_split_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_pos integer;
  v_day uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform 1 from public.training_splits where id = p_split_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if char_length(v_name) not between 1 and 30 then raise exception 'invalid_name'; end if;
  select coalesce(max(position) + 1, 0) into v_pos from public.training_days where split_id = p_split_id;
  if v_pos > 6 then raise exception 'too_many_days'; end if;
  insert into public.training_days (user_id, split_id, name, position) values (v_uid, p_split_id, v_name, v_pos)
  returning id into v_day;
  return v_day;
end;
$$;

-- Removes a day from the routine. Sets logged from it stay in history.
create function public.delete_training_day(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_split uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select split_id into v_split from public.training_days where id = p_day_id and user_id = v_uid;
  if v_split is null then raise exception 'not_found'; end if;
  if (select count(*) from public.training_days where split_id = v_split) <= 1 then raise exception 'last_day'; end if;
  delete from public.training_days where id = p_day_id;
end;
$$;

-- ───────────── Sets ─────────────

-- Validates one set and returns weight_kg, score and is_ranked.
create function public._training_values(p_exercise_id uuid, p_weight numeric, p_unit public.weight_unit, p_reps integer,
  out weight_kg numeric, out score numeric, out is_ranked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ex public.exercises%rowtype;
begin
  select * into v_ex from public.exercises where id = p_exercise_id and is_active;
  if not found then raise exception 'invalid_exercise'; end if;
  if v_ex.ranking_method = 'max_reps' then
    if p_weight is not null then raise exception 'weight_not_allowed'; end if;
    if p_reps is null or p_reps < 1 or p_reps > 200 then raise exception 'invalid_reps'; end if;
  else
    if p_weight is null or p_weight <= 0 or p_weight <> round(p_weight, 2) then raise exception 'invalid_weight'; end if;
    if p_unit is null then raise exception 'invalid_unit'; end if;
    if p_reps is null or p_reps < 1 or p_reps > 50 then raise exception 'invalid_reps'; end if;
    weight_kg := case when p_unit = 'kg' then p_weight else p_weight * 0.45359237 end;
    if weight_kg > v_ex.max_weight_kg then raise exception 'weight_too_high'; end if;
  end if;
  select s.score, s.is_ranked into score, is_ranked from public.compute_score(v_ex.ranking_method, weight_kg, p_reps) s;
end;
$$;

create function public._check_training_date(p_local_date date, p_performed_at timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_local_date is null or p_performed_at is null then raise exception 'invalid_date'; end if;
  if p_performed_at > now() + interval '5 minutes' or p_local_date > (now() + interval '1 day')::date then raise exception 'future_date'; end if;
  if p_performed_at < now() - interval '5 years' then raise exception 'date_too_old'; end if;
end;
$$;

-- Best previous ranked score for an exercise: your training sets and your own counted lifts.
create function public._personal_best(p_uid uuid, p_exercise_id uuid, p_exclude uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select max(s) from (
    select score s from public.training_sets
    where user_id = p_uid and exercise_id = p_exercise_id and is_ranked and id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
    union all
    select score from public.lifts
    where user_id = p_uid and exercise_id = p_exercise_id and is_ranked and deleted_at is null and invalidated_at is null
  ) x
$$;

-- Saves one confirmed working set. Opening a day writes nothing; only this does.
-- The same set number (exercise + day) or the same client key returns the saved
-- row instead of creating a second one. Never touches boards, feed or notifications.
create function public.log_training_set(
  p_exercise_id uuid,
  p_day_id uuid,
  p_set_number integer,
  p_weight numeric,
  p_unit public.weight_unit,
  p_reps integer,
  p_local_date date,
  p_performed_at timestamptz,
  p_client_key uuid
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

  perform pg_advisory_xact_lock(hashtext('training-set:' || v_uid));
  select * into v_row from public.training_sets
  where user_id = v_uid and (client_key = p_client_key
    or (exercise_id = p_exercise_id and local_date = p_local_date and set_number = p_set_number));
  if found then
    return jsonb_build_object('id', v_row.id, 'duplicate', true, 'is_pr', false);
  end if;
  if (select count(*) from public.training_sets where user_id = v_uid and created_at > now() - interval '1 day') >= 400 then
    raise exception 'too_many_sets';
  end if;

  v_best := public._personal_best(v_uid, p_exercise_id, null);
  -- History from an earlier day (or a counted board lift) is needed, so the
  -- heavier second set of your very first session isn't called a PR.
  v_prior := exists (select 1 from public.training_sets where user_id = v_uid and exercise_id = p_exercise_id and is_ranked and local_date < p_local_date)
    or exists (select 1 from public.lifts where user_id = v_uid and exercise_id = p_exercise_id and is_ranked and deleted_at is null and invalidated_at is null);
  insert into public.training_sets (user_id, exercise_id, day_id, set_number, entered_weight, entered_unit, weight_kg,
    reps, score, is_ranked, local_date, performed_at, client_key)
  values (v_uid, p_exercise_id, p_day_id, p_set_number, p_weight, case when p_weight is null then null else p_unit end,
    v_vals.weight_kg, p_reps, v_vals.score, v_vals.is_ranked, p_local_date, p_performed_at, p_client_key)
  returning * into v_row;

  -- A personal best beats every earlier counted performance, given earlier history.
  return jsonb_build_object('id', v_row.id, 'duplicate', false,
    'is_pr', v_row.is_ranked and v_prior and v_best is not null and v_row.score > v_best);
end;
$$;

-- Corrects a saved set (numbers or date). Not a new performance. A set that is
-- on a board keeps its numbers: edit the board entry from its lift page instead.
create function public.update_training_set(p_set_id uuid, p_weight numeric, p_unit public.weight_unit, p_reps integer,
  p_local_date date, p_performed_at timestamptz)
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
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.training_sets where id = p_set_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  v_date := coalesce(p_local_date, v_row.local_date);
  perform public._check_training_date(v_date, coalesce(p_performed_at, v_row.performed_at));
  select * into v_vals from public._training_values(v_row.exercise_id, p_weight, p_unit, p_reps);
  if exists (select 1 from public.lifts where training_set_id = p_set_id and deleted_at is null)
     and (v_vals.weight_kg is distinct from v_row.weight_kg or p_reps <> v_row.reps or v_date <> v_row.local_date) then
    raise exception 'training_set_submitted';
  end if;
  if v_date <> v_row.local_date and exists (
    select 1 from public.training_sets
    where user_id = v_uid and exercise_id = v_row.exercise_id and local_date = v_date and set_number = v_row.set_number and id <> p_set_id
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
    performed_at = coalesce(p_performed_at, v_row.performed_at),
    updated_at = now()
  where id = p_set_id;
end;
$$;

-- Deletes a set from your history. A board entry made from it stays as it is (unlinked).
create function public.delete_training_set(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.training_sets where id = p_set_id and user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
end;
$$;

-- "Not now" on a personal-best suggestion: remembered, never asked again for this set.
create function public.dismiss_training_pr(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.training_sets set pr_dismissed = true where id = p_set_id and user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
end;
$$;

-- Puts a saved training set on the boards, with the same rules as any lift
-- (submit_lift), without typing it again. One live board entry per set.
create function public.submit_training_set(p_set_id uuid, p_visibility public.lift_visibility, p_group_ids uuid[] default '{}')
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
  if exists (select 1 from public.lifts where training_set_id = p_set_id and deleted_at is null) then
    raise exception 'already_submitted';
  end if;
  v_res := public.submit_lift(
    v_set.exercise_id, v_set.entered_weight, v_set.entered_unit, v_set.reps, v_set.performed_at,
    p_visibility, coalesce(p_group_ids, '{}'), null, gen_random_uuid(),
    v_set.machine_manufacturer_id, v_set.machine_model_id
  );
  v_lift := (v_res ->> 'lift_id')::uuid;
  -- submit_lift may recognise an identical lift logged minutes ago; link it
  -- only if it isn't already another set's board entry.
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
  public.log_training_set(uuid, uuid, integer, numeric, public.weight_unit, integer, date, timestamptz, uuid),
  public.update_training_set(uuid, numeric, public.weight_unit, integer, date, timestamptz),
  public.delete_training_set(uuid),
  public.dismiss_training_pr(uuid),
  public.submit_training_set(uuid, public.lift_visibility, uuid[])
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;

grant execute on function public.get_invite_preview(text), public.get_friend_invite_preview(text) to anon;
