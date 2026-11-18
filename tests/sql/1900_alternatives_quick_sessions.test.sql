-- Functional test for migration 0019 (alternative slots, quick sessions, 15 exercises), always rolled back:
--   (echo "begin;"; cat <snapshot>; cat supabase/migrations/20261011001900_*.sql tests/sql/1900_*.test.sql; echo "rollback;")
-- Expects temp table before_0019 (taken just before the migration). Raises at the first failure.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000f001';
  b uuid := '00000000-0000-4000-8000-00000000f002';
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  incline uuid := (select id from public.exercises where slug = 'incline-smith-press');
  decline uuid := (select id from public.exercises where slug = 'smith-decline-press');
  curl uuid := (select id from public.exercises where slug = 'dumbbell-curl');
  today date := (now() at time zone 'America/Los_Angeles')::date;
  split uuid; upper uuid; sess uuid; r jsonb; n int;
begin
  -- 1. Existing data untouched; 83 exercises; Preacher Curl only renamed.
  if (select md5(string_agg(row_to_json(e)::text, ',' order by e.id)) from public.exercises e
      where slug not in ('preacher-curl', 'reverse-cable-curl', 'machine-lateral-raise', 'dumbbell-front-raise', 'behind-the-back-cable-lateral-raise',
        'smith-decline-press', 'low-to-high-cable-fly', 'high-to-low-cable-fly', 'chest-supported-wide-grip-row', 'chest-supported-close-grip-row',
        'close-grip-lat-row', 'back-extension', 'smith-romanian-deadlift', 'smith-shoulder-press', 'smith-hip-thrust', 'smith-split-squat'))
     <> (select v from before_0019 where kind = 'exercises') then raise exception '1: an existing exercise changed'; end if;
  if (select md5(row_to_json(e)::text) from (select id, slug, category, ranking_method, weight_convention, equipment_type, popular_rank from public.exercises where slug = 'preacher-curl') e)
     <> (select v from before_0019 where kind = 'preacher') then raise exception '1: preacher curl changed beyond its name'; end if;
  if (select name from public.exercises where slug = 'preacher-curl') <> 'Barbell Preacher Curl' then raise exception '1: rename'; end if;
  if (select count(*) from public.exercises where is_active) <> 83 then raise exception '1: expected 83 exercises'; end if;
  if (select count(distinct lower(name)) from public.exercises) <> 83 then raise exception '1: duplicate names'; end if;
  if (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.id), '')) from public.lifts l) <> (select v from before_0019 where kind = 'lifts') then raise exception '1: lifts'; end if;
  if (select md5(coalesce(string_agg(row_to_json(s)::text, ',' order by s.id), '')) from public.training_sets s) <> (select v from before_0019 where kind = 'sets') then raise exception '1: sets'; end if;
  if (select md5(coalesce(string_agg(row_to_json(d)::text, ',' order by d.id), '')) from (select id, user_id, day_id, exercise_id, position, set_count from public.training_day_exercises) d)
     <> (select v from before_0019 where kind = 'days') then raise exception '1: routines'; end if;
  if exists (select 1 from public.training_day_exercises where alt_group is not null) then raise exception '1: alt_group set on old rows'; end if;
  if (select md5(coalesce(string_agg(row_to_json(s)::text, ',' order by s.id), '')) from public.training_sessions s) <> (select v from before_0019 where kind = 'sessions') then raise exception '1: sessions'; end if;
  if (select count(*) from public.exercise_aliases) <= (select v::int from before_0019 where kind = 'aliases') then raise exception '1: aliases'; end if;
  if not exists (select 1 from public.exercise_aliases x join public.exercises e on e.id = x.exercise_id where x.alias = 'hyperextension' and e.slug = 'back-extension') then raise exception '1: alias'; end if;

  insert into auth.users (id, email) values (a, 't1900a@example.com'), (b, 't1900b@example.com');
  update public.profiles set username = 't1900_' || substr(id::text, 33) where id in (a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  split := public.import_training_split('Upper', 'custom', 'infinite', jsonb_build_array(
    jsonb_build_object('name', 'Upper', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 3)))));
  select id into upper from public.training_days where split_id = split;

  -- 2. Alternatives: incline/decline share a slot; a lone group collapses to a plain exercise.
  perform public.save_training_day(upper, 'Upper', jsonb_build_array(
    jsonb_build_object('exercise_id', bench, 'set_count', 3),
    jsonb_build_object('exercise_id', incline, 'set_count', 2, 'alt_group', 1),
    jsonb_build_object('exercise_id', decline, 'set_count', 3, 'alt_group', 1),
    jsonb_build_object('exercise_id', curl, 'set_count', 2, 'alt_group', 2)));
  if (select array_agg(alt_group order by position)::text from public.training_day_exercises where day_id = upper) <> '{NULL,1,1,NULL}' then
    raise exception '2: alt groups %', (select array_agg(alt_group order by position)::text from public.training_day_exercises where day_id = upper); end if;
  begin
    perform public.save_training_day(upper, 'Upper', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 3, 'alt_group', 99)));
    raise exception '2: bad group accepted';
  exception when others then if sqlerrm not like '%invalid_routine%' then raise; end if; end;
  -- Saving without groups (the old client) still works.
  perform public.save_training_day(upper, 'Upper', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 3), jsonb_build_object('exercise_id', incline, 'set_count', 2)));
  if exists (select 1 from public.training_day_exercises where day_id = upper and alt_group is not null) then raise exception '2: groups without asking'; end if;

  -- 3. Quick session (no day): one active session rule still holds, nothing changes in any routine.
  select count(*) into n from public.training_day_exercises where user_id = a;
  r := public.start_training_session(null, today, '{"v":1,"blocks":[]}'::jsonb);
  sess := (r ->> 'session_id')::uuid;
  if (select day_name from public.training_sessions where id = sess) <> 'Workout' or (select day_id from public.training_sessions where id = sess) is not null then raise exception '3: quick session'; end if;
  r := public.start_training_session(upper, today, '{"v":1}'::jsonb);
  if (r ->> 'session_id')::uuid <> sess then raise exception '3: second active session'; end if;
  r := public.finish_training_session(sess, gen_random_uuid(), today,
    jsonb_build_array(jsonb_build_object('exercise_id', decline, 'side', null, 'weight', 135, 'unit', 'lb', 'reps', 8, 'rir', 2)), null, '{}'::jsonb);
  if (r ->> 'sets')::int <> 1 then raise exception '3: finish %', r; end if;
  if (select day_id from public.training_sets where session_id = sess) is not null then raise exception '3: set day'; end if;
  if (select count(*) from public.training_day_exercises where user_id = a) <> n then raise exception '3: routine changed'; end if;

  -- 4. Privacy: b can't start a session on a's day or see a's routine rows.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  begin
    perform public.start_training_session(upper, today, '{"v":1}'::jsonb);
    raise exception '4: started on someone else''s day';
  exception when others then if sqlerrm not like '%not_found%' then raise; end if; end;
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.training_day_exercises where day_id = upper) then raise exception '4: rls'; end if;
  perform set_config('role', 'postgres', true);
  raise notice '1900 OK';
end $$;
