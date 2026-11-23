-- Functional test for migration 0023, always rolled back (ends in an exception):
--   (echo "begin;"; cat tests/sql/2300_snapshot.sql supabase/migrations/20261011002300_*.sql tests/sql/2300_*.test.sql; echo "rollback;")
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000f301';
  b uuid := '00000000-0000-4000-8000-00000000f302';
  as_a text := json_build_object('sub', '00000000-0000-4000-8000-00000000f301', 'role', 'authenticated')::text;
  as_b text := json_build_object('sub', '00000000-0000-4000-8000-00000000f302', 'role', 'authenticated')::text;
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  today date := (now() at time zone 'America/Los_Angeles')::date;
  mb bigint := 1048576;
  req uuid := gen_random_uuid();
  days jsonb;
  sp1 uuid; sp2 uuid; sp3 uuid; d uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; set2 uuid; set4 uuid; r jsonb; rec uuid; rec4 uuid; lift uuid; v_key text; res jsonb;
begin
  -- 0. Existing data untouched by the migration itself.
  if (select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.training_splits t) is distinct from
     (select v from before_2300 where k = 'splits_cols') then raise exception '0: splits changed'; end if;
  if (select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.training_sessions t) <> (select v from before_2300 where k = 'sessions')
     or (select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.training_sets t) <> (select v from before_2300 where k = 'sets')
     or (select md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.lifts t) <> (select v from before_2300 where k = 'lifts') then
    raise exception '0: existing data changed'; end if;

  insert into auth.users (id, email) values (a, 't2300a@example.com'), (b, 't2300b@example.com');
  update public.profiles set username = 't2300_' || substr(id::text, 33) where id in (a, b);
  days := jsonb_build_array(jsonb_build_object('name', 'Upper', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 3))),
                            jsonb_build_object('name', 'Lower', 'exercises', '[]'::jsonb));

  -- 1. Imports are idempotent per request: the same request (double tap, retry) returns the same split, no new days.
  perform set_config('request.jwt.claims', as_a, true);
  sp1 := public.import_training_split('Upper / Lower', 'ul', 'infinite', days, req);
  sp2 := public.import_training_split('Upper / Lower', 'ul', 'infinite', days, req);
  if sp1 <> sp2 then raise exception '1: same request created two splits'; end if;
  if (select count(*) from public.training_splits where user_id = a) <> 1 or (select count(*) from public.training_days where user_id = a) <> 2 then
    raise exception '1: duplicate splits or days'; end if;
  -- A new request is a new split; the repeat of the first request switches back to it (reversible), still no copies.
  sp3 := public.import_training_split('Push / Pull / Legs', 'ppl', '2x', days, gen_random_uuid());
  if (select is_active from public.training_splits where id = sp1) then raise exception '1: old split still active'; end if;
  -- (Separate statements: one statement can't see what a function it calls just changed.)
  sp2 := public.import_training_split('Upper / Lower', 'ul', 'infinite', days, req);
  if sp2 <> sp1 or not (select is_active from public.training_splits where id = sp1)
     or (select count(*) from public.training_splits where user_id = a) <> 2 or (select count(*) from public.training_splits where user_id = a and is_active) <> 1 then
    raise exception '1: repeat request should reactivate, not copy'; end if;
  -- Older clients (no request id) still import.
  perform public.import_training_split('Arnold', 'arnold', '2x', days);
  if (select count(*) from public.training_splits where user_id = a) <> 3 then raise exception '1: import without request id'; end if;
  -- Switching between saved splits never creates anything.
  perform public.set_active_training_split(sp1);
  if (select count(*) from public.training_splits where user_id = a) <> 3 or (select count(*) from public.training_days where user_id = a) <> 6 then
    raise exception '1: switching created data'; end if;
  -- Another user can't reuse someone's request id to reach their split.
  perform set_config('request.jwt.claims', as_b, true);
  if public.import_training_split('Upper / Lower', 'ul', 'infinite', days, req) = sp1 then raise exception '1: request id crossed users'; end if;

  -- 2. Delete a completed workout. Three bench sessions: 185, 205 (PR), 195 (not a PR while 205 exists).
  perform set_config('request.jwt.claims', as_a, true);
  select id into d from public.training_days where split_id = sp1 and name = 'Upper';
  s1 := (public.start_training_session(d, today, '{"v":1}') ->> 'session_id')::uuid;
  perform public.finish_training_session(s1, gen_random_uuid(), today - 3, jsonb_build_array(jsonb_build_object('exercise_id', bench, 'weight', 185, 'unit', 'lb', 'reps', 5)), null, null);
  update public.training_sessions set ended_at = now() - interval '3 hours' where id = s1;
  update public.training_sets set performed_at = now() - interval '3 hours' where session_id = s1;
  s2 := (public.start_training_session(d, today, '{"v":1}') ->> 'session_id')::uuid;
  perform public.finish_training_session(s2, gen_random_uuid(), today - 2, jsonb_build_array(jsonb_build_object('exercise_id', bench, 'weight', 205, 'unit', 'lb', 'reps', 5)), null, null);
  update public.training_sessions set ended_at = now() - interval '2 hours' where id = s2;
  update public.training_sets set performed_at = now() - interval '2 hours' where session_id = s2;
  s3 := (public.start_training_session(d, today, '{"v":1}') ->> 'session_id')::uuid;
  perform public.finish_training_session(s3, gen_random_uuid(), today - 1, jsonb_build_array(jsonb_build_object('exercise_id', bench, 'weight', 195, 'unit', 'lb', 'reps', 5)), null, null);
  update public.training_sessions set ended_at = now() - interval '1 hour' where id = s3;
  -- s3's stored summary, as finish decided it with the times above: recompute once so the baseline is consistent.
  perform public._recompute_session_prs(a, array[bench], now() - interval '1 day');
  if jsonb_array_length((select result -> 'prs' from public.training_sessions where id = s3)) <> 0 then raise exception '2: setup: 195 should not be a PR'; end if;
  select id into set2 from public.training_sets where session_id = s2;
  -- s2's set has a recording and is on the leaderboard.
  r := public.begin_recording(bench, 2 * mb, 'video/mp4', 20, set2);
  rec := (r ->> 'id')::uuid;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.finalize_recording(a, rec, 2 * mb, 20, 1920, 1080);
  perform set_config('request.jwt.claims', as_a, true);
  lift := (public.submit_training_set(set2, 'private', '{}') ->> 'lift_id')::uuid;
  if lift is null then select id into lift from public.lifts where training_set_id = set2; end if;
  if lift is null then raise exception '2: setup: lift not created'; end if;

  -- Not someone else's; not an active session; never without a decision about its recording.
  perform set_config('request.jwt.claims', as_b, true);
  begin perform public.delete_training_session(s2, 'keep'); raise exception '2: B deleted A''s session';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  perform set_config('request.jwt.claims', as_a, true);
  begin perform public.delete_training_session(s2); raise exception '2: deleted without a recording choice';
  exception when others then if sqlerrm <> 'recordings_choice_required' then raise; end if; end;
  if not exists (select 1 from public.training_sessions where id = s2) then raise exception '2: refused delete still deleted'; end if;
  s4 := (public.start_training_session(d, today, '{"v":1}') ->> 'session_id')::uuid;
  begin perform public.delete_training_session(s4, 'keep'); raise exception '2: deleted an active session';
  exception when others then if sqlerrm <> 'session_not_completed' then raise; end if; end;
  perform public.discard_training_session(s4);

  -- Keep: the recording stays (on the exercise), the lift stays as it was, the sets and session go, s3 becomes a PR.
  res := public.delete_training_session(s2, 'keep');
  if (res ->> 'sets')::int <> 1 or (res ->> 'recordings')::int <> 1 or (res ->> 'recordings_deleted')::int <> 0 then raise exception '2: result %', res; end if;
  if exists (select 1 from public.training_sessions where id = s2) or exists (select 1 from public.training_sets where id = set2) then raise exception '2: session or sets left'; end if;
  if not exists (select 1 from public.personal_recordings where id = rec and status = 'ready' and training_set_id is null and session_id is null) then
    raise exception '2: kept recording not on the exercise'; end if;
  if not exists (select 1 from public.lifts where id = lift and deleted_at is null and training_set_id is null and entered_weight = 205) then
    raise exception '2: competitive submission changed'; end if;
  if jsonb_array_length((select result -> 'prs' from public.training_sessions where id = s3)) <> 1 then raise exception '2: later PR not recomputed'; end if;
  if not exists (select 1 from public.training_sessions where id = s1) or not exists (select 1 from public.training_days where id = d) then
    raise exception '2: routine or other workouts touched'; end if;

  -- Delete: the recording and its file go (queued and returned for immediate removal).
  s5 := (public.start_training_session(d, today, '{"v":1}') ->> 'session_id')::uuid;
  perform public.finish_training_session(s5, gen_random_uuid(), today, jsonb_build_array(jsonb_build_object('exercise_id', bench, 'weight', 135, 'unit', 'lb', 'reps', 8)), null, null);
  select id into set4 from public.training_sets where session_id = s5;
  r := public.begin_recording(bench, 1 * mb, 'video/mp4', 10, set4);
  rec4 := (r ->> 'id')::uuid;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.finalize_recording(a, rec4, 1 * mb, 10, 1280, 720);
  perform set_config('request.jwt.claims', as_a, true);
  v_key := (select object_key from public.personal_recordings where id = rec4);
  res := public.delete_training_session(s5, 'delete');
  if (res ->> 'recordings_deleted')::int <> 1 or not (res -> 'keys') ? v_key then raise exception '2: delete result %', res; end if;
  if exists (select 1 from public.personal_recordings where id = rec4) then raise exception '2: recording not deleted'; end if;
  if not exists (select 1 from public.recording_object_deletions where object_key = v_key) then raise exception '2: file not queued'; end if;
  if (public.get_recording_usage() ->> 'used_bytes')::bigint <> 2 * mb then raise exception '2: usage after delete'; end if;
  begin perform public.delete_training_session(s5, 'nonsense'); raise exception '2: bad choice accepted';
  exception when others then if sqlerrm not in ('invalid_request', 'not_found') then raise; end if; end;

  -- 3. Grants: signed-in users only; the old 4-argument import is gone; helpers aren't callable.
  if not has_function_privilege('authenticated', 'public.delete_training_session(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.delete_training_session(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.import_training_split(text, text, text, jsonb, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._recompute_session_prs(uuid, uuid[], timestamptz)', 'execute')
     or to_regprocedure('public.import_training_split(text, text, text, jsonb)') is not null then
    raise exception '3: grants'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and not ('search_path=""' = any (coalesce(proconfig, '{}')))) then
    raise exception '3: a definer function without search_path'; end if;

  raise exception 'TEST_2300_OK';
end $$;
