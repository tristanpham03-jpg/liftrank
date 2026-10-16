-- Functional test for migration 0016 (13 more exercises), always rolled back:
--   (echo "begin;"; cat <snapshot>; cat supabase/migrations/20261011001600_*.sql tests/sql/1600_*.test.sql; echo "rollback;")
-- Expects a temp table `before_0016` (taken just before the migration) with the
-- existing exercises and lifts. Raises at the first failure; "all passed" otherwise.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000c001';
  b uuid := '00000000-0000-4000-8000-00000000c002';
  split uuid; d uuid; r jsonb; s uuid; n int; ex record;
  today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  -- 1. 63 active exercises; the 50 existing rows are byte-for-byte unchanged.
  if (select count(*) from public.exercises where is_active) <> 63 then raise exception '1: expected 63 exercises'; end if;
  if (select md5(string_agg(row_to_json(e)::text, ',' order by e.id)) from public.exercises e where e.id in (select id from before_0016 where kind = 'exercise'))
     <> (select v from before_0016 where kind = 'exercises_hash') then raise exception '1: an existing exercise row changed'; end if;
  if (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.id), '')) from public.lifts l) <> (select v from before_0016 where kind = 'lifts_hash') then
    raise exception '1: lifts changed'; end if;

  -- 2. Each new exercise is distinct and uses an existing scoring convention.
  for ex in select * from (values
    ('cable-crunch', 'core', 'cable', 'e1rm', 'stack'),
    ('machine-ab-crunch', 'core', 'selectorized', 'e1rm', 'stack'),
    ('hanging-leg-raise', 'core', 'bodyweight', 'max_reps', 'bodyweight'),
    ('hanging-knee-raise', 'core', 'bodyweight', 'max_reps', 'bodyweight'),
    ('weighted-decline-sit-up', 'core', 'bodyweight', 'added_load_e1rm', 'added'),
    ('stiff-leg-deadlift', 'legs', 'barbell', 'e1rm', 'total'),
    ('jm-smith-press', 'arms', 'smith_machine', 'e1rm', 'total'),
    ('close-grip-lat-pulldown', 'back', 'cable', 'e1rm', 'stack'),
    ('incline-dumbbell-curl', 'arms', 'dumbbell', 'e1rm', 'per_dumbbell'),
    ('machine-preacher-curl', 'arms', 'selectorized', 'e1rm', 'stack'),
    ('hip-abduction', 'legs', 'selectorized', 'e1rm', 'stack'),
    ('hip-adduction', 'legs', 'selectorized', 'e1rm', 'stack'),
    ('cable-wrist-curl', 'arms', 'cable', 'e1rm', 'stack')
  ) v(slug, cat, equip, method, conv) loop
    if not exists (select 1 from public.exercises e where e.slug = ex.slug and e.category::text = ex.cat and e.equipment_type::text = ex.equip
        and e.ranking_method::text = ex.method and e.weight_convention::text = ex.conv and e.is_active and cardinality(e.primary_muscles) > 0) then
      raise exception '2: % misconfigured', ex.slug; end if;
  end loop;
  if (select count(*) from public.exercises where category = 'core') <> 5 then raise exception '2: core category'; end if;

  -- 3. "sldl" now means Stiff-Leg Deadlift only; RDL keeps its own aliases.
  if (select count(*) from public.exercise_aliases where alias = 'sldl') <> 1
     or not exists (select 1 from public.exercise_aliases x join public.exercises e on e.id = x.exercise_id where x.alias = 'sldl' and e.slug = 'stiff-leg-deadlift') then
    raise exception '3: sldl alias'; end if;
  if not exists (select 1 from public.exercise_aliases x join public.exercises e on e.id = x.exercise_id where x.alias = 'rdl' and e.slug = 'romanian-deadlift') then
    raise exception '3: rdl alias lost'; end if;

  -- 4. Competitive submissions with the right scoring.
  insert into auth.users (id, email) values (a, 't1600a@example.com'), (b, 't1600b@example.com');
  update public.profiles set username = 't1600_' || substr(id::text, 33) where id in (a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  -- Bodyweight reps: no weight allowed, score = reps (never a 1RM formula).
  begin perform public.submit_lift((select id from public.exercises where slug = 'hanging-leg-raise'), 25, 'lb', 10, null, 'public', '{}', null, gen_random_uuid());
    raise exception '4: weight accepted on hanging leg raise';
  exception when others then if sqlerrm <> 'weight_not_allowed' then raise; end if; end;
  r := public.submit_lift((select id from public.exercises where slug = 'hanging-leg-raise'), null, null, 15, null, 'public', '{}', null, gen_random_uuid());
  if (r ->> 'score')::numeric <> 15 or not (r ->> 'is_ranked')::boolean then raise exception '4: leg raise score %', r ->> 'score'; end if;
  r := public.submit_lift((select id from public.exercises where slug = 'hanging-knee-raise'), null, null, 20, null, 'public', '{}', null, gen_random_uuid());
  if (r ->> 'score')::numeric <> 20 then raise exception '4: knee raise score'; end if;
  -- Weighted sit-up: only the held weight counts (25 lb × 10 ≈ 25 × 40/30 lb), never bodyweight.
  r := public.submit_lift((select id from public.exercises where slug = 'weighted-decline-sit-up'), 25, 'lb', 10, null, 'public', '{}', null, gen_random_uuid());
  if abs((r ->> 'score')::numeric - 25 * 0.45359237 * 40 / 30) > 0.001 then raise exception '4: sit-up score %', r ->> 'score'; end if;
  -- Stack exercise, with machine selection allowed; JM press on the Smith machine.
  r := public.submit_lift((select id from public.exercises where slug = 'cable-crunch'), 120, 'lb', 12, null, 'public', '{}', null, gen_random_uuid());
  if not (r ->> 'is_ranked')::boolean then raise exception '4: cable crunch 12 reps should rank'; end if;
  r := public.submit_lift((select id from public.exercises where slug = 'cable-crunch'), 100, 'lb', 20, null, 'public', '{}', null, gen_random_uuid());
  if (r ->> 'is_ranked')::boolean then raise exception '4: 20 reps must not rank (existing 12-rep rule)'; end if;
  r := public.submit_lift((select id from public.exercises where slug = 'jm-smith-press'), 135, 'lb', 8, null, 'public', '{}', null, gen_random_uuid());
  r := public.submit_lift((select id from public.exercises where slug = 'stiff-leg-deadlift'), 275, 'lb', 6, null, 'public', '{}', null, gen_random_uuid());
  -- SLDL and RDL are separate boards.
  if exists (select 1 from public.lifts l join public.exercises e on e.id = l.exercise_id where l.user_id = a and e.slug = 'romanian-deadlift') then
    raise exception '4: SLDL landed on RDL'; end if;

  -- 5. My Training: add new exercises to an existing customized day without touching the rest.
  split := public.import_training_split('Upper / Lower', 'ul', '2x', jsonb_build_array(
    jsonb_build_object('name', 'Upper', 'exercises', jsonb_build_array(
      jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'barbell-bench-press'), 'set_count', 4)))));
  select id into d from public.training_days where split_id = split;
  perform public.save_training_day(d, 'Upper', jsonb_build_array(
    jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'barbell-bench-press'), 'set_count', 4),
    jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'cable-crunch'), 'set_count', 3),
    jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'hanging-knee-raise'), 'set_count', 2)));
  if (select set_count from public.training_day_exercises where day_id = d and position = 0) <> 4 then raise exception '5: customized set count lost'; end if;
  if (select count(*) from public.training_day_exercises where day_id = d) <> 3 then raise exception '5: new exercises not added'; end if;
  r := public.log_training_set((select id from public.exercises where slug = 'hanging-knee-raise'), d, 1, null, null, 18, today, now(), gen_random_uuid());
  r := public.log_training_set((select id from public.exercises where slug = 'cable-crunch'), d, 1, 110, 'lb', 15, today, now(), gen_random_uuid());
  s := (r ->> 'id')::uuid;
  if (select count(*) from public.lifts where user_id = a) <> 7 then raise exception '5: training reached boards'; end if;
  r := public.submit_training_set(s, 'friends', '{}');
  if not exists (select 1 from public.lifts l where l.id = (r ->> 'lift_id')::uuid and l.training_set_id = s and l.reps = 15) then
    raise exception '5: submit from training'; end if;
end;
$$;
select 'all passed' as result;
