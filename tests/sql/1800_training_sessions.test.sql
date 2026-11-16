-- Functional test for migration 0018 (sessions, RIR, notes, tips, 5 exercises), always rolled back:
--   (echo "begin;"; cat <snapshot>; cat supabase/migrations/20261011001800_*.sql tests/sql/1800_*.test.sql; echo "rollback;")
-- Expects temp table before_0018 (taken just before the migration). Raises at the first failure.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000e001';
  b uuid := '00000000-0000-4000-8000-00000000e002';
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  curl uuid := (select id from public.exercises where slug = 'dumbbell-curl');
  pullup uuid := (select id from public.exercises where slug = 'pull-up');
  today date := (now() at time zone 'America/Los_Angeles')::date;
  split uuid; upper uuid; lower uuid; sess uuid; sess2 uuid; key uuid := gen_random_uuid();
  r jsonb; ver int; n int; sets jsonb; bad jsonb; s1 uuid;
begin
  -- 1. Existing data untouched; 68 exercises; Bicep Supination is training-only.
  if (select md5(string_agg(row_to_json(e)::text, ',' order by e.id)) from public.exercises e
      where slug not in ('keenan-flaps', 'recline-curl', 'kelso-shrug', 'bicep-supination', 'face-pull')) <> (select v from before_0018 where kind = 'exercises') then
    raise exception '1: an existing exercise changed'; end if;
  if (select count(*) from public.exercises where is_active) <> 68 then raise exception '1: expected 68 exercises'; end if;
  if (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.id), '')) from public.lifts l) <> (select v from before_0018 where kind = 'lifts') then
    raise exception '1: lifts changed'; end if;
  if exists (select 1 from public.training_sets where session_id is not null or rir is not null) then raise exception '1: existing sets changed'; end if;
  if (select ranking_method::text from public.exercises where slug = 'bicep-supination') <> 'none' then raise exception '1: supination should be training-only'; end if;
  if not exists (select 1 from public.exercise_aliases x join public.exercises e on e.id = x.exercise_id where x.alias = 'kelso' and e.slug = 'kelso-shrug')
     or not exists (select 1 from public.exercise_aliases x join public.exercises e on e.id = x.exercise_id where x.alias = 'keenan' and e.slug = 'keenan-flaps')
     or not exists (select 1 from public.exercise_aliases x join public.exercises e on e.id = x.exercise_id where x.alias = 'supinations' and e.slug = 'bicep-supination') then
    raise exception '1: aliases'; end if;
  if (select equipment_type::text from public.exercises where slug = 'face-pull') <> 'cable' then raise exception '1: face pull'; end if;

  insert into auth.users (id, email) values (a, 't1800a@example.com'), (b, 't1800b@example.com');
  update public.profiles set username = 't1800_' || substr(id::text, 33) where id in (a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  split := public.import_training_split('Upper / Lower', 'ul', 'infinite', jsonb_build_array(
    jsonb_build_object('name', 'Upper', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 3))),
    jsonb_build_object('name', 'Lower', 'exercises', '[]'::jsonb)));
  select id into upper from public.training_days where split_id = split and name = 'Upper';
  select id into lower from public.training_days where split_id = split and name = 'Lower';
  -- A lighter earlier standalone set, so a heavier session set is a genuine PR.
  perform public.log_training_set(bench, upper, 1, 185, 'lb', 5, today - 3, now() - interval '3 days', gen_random_uuid());

  -- 2. Start; one active session at a time (starting another day returns the active one).
  r := public.start_training_session(upper, today, '{"v":1}'::jsonb);
  sess := (r ->> 'session_id')::uuid;
  if (r ->> 'resumed')::boolean then raise exception '2: new session marked resumed'; end if;
  r := public.start_training_session(lower, today, '{"v":1}'::jsonb);
  if (r ->> 'session_id')::uuid <> sess or not (r ->> 'resumed')::boolean then raise exception '2: second active session'; end if;
  if (select count(*) from public.training_sets where session_id = sess) <> 0 then raise exception '2: starting saved sets'; end if;

  -- 3. Draft autosave with versions.
  ver := public.save_training_draft(sess, '{"v":1,"typed":"185"}'::jsonb, 1);
  if ver <> 2 then raise exception '3: version'; end if;
  begin perform public.save_training_draft(sess, '{"v":1,"typed":"stale"}'::jsonb, 1); raise exception '3: stale draft accepted';
  exception when others then if sqlerrm <> 'draft_conflict' then raise; end if; end;
  if (select draft ->> 'typed' from public.training_sessions where id = sess) <> '185' then raise exception '3: draft lost'; end if;

  -- 4. End is all-or-nothing: one invalid set saves nothing and keeps the draft.
  sets := jsonb_build_array(
    jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 205, 'unit', 'lb', 'reps', 5, 'rir', 1),
    jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 205, 'unit', 'lb', 'reps', 4, 'rir', null),
    jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 195, 'unit', 'lb', 'reps', 5, 'rir', 0),
    jsonb_build_object('exercise_id', curl, 'side', 'left', 'weight', 30, 'unit', 'lb', 'reps', 10, 'rir', 2),
    jsonb_build_object('exercise_id', curl, 'side', 'right', 'weight', 30, 'unit', 'lb', 'reps', 9, 'rir', 2),
    jsonb_build_object('exercise_id', pullup, 'side', null, 'weight', null, 'unit', null, 'reps', 12, 'rir', null));
  bad := sets || jsonb_build_array(jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 100, 'unit', 'lb', 'reps', 5, 'rir', 11));
  begin perform public.finish_training_session(sess, key, today, bad, null, '{}'); raise exception '4: invalid RIR accepted';
  exception when others then if sqlerrm <> 'invalid_rir' then raise; end if; end;
  if exists (select 1 from public.training_sets where session_id = sess) then raise exception '4: partial save'; end if;
  if (select status from public.training_sessions where id = sess) <> 'active' or (select draft ->> 'typed' from public.training_sessions where id = sess) <> '185' then
    raise exception '4: failed End lost the session or draft'; end if;
  begin perform public.finish_training_session(sess, key, today,
    jsonb_build_array(jsonb_build_object('exercise_id', bench, 'side', 'left', 'weight', 100, 'unit', 'lb', 'reps', 5)), null, '{}');
    raise exception '4: left side on bench accepted';
  exception when others then if sqlerrm <> 'unilateral_not_supported' then raise; end if; end;

  r := public.finish_training_session(sess, key, today, sets, 'Felt strong', jsonb_build_object(bench::text, 'Paused first rep'));
  if (r ->> 'sets')::int <> 6 or (r ->> 'already')::boolean then raise exception '4: finish result %', r; end if;
  if jsonb_array_length(r -> 'prs') <> 1 or (r -> 'prs' -> 0 ->> 'exercise_id')::uuid <> bench then raise exception '4: PR suggestion %', r -> 'prs'; end if;
  if (select string_agg(set_number::text || coalesce(side, '-') || coalesce(rir::text, 'n'), ' ' order by created_at, set_number) from public.training_sets where session_id = sess and exercise_id = bench)
     <> '1-1 2-n 3-0' then raise exception '4: bench numbering / RIR'; end if;
  if (select string_agg(set_number::text || side, ' ' order by side) from public.training_sets where session_id = sess and exercise_id = curl) <> '1left 1right' then
    raise exception '4: per-side numbering'; end if;
  if (select status from public.training_sessions where id = sess) <> 'completed' or (select draft from public.training_sessions where id = sess) <> '{}'::jsonb
     or (select notes from public.training_sessions where id = sess) <> 'Felt strong' then raise exception '4: session not closed'; end if;
  if (select day_id from public.training_sets where session_id = sess limit 1) <> upper then raise exception '4: day not recorded'; end if;

  -- 5. Retrying End with the same key changes nothing; another key is refused.
  r := public.finish_training_session(sess, key, today, sets, null, '{}');
  if not (r ->> 'already')::boolean or (select count(*) from public.training_sets where session_id = sess) <> 6 then raise exception '5: retry duplicated'; end if;
  begin perform public.finish_training_session(sess, gen_random_uuid(), today, sets, null, '{}'); raise exception '5: second finish';
  exception when others then if sqlerrm <> 'session_already_ended' then raise; end if; end;

  -- 6. Nothing public happened.
  if (select count(*) from public.lifts where user_id = a) <> 0 then raise exception '6: lift created'; end if;
  if (select count(*)::text from public.notifications) <> (select v from before_0018 where kind = 'notifs') then raise exception '6: notified'; end if;
  if (select count(*)::text from public.activities) <> (select v from before_0018 where kind = 'acts') then raise exception '6: feed item'; end if;

  -- 7. A second session the same day (same exercise) is fine; discard saves nothing.
  sess2 := (public.start_training_session(lower, today, '{"v":1}'::jsonb) ->> 'session_id')::uuid;
  if sess2 = sess then raise exception '7: reused a completed session'; end if;
  r := public.finish_training_session(sess2, gen_random_uuid(), today,
    jsonb_build_array(jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 135, 'unit', 'lb', 'reps', 10)), null, '{}');
  sess2 := (public.start_training_session(upper, today, '{"v":1}'::jsonb) ->> 'session_id')::uuid;
  perform public.save_training_draft(sess2, '{"x":1}'::jsonb, 1);
  perform public.discard_training_session(sess2);
  if (select status from public.training_sessions where id = sess2) <> 'discarded' then raise exception '7: not discarded'; end if;
  begin perform public.finish_training_session(sess2, gen_random_uuid(), today, sets, null, '{}'); raise exception '7: finished a discarded session';
  exception when others then if sqlerrm <> 'session_not_active' then raise; end if; end;
  if exists (select 1 from public.training_sets where session_id = sess2) then raise exception '7: discard saved sets'; end if;

  -- 8. RIR edits: keep by default, set, clear; old-style calls keep it.
  s1 := (select id from public.training_sets where session_id = sess and exercise_id = bench and set_number = 1);
  perform public.update_training_set(p_set_id => s1, p_weight => 205, p_unit => 'lb', p_reps => 6, p_local_date => null, p_performed_at => null);
  if (select rir from public.training_sets where id = s1) <> 1 then raise exception '8: RIR not kept'; end if;
  perform public.update_training_set(s1, 205, 'lb', 6, null, null, 'keep', 3::smallint);
  if (select rir from public.training_sets where id = s1) <> 3 then raise exception '8: RIR not set'; end if;
  perform public.update_training_set(s1, 205, 'lb', 6, null, null, 'keep', null);
  if (select rir from public.training_sets where id = s1) is not null then raise exception '8: RIR not cleared'; end if;
  begin perform public.update_training_set(s1, 205, 'lb', 6, null, null, 'keep', 11::smallint); raise exception '8: RIR 11';
  exception when others then if sqlerrm <> 'invalid_rir' then raise; end if; end;

  -- 9. Notes, tips, settings.
  perform public.set_exercise_note(bench, 'Seat height 3');
  if (select note from public.exercise_preferences where user_id = a and exercise_id = bench) <> 'Seat height 3' then raise exception '9: note'; end if;
  perform public.set_exercise_note(bench, '  ');
  if (select note from public.exercise_preferences where user_id = a and exercise_id = bench) is not null then raise exception '9: note not cleared'; end if;
  perform public.set_exercise_note(bench, 'Seat height 3');
  perform public.dismiss_training_tip('consistency:2026-11-09');
  perform public.dismiss_training_tip('consistency:2026-11-09');

  -- 10. A session set can still be submitted to a board, explicitly.
  r := public.submit_training_set(s1, 'friends', '{}');
  if not exists (select 1 from public.lifts where id = (r ->> 'lift_id')::uuid and training_set_id = s1) then raise exception '10: submit'; end if;

  -- 11. Privacy: another account sees and changes none of it.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  begin perform public.save_training_draft(sess, '{}'::jsonb, 2); raise exception '11: other user saved draft';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  begin perform public.discard_training_session(sess2); raise exception '11: other user discarded';
  exception when others then if sqlerrm <> 'session_not_active' then raise; end if; end;
  begin perform public.finish_training_session(sess, key, today, sets, null, '{}'); raise exception '11: other user finished';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  execute 'set local role authenticated';
  select count(*) into n from public.training_sessions; if n <> 0 then raise exception '11: reads sessions'; end if;
  select count(*) into n from public.training_tip_dismissals; if n <> 0 then raise exception '11: reads tips'; end if;
  select count(*) into n from public.exercise_preferences; if n <> 0 then raise exception '11: reads notes'; end if;
  update public.user_settings set training_tips = false where user_id = a;
  get diagnostics n = row_count; if n <> 0 then raise exception '11: changed another user''s settings'; end if;
  execute 'reset role';
  -- The owner can turn tips off through the column grant.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  update public.user_settings set training_tips = false where user_id = a;
  get diagnostics n = row_count; if n <> 1 then raise exception '11: owner cannot turn tips off'; end if;
  select count(*) into n from public.training_sessions; if n <> 3 then raise exception '11: owner sees % sessions', n; end if;
  execute 'reset role';
end;
$$;
select 'all passed' as result;
