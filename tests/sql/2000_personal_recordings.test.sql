-- Functional test for migration 0020 (My Recordings), always rolled back:
--   (echo "begin;"; cat tests/sql/2000_snapshot.sql supabase/migrations/20261011002000_*.sql tests/sql/2000_*.test.sql; echo "rollback;")
-- Expects temp table before_0020 (taken just before the migration). Raises at the first failure.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000d001';
  b uuid := '00000000-0000-4000-8000-00000000d002';
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  curl uuid := (select id from public.exercises where slug = 'dumbbell-curl');
  today date := (now() at time zone 'America/Los_Angeles')::date;
  mb bigint := 1048576;
  split uuid; upper uuid; sess uuid; r jsonb; r1 jsonb; r2 jsonb; rid uuid; rid2 uuid; n int; s1 uuid; s2 uuid; bset uuid; k text;
  as_a text := json_build_object('sub', '00000000-0000-4000-8000-00000000d001', 'role', 'authenticated')::text;
  as_b text := json_build_object('sub', '00000000-0000-4000-8000-00000000d002', 'role', 'authenticated')::text;
begin
  -- 1. Existing data untouched.
  if (select md5(coalesce(string_agg(row_to_json(s)::text, ',' order by s.id), '')) from public.training_sets s) <> (select v from before_0020 where kind = 'sets')
     or (select md5(coalesce(string_agg(row_to_json(s)::text, ',' order by s.id), '')) from public.training_sessions s) <> (select v from before_0020 where kind = 'sessions')
     or (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.id), '')) from public.lifts l) <> (select v from before_0020 where kind = 'lifts') then
    raise exception '1: existing data changed'; end if;
  if (select quota_bytes from public.storage_plans where id = 'free') <> 500 * mb or (select quota_bytes from public.storage_plans where id = 'pro') <> 5120 * mb then
    raise exception '1: plans'; end if;

  insert into auth.users (id, email) values (a, 't2000a@example.com'), (b, 't2000b@example.com');
  update public.profiles set username = 't2000_' || substr(id::text, 33) where id in (a, b);

  -- 2. Validation: everything the client says is checked.
  perform set_config('request.jwt.claims', as_a, true);
  begin perform public.begin_recording(bench, 101 * mb, 'video/mp4', 30); raise exception '2: >100 MB accepted';
  exception when others then if sqlerrm <> 'video_too_large' then raise; end if; end;
  begin perform public.begin_recording(bench, 10 * mb, 'video/mp4', 91); raise exception '2: >90 s accepted';
  exception when others then if sqlerrm <> 'video_too_long' then raise; end if; end;
  begin perform public.begin_recording(bench, 10 * mb, 'image/png', 30); raise exception '2: png accepted';
  exception when others then if sqlerrm <> 'invalid_video_type' then raise; end if; end;
  begin perform public.begin_recording(bench, 0, 'video/mp4', 30); raise exception '2: 0 bytes accepted';
  exception when others then if sqlerrm <> 'video_too_large' then raise; end if; end;
  begin perform public.begin_recording(gen_random_uuid(), 10 * mb, 'video/mp4', 30); raise exception '2: unknown exercise accepted';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;

  -- B's set can't be used by A; a set of another exercise can't be used either.
  perform set_config('request.jwt.claims', as_b, true);
  bset := (public.log_training_set(bench, null, 1, 135, 'lb', 5, today, now(), gen_random_uuid()) ->> 'id')::uuid;
  if bset is null then select id into bset from public.training_sets where user_id = b limit 1; end if;
  perform set_config('request.jwt.claims', as_a, true);
  begin perform public.begin_recording(bench, 10 * mb, 'video/mp4', 30, bset); raise exception '2: other user''s set accepted';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  perform public.log_training_set(bench, null, 1, 185, 'lb', 5, today - 1, now() - interval '1 day', gen_random_uuid());
  select id into s1 from public.training_sets where user_id = a and exercise_id = bench order by created_at desc limit 1;
  begin perform public.begin_recording(curl, 10 * mb, 'video/mp4', 30, s1); raise exception '2: set of another exercise accepted';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;

  -- 3. Object keys: random, no user id, unique.
  r := public.begin_recording(bench, 10 * mb, 'video/quicktime', 42.5, s1);
  rid := (r ->> 'id')::uuid; k := r ->> 'object_key';
  if k !~ '^rec/[0-9a-f]{32}\.mov$' or position(a::text in k) > 0 or position(replace(a::text, '-', '') in k) > 0 then raise exception '3: key %', k; end if;
  if position(replace(rid::text, '-', '') in k) > 0 then raise exception '3: key derived from the id'; end if;

  -- 4. Quota: reservations count; 500 MB is never exceeded; cancel gives space back.
  r := public.get_recording_usage();
  if (r ->> 'reserved_bytes')::bigint <> 10 * mb or (r ->> 'used_bytes')::bigint <> 0 or (r ->> 'quota_bytes')::bigint <> 500 * mb then raise exception '4: usage %', r; end if;
  r1 := public.begin_recording(bench, 100 * mb, 'video/mp4', 60);
  r2 := public.begin_recording(bench, 100 * mb, 'video/mp4', 60);
  perform public.begin_recording(bench, 100 * mb, 'video/mp4', 60);
  -- 4 pending at once is the limit.
  begin perform public.begin_recording(bench, 1 * mb, 'video/mp4', 10); raise exception '4: 5th concurrent upload accepted';
  exception when others then if sqlerrm <> 'too_many_uploads' then raise; end if; end;
  -- Finalize two (actual sizes smaller than declared: usage reflects the real bytes).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.finalize_recording(a, (r1 ->> 'id')::uuid, 95 * mb, 59.9, 1920, 1080);
  if not (r ->> 'ok')::boolean then raise exception '4: finalize %', r; end if;
  r := public.finalize_recording(a, (r2 ->> 'id')::uuid, 99 * mb, 60);
  -- Larger than reserved: rejected and dropped.
  r := public.finalize_recording(a, rid, 11 * mb, 42.5);
  if (r ->> 'ok')::boolean or r ->> 'error' <> 'upload_size_mismatch' then raise exception '4: oversize finalize %', r; end if;
  if exists (select 1 from public.personal_recordings where id = rid) then raise exception '4: oversize row kept'; end if;
  if not exists (select 1 from public.recording_object_deletions where object_key = k) then raise exception '4: oversize file not queued'; end if;
  perform set_config('request.jwt.claims', as_a, true);
  r := public.get_recording_usage();
  -- used 194 MB, reserved 100 MB (the third)
  if (r ->> 'used_bytes')::bigint <> 194 * mb or (r ->> 'reserved_bytes')::bigint <> 100 * mb or (r ->> 'count')::int <> 2 then raise exception '4: usage after finalize %', r; end if;
  r := public.begin_recording(bench, 100 * mb, 'video/mp4', 60);   -- 394 MB
  r := public.begin_recording(bench, 100 * mb, 'video/mp4', 60);   -- 494 MB
  begin perform public.begin_recording(bench, 7 * mb, 'video/mp4', 60); raise exception '4: over quota accepted';
  exception when others then if sqlerrm not in ('storage_full', 'too_many_uploads') then raise; end if; end;
  perform public.cancel_recording((r ->> 'id')::uuid);             -- back to 394 MB
  r := public.begin_recording(bench, 100 * mb, 'video/mp4', 60);   -- 494 MB again
  begin perform public.begin_recording(bench, 7 * mb, 'video/mp4', 60); raise exception '4: over quota accepted (2)';
  exception when others then if sqlerrm <> 'storage_full' then raise; end if; end;
  perform public.cancel_recording((r ->> 'id')::uuid);
  -- A lapsed reservation doesn't hold space and is dropped (file queued).
  update public.personal_recordings set expires_at = now() - interval '1 minute' where user_id = a and status = 'pending';
  r := public.get_recording_usage();
  if (r ->> 'reserved_bytes')::bigint <> 0 then raise exception '4: lapsed reservation still counted %', r; end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.recording_maintenance();
  if exists (select 1 from public.personal_recordings where user_id = a and status = 'pending') then raise exception '4: lapsed rows kept'; end if;
  -- A lapsed reservation can't be finalized.
  perform set_config('request.jwt.claims', as_a, true);
  r := public.begin_recording(bench, 1 * mb, 'video/mp4', 5);
  update public.personal_recordings set expires_at = now() - interval '1 second' where id = (r ->> 'id')::uuid;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.finalize_recording(a, (r ->> 'id')::uuid, 1 * mb, 5);
  if (r ->> 'error') <> 'upload_expired' then raise exception '4: lapsed finalize %', r; end if;
  -- Pro quota is just a plan change (server side).
  update public.video_storage_accounts set plan_id = 'pro' where user_id = a;
  perform set_config('request.jwt.claims', as_a, true);
  if (public.get_recording_usage() ->> 'quota_bytes')::bigint <> 5120 * mb then raise exception '4: pro quota'; end if;
  update public.video_storage_accounts set plan_id = 'free' where user_id = a;

  -- 5. Ownership: B can't see, change, cancel or delete A's recordings.
  perform set_config('request.jwt.claims', as_b, true);
  begin perform public.delete_recording((r1 ->> 'id')::uuid); raise exception '5: B deleted A''s recording';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  begin perform public.update_recording((r1 ->> 'id')::uuid, 'mine', null, null, true); raise exception '5: B renamed A''s recording';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  perform public.cancel_recording((r1 ->> 'id')::uuid);
  if not exists (select 1 from public.personal_recordings where id = (r1 ->> 'id')::uuid and status = 'ready') then raise exception '5: B cancelled A''s recording'; end if;
  if array_length(public.my_recording_keys(), 1) is not null then raise exception '5: B sees A''s keys'; end if;

  -- 6. Change association; rename; delete frees space at once.
  perform set_config('request.jwt.claims', as_a, true);
  perform public.update_recording((r1 ->> 'id')::uuid, '  Top set  ', 'Elbows flared', s1, false);
  if (select training_set_id from public.personal_recordings where id = (r1 ->> 'id')::uuid) <> s1
     or (select title from public.personal_recordings where id = (r1 ->> 'id')::uuid) <> 'Top set' then raise exception '6: update'; end if;
  begin perform public.update_recording((r1 ->> 'id')::uuid, null, null, bset, false); raise exception '6: moved to B''s set';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  perform public.update_recording((r1 ->> 'id')::uuid, 'Top set', null, null, true);
  if (select training_set_id from public.personal_recordings where id = (r1 ->> 'id')::uuid) is not null then raise exception '6: exercise-level'; end if;
  k := public.delete_recording((r2 ->> 'id')::uuid);
  if (public.get_recording_usage() ->> 'used_bytes')::bigint <> 95 * mb then raise exception '6: delete did not free space'; end if;
  if not exists (select 1 from public.recording_object_deletions where object_key = k) then raise exception '6: deleted file not queued'; end if;

  -- 7. During a workout: attach to a draft row; End links it to the saved set; leftovers stay on the exercise.
  split := public.import_training_split('Upper / Lower', 'ul', 'infinite', jsonb_build_array(
    jsonb_build_object('name', 'Upper', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 3)))));
  select id into upper from public.training_days where split_id = split and name = 'Upper';
  sess := (public.start_training_session(upper, today, '{"v":1}'::jsonb) ->> 'session_id')::uuid;
  r1 := public.begin_recording(bench, 2 * mb, 'video/mp4', 20, null, sess, 'b1/2');   -- the 2nd row
  r2 := public.begin_recording(bench, 2 * mb, 'video/mp4', 20, null, sess, 'b1/3');   -- a row left empty
  -- Not for someone else's session.
  perform set_config('request.jwt.claims', as_b, true);
  begin perform public.begin_recording(bench, 1 * mb, 'video/mp4', 5, null, sess, 'b1/1'); raise exception '7: B attached to A''s session';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  perform set_config('request.jwt.claims', as_a, true);
  r := public.finish_training_session(sess, gen_random_uuid(), today, jsonb_build_array(
    jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 205, 'unit', 'lb', 'reps', 5, 'rir', 2, 'ref', 'b1/1'),
    jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 205, 'unit', 'lb', 'reps', 4, 'rir', 1, 'ref', 'b1/2')), null, null);
  select id into s2 from public.training_sets where session_id = sess and set_number = 2;
  if (select training_set_id from public.personal_recordings where id = (r1 ->> 'id')::uuid) is distinct from s2 then raise exception '7: not linked to set 2'; end if;
  if (select draft_ref from public.personal_recordings where id = (r2 ->> 'id')::uuid) is not null
     or (select training_set_id from public.personal_recordings where id = (r2 ->> 'id')::uuid) is not null then raise exception '7: leftover not on the exercise'; end if;
  if not exists (select 1 from public.personal_recordings where id = (r2 ->> 'id')::uuid) then raise exception '7: leftover deleted'; end if;
  -- Old clients without refs still finish fine.
  sess := (public.start_training_session(upper, today, '{"v":1}'::jsonb) ->> 'session_id')::uuid;
  perform public.finish_training_session(sess, gen_random_uuid(), today, jsonb_build_array(
    jsonb_build_object('exercise_id', bench, 'side', null, 'weight', 135, 'unit', 'lb', 'reps', 5, 'rir', null)), null, null);
  -- Discarding keeps the recording, on the exercise.
  sess := (public.start_training_session(upper, today, '{"v":1}'::jsonb) ->> 'session_id')::uuid;
  r := public.begin_recording(bench, 1 * mb, 'video/mp4', 5, null, sess, 'b1/1');
  perform public.discard_training_session(sess);
  if (select draft_ref from public.personal_recordings where id = (r ->> 'id')::uuid) is not null then raise exception '7: discard kept draft ref'; end if;
  -- Deleting a linked set keeps the recording, on the exercise.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.finalize_recording(a, (r1 ->> 'id')::uuid, 2 * mb, 20);
  perform set_config('request.jwt.claims', as_a, true);
  perform public.delete_training_set(s2);
  if not exists (select 1 from public.personal_recordings where id = (r1 ->> 'id')::uuid and training_set_id is null and status = 'ready') then
    raise exception '7: deleting the set lost the recording'; end if;

  -- 8. Never on boards, feed, notifications or proofs.
  if exists (select 1 from public.lifts where user_id = a) then raise exception '8: a recording made a lift'; end if;
  if exists (select 1 from public.notifications where actor_id = a or recipient_id = a) then raise exception '8: notification'; end if;

  -- 9. Cleanup queue: keys only handed out once upload URLs can no longer write them; removed keys forgotten.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if array_length(public.recording_maintenance(), 1) is not null then raise exception '9: fresh keys handed out'; end if;
  update public.recording_object_deletions set queued_at = now() - interval '1 hour';
  n := coalesce(array_length(public.recording_maintenance(), 1), 0);
  if n < 3 then raise exception '9: expected queued keys, got %', n; end if;
  if public.recording_objects_removed(public.recording_maintenance()) <> n then raise exception '9: removed count'; end if;
  if exists (select 1 from public.recording_object_deletions) then raise exception '9: queue not emptied'; end if;

  -- 10. Account deletion: every file queued.
  delete from auth.users where id = a;
  if exists (select 1 from public.personal_recordings where user_id = a) then raise exception '10: rows outlived the account'; end if;
  if (select count(*) from public.recording_object_deletions) < 2 then raise exception '10: files not queued'; end if;

  -- 11. Grants: users can't finalize or run cleanup; no anon access.
  if has_function_privilege('authenticated', 'public.finalize_recording(uuid, uuid, bigint, numeric, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.recording_maintenance()', 'execute')
     or has_function_privilege('authenticated', 'public.recording_objects_removed(text[])', 'execute')
     or has_function_privilege('anon', 'public.begin_recording(uuid, bigint, text, numeric, uuid, uuid, text, timestamptz)', 'execute')
     or has_table_privilege('anon', 'public.personal_recordings', 'select')
     or has_table_privilege('authenticated', 'public.personal_recordings', 'insert')
     or has_table_privilege('authenticated', 'public.personal_recordings', 'update')
     or has_table_privilege('authenticated', 'public.video_storage_accounts', 'update')
     or has_table_privilege('authenticated', 'public.recording_object_deletions', 'select') then
    raise exception '11: grants'; end if;
  if not has_function_privilege('authenticated', 'public.begin_recording(uuid, bigint, text, numeric, uuid, uuid, text, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.finalize_recording(uuid, uuid, bigint, numeric, integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.finish_training_session(uuid, uuid, date, jsonb, text, jsonb)', 'execute') then
    raise exception '11: missing grants'; end if;
  -- Every SECURITY DEFINER function in this migration pins search_path.
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.prosecdef and p.proname ~ 'recording'
               and not coalesce(p.proconfig, '{}') @> array['search_path=""']) then raise exception '11: search_path'; end if;

  raise notice 'tests/sql/2000_personal_recordings: all passed';
end;
$$;

-- 12. RLS: as B (role authenticated), A's rows are invisible. (Last: the role switch can't be undone in this transaction.)
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000d002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.personal_recordings where user_id <> auth.uid()) then raise exception '12: RLS leak'; end if;
  if exists (select 1 from public.video_storage_accounts where user_id <> auth.uid()) then raise exception '12: account leak'; end if;
  raise notice '12: RLS ok';
end $$;
