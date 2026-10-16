-- Functional test for migration 0015 (training tracker), run inside a
-- transaction that is always rolled back (nothing persists):
--   (echo "begin;"; cat supabase/migrations/20261011001500_*.sql tests/sql/1500_*.test.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked -f /tmp/t.sql
-- Raises at the first failed expectation; returns "all passed" otherwise.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000b001';
  b uuid := '00000000-0000-4000-8000-00000000b002';
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  pulldown uuid := (select id from public.exercises where slug = 'lat-pulldown');
  squat uuid := (select id from public.exercises where slug = 'barbell-back-squat');
  pullup uuid := (select id from public.exercises where slug = 'pull-up');
  split uuid; split2 uuid; upper uuid; lower uuid; d uuid;
  r jsonb; s1 uuid; s2 uuid; s3 uuid; lift uuid; n int; key uuid := gen_random_uuid();
  today date := (now() at time zone 'America/Los_Angeles')::date;
  lifts_before text; notif_before int; act_before int;
begin
  -- Snapshot of every existing lift, notification and activity: none may change.
  select md5(coalesce(string_agg(id::text || weight_kg || reps || coalesce(score, 0) || verification_status || visibility || performed_at, ',' order by id), ''))
    into lifts_before from public.lifts;
  select count(*) into notif_before from public.notifications;
  select count(*) into act_before from public.activities;

  insert into auth.users (id, email) values (a, 't1500a@example.com'), (b, 't1500b@example.com');
  update public.profiles set username = 't1500_' || substr(id::text, 33) where id in (a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  perform public.send_friend_request(a);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  perform public.respond_friend_request((select id from public.friendships where requester_id = b and addressee_id = a), true);

  -- 1. Import U/L 2x: two days, same templates; rotation is just a label.
  split := public.import_training_split('Upper / Lower', 'ul', '2x', jsonb_build_array(
    jsonb_build_object('name', 'Upper', 'exercises', jsonb_build_array(
      jsonb_build_object('exercise_id', bench, 'set_count', 3), jsonb_build_object('exercise_id', pulldown, 'set_count', 2))),
    jsonb_build_object('name', 'Lower', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', squat, 'set_count', 3)))));
  select id into upper from public.training_days where split_id = split and name = 'Upper';
  select id into lower from public.training_days where split_id = split and name = 'Lower';
  if (select count(*) from public.training_days where split_id = split) <> 2 then raise exception '1: days'; end if;
  if (select count(*) from public.training_day_exercises where day_id = upper) <> 2 then raise exception '1: upper exercises'; end if;

  -- 20. Opening / reading creates nothing.
  perform * from public.training_day_exercises where day_id = upper;
  if exists (select 1 from public.training_sets where user_id = a) then raise exception '20: reading created sets'; end if;

  -- 6. Log working sets; 15 & privacy: nothing public happens.
  -- First session: a heavier second set is not a "PR" (no earlier history).
  r := public.log_training_set(bench, upper, 1, 135, 'lb', 5, today - 1, now() - interval '1 day', gen_random_uuid());
  if (r ->> 'is_pr')::boolean then raise exception '6: first set ever must not be a PR'; end if;
  r := public.log_training_set(bench, upper, 2, 155, 'lb', 5, today - 1, now() - interval '1 day', gen_random_uuid());
  if (r ->> 'is_pr')::boolean then raise exception '6: heavier set in the first session must not be a PR'; end if;
  r := public.log_training_set(bench, upper, 1, 185, 'lb', 8, today, now(), key);
  s1 := (r ->> 'id')::uuid;
  if not (r ->> 'is_pr')::boolean then raise exception '6: beating an earlier day should be a PR'; end if;
  r := public.log_training_set(bench, upper, 1, 185, 'lb', 8, today, now(), key);
  if not (r ->> 'duplicate')::boolean or (r ->> 'id')::uuid <> s1 then raise exception '6: double tap made a second set'; end if;
  r := public.log_training_set(bench, upper, 1, 190, 'lb', 8, today, now(), gen_random_uuid());
  if not (r ->> 'duplicate')::boolean then raise exception '6: same slot saved twice'; end if;
  r := public.log_training_set(bench, upper, 2, 205, 'lb', 6, today, now(), gen_random_uuid());
  s2 := (r ->> 'id')::uuid;
  if not (r ->> 'is_pr')::boolean then raise exception '6: 205x6 beats 185x8 and should be a PR'; end if;
  r := public.log_training_set(bench, upper, 3, 135, 'lb', 20, today, now(), gen_random_uuid());
  s3 := (r ->> 'id')::uuid;
  if (r ->> 'is_pr')::boolean then raise exception '6: 20 reps is not ranked, so never a PR'; end if;
  r := public.log_training_set(pullup, upper, 1, null, null, 12, today, now(), gen_random_uuid());
  if (select weight_kg from public.training_sets where id = (r ->> 'id')::uuid) is not null then raise exception '6: bodyweight'; end if;
  begin perform public.log_training_set(bench, upper, 4, 5000, 'lb', 1, today, now(), gen_random_uuid()); raise exception '6: impossible weight saved';
  exception when others then if sqlerrm <> 'weight_too_high' then raise; end if; end;
  begin perform public.log_training_set(bench, upper, 4, 100, 'lb', 5, today + 3, now(), gen_random_uuid()); raise exception '6: future date saved';
  exception when others then if sqlerrm <> 'future_date' then raise; end if; end;
  if (select count(*) from public.notifications) <> notif_before + 1 then raise exception '15: training sets notified someone'; end if; -- +1 = friend_accepted above
  if (select count(*) from public.activities) <> act_before then raise exception '15: training sets made feed items'; end if;
  if exists (select 1 from public.lifts where user_id = a) then raise exception '15: training sets reached lifts'; end if;

  -- 11 & 17. Another account (a friend) can't read or change any of it.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.training_sets; if n <> 0 then raise exception '11: friend can read training sets'; end if;
  select count(*) into n from public.training_splits; if n <> 0 then raise exception '11: friend can read splits'; end if;
  select count(*) into n from public.training_days; if n <> 0 then raise exception '11: friend can read days'; end if;
  begin
    update public.training_sets set reps = 1 where id = s1;
    raise exception '17: direct update allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  begin perform public.update_training_set(s1, 100, 'lb', 1, null, null); raise exception '17: friend edited my set';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  begin perform public.delete_training_set(s1); raise exception '17: friend deleted my set';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  begin perform public.submit_training_set(s1, 'public', '{}'); raise exception '17: friend submitted my set';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  begin perform public.save_training_day(upper, 'Hacked', '[]'); raise exception '17: friend edited my day';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  -- The owner can read their own (RLS).
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.training_sets; if n <> 6 then raise exception '11: owner sees % sets', n; end if;
  execute 'reset role';

  -- 9. Edit a saved set: same row, rescored, not a new performance.
  perform public.update_training_set(s1, 195, 'lb', 8, null, null);
  if (select entered_weight from public.training_sets where id = s1) <> 195 then raise exception '9: edit not saved'; end if;
  if (select count(*) from public.training_sets where user_id = a) <> 6 then raise exception '9: edit created a set'; end if;

  -- 12-14. Submit an existing set to the boards: right values, once.
  r := public.submit_training_set(s2, 'friends', '{}');
  lift := (r ->> 'lift_id')::uuid;
  if not exists (select 1 from public.lifts l where l.id = lift and l.training_set_id = s2 and l.exercise_id = bench
      and l.entered_weight = 205 and l.reps = 6 and l.entered_unit = 'lb' and l.visibility = 'friends') then
    raise exception '13: board entry has wrong values'; end if;
  if not exists (select 1 from public.lifts where id = lift and performed_at = (select performed_at from public.training_sets where id = s2)) then
    raise exception '13: date not carried over'; end if;
  begin perform public.submit_training_set(s2, 'public', '{}'); raise exception '14: submitted twice';
  exception when others then if sqlerrm <> 'already_submitted' then raise; end if; end;
  if (select count(*) from public.lifts where user_id = a and deleted_at is null) <> 1 then raise exception '14: duplicate lift'; end if;

  -- Linked set: numbers locked, notes-free fields fine; deleting it leaves the board entry.
  begin perform public.update_training_set(s2, 225, 'lb', 6, null, null); raise exception 'linked set edited';
  exception when others then if sqlerrm <> 'training_set_submitted' then raise; end if; end;
  perform public.delete_training_set(s2);
  if not exists (select 1 from public.lifts where id = lift and deleted_at is null and entered_weight = 205 and training_set_id is null) then
    raise exception 'deleting the source set changed the board entry'; end if;

  -- 10. Delete a personal set.
  perform public.delete_training_set(s3);
  if exists (select 1 from public.training_sets where id = s3) then raise exception '10: not deleted'; end if;

  -- PR suggestion: "Not now" is remembered and publishes nothing.
  perform public.dismiss_training_pr(s1);
  if not (select pr_dismissed from public.training_sets where id = s1) then raise exception '15: dismissal not saved'; end if;
  if (select count(*) from public.lifts where user_id = a) <> 1 then raise exception '15: dismissing published something'; end if;

  -- 5. Customize: rename, replace, reorder, set counts; add and delete a day.
  perform public.save_training_day(upper, 'Upper A', jsonb_build_array(
    jsonb_build_object('exercise_id', pulldown, 'set_count', 4), jsonb_build_object('exercise_id', squat, 'set_count', 1)));
  if (select name from public.training_days where id = upper) <> 'Upper A' then raise exception '5: rename'; end if;
  if (select exercise_id from public.training_day_exercises where day_id = upper and position = 0) <> pulldown then raise exception '5: reorder'; end if;
  if (select set_count from public.training_day_exercises where day_id = upper and position = 0) <> 4 then raise exception '5: set count'; end if;
  -- Bench was replaced in the routine, but its history stays.
  if (select count(*) from public.training_sets where user_id = a and exercise_id = bench) <> 3 then raise exception '5: replacing lost history'; end if;
  d := public.add_training_day(split, 'Arms');
  perform public.delete_training_day(d);
  begin perform public.save_training_day(upper, 'x', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 50))); raise exception '5: 50 sets allowed';
  exception when others then if sqlerrm <> 'invalid_set_count' then raise; end if; end;

  -- 2-4, 19. Import PPL, A/P and an infinite rotation; history stays, one active split.
  split2 := public.import_training_split('Push / Pull / Legs', 'ppl', 'infinite', jsonb_build_array(
    jsonb_build_object('name', 'Push', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', bench, 'set_count', 3))),
    jsonb_build_object('name', 'Pull', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', pulldown, 'set_count', 3))),
    jsonb_build_object('name', 'Legs', 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', squat, 'set_count', 3)))));
  perform public.import_training_split('Anterior / Posterior', 'ap', '3x', jsonb_build_array(
    jsonb_build_object('name', 'Anterior', 'exercises', '[]'::jsonb), jsonb_build_object('name', 'Posterior', 'exercises', '[]'::jsonb)));
  if (select count(*) from public.training_splits where user_id = a and is_active) <> 1 then raise exception '19: more than one active split'; end if;
  if (select count(*) from public.training_sets where user_id = a) <> 4 then raise exception '19: changing splits lost sets'; end if;
  perform public.set_active_training_split(split);
  if not (select is_active from public.training_splits where id = split) then raise exception '19: switch back'; end if;
  begin perform public.import_training_split('x', 'ul', 'weekly', '[{"name":"A","exercises":[]}]'); raise exception 'bad rotation accepted';
  exception when others then if sqlerrm <> 'invalid_rotation' then raise; end if; end;

  -- 16. Every lift that existed before is untouched.
  if (select md5(coalesce(string_agg(id::text || weight_kg || reps || coalesce(score, 0) || verification_status || visibility || performed_at, ',' order by id), ''))
      from public.lifts where user_id not in (a, b)) <> lifts_before then raise exception '16: existing lifts changed'; end if;
end;
$$;
select 'all passed' as result;
