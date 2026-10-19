-- Functional test for migration 0017 (unilateral sets), always rolled back:
--   (echo "begin;"; cat <snapshot>; cat supabase/migrations/20261011001700_*.sql tests/sql/1700_*.test.sql; echo "rollback;")
-- Expects temp table before_0017 (taken just before the migration). Raises at the first failure.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000d001';
  b uuid := '00000000-0000-4000-8000-00000000d002';
  curl uuid := (select id from public.exercises where slug = 'dumbbell-curl');
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  today date := (now() at time zone 'America/Los_Angeles')::date;
  r jsonb; l1 uuid; r1 uuid; b1 uuid; n int;
begin
  -- 1. Existing data: training rows keep no side and are otherwise identical; lifts and other exercise columns untouched.
  if exists (select 1 from public.training_sets where side is not null) then raise exception '1: an existing set got a side'; end if;
  if (select count(*)::text from public.training_sets) <> (select v from before_0017 where kind = 'sets_n') then raise exception '1: set count changed'; end if;
  if (select md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.id), '')) from public.lifts l) <> (select v from before_0017 where kind = 'lifts') then
    raise exception '1: lifts changed'; end if;
  if (select count(*) from public.exercises where supports_unilateral) <> 28 then raise exception '1: expected 28 unilateral exercises'; end if;
  if (select supports_unilateral from public.exercises where slug = 'barbell-bench-press')
     or (select supports_unilateral from public.exercises where slug = 'pull-up')
     or not (select supports_unilateral from public.exercises where slug = 'bulgarian-split-squat') then raise exception '1: wrong flags'; end if;

  insert into auth.users (id, email) values (a, 't1700a@example.com'), (b, 't1700b@example.com');
  update public.profiles set username = 't1700_' || substr(id::text, 33) where id in (a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);

  -- 2. Preference: only where unilateral makes sense; private.
  perform public.set_unilateral_preference(curl, true);
  begin perform public.set_unilateral_preference(bench, true); raise exception '2: barbell bench accepted unilateral';
  exception when others then if sqlerrm <> 'unilateral_not_supported' then raise; end if; end;
  perform public.set_unilateral_preference(bench, false); -- turning it off is always fine
  if not (select unilateral from public.exercise_preferences where user_id = a and exercise_id = curl) then raise exception '2: preference not saved'; end if;

  -- 3. Left and right are separate slots; double taps don't duplicate; bilateral still works alongside.
  l1 := (public.log_training_set(curl, null, 1, 30, 'lb', 10, today, now(), gen_random_uuid(), 'left') ->> 'id')::uuid;
  r1 := (public.log_training_set(curl, null, 1, 25, 'lb', 12, today, now(), gen_random_uuid(), 'right') ->> 'id')::uuid;
  r := public.log_training_set(curl, null, 1, 35, 'lb', 8, today, now(), gen_random_uuid(), 'left');
  if not (r ->> 'duplicate')::boolean or (r ->> 'id')::uuid <> l1 then raise exception '3: left set 1 saved twice'; end if;
  -- Old-style call (no side), as the current app sends: a bilateral set, separate from L/R.
  b1 := (public.log_training_set(p_exercise_id => curl, p_day_id => null, p_set_number => 1, p_weight => 60, p_unit => 'lb', p_reps => 8,
    p_local_date => today, p_performed_at => now(), p_client_key => gen_random_uuid()) ->> 'id')::uuid;
  if (select side from public.training_sets where id = b1) is not null then raise exception '3: bilateral got a side'; end if;
  r := public.log_training_set(curl, null, 1, 65, 'lb', 8, today, now(), gen_random_uuid());
  if not (r ->> 'duplicate')::boolean then raise exception '3: bilateral set 1 saved twice'; end if;
  if (select count(*) from public.training_sets where user_id = a) <> 3 then raise exception '3: expected 3 sets'; end if;
  if (select side from public.training_sets where id = l1) <> 'left' or (select side from public.training_sets where id = r1) <> 'right' then raise exception '3: sides'; end if;

  -- 4. Sides are refused where they make no sense; bad values are refused.
  begin perform public.log_training_set(bench, null, 1, 135, 'lb', 5, today, now(), gen_random_uuid(), 'left'); raise exception '4: side on barbell bench';
  exception when others then if sqlerrm <> 'unilateral_not_supported' then raise; end if; end;
  begin perform public.log_training_set(curl, null, 2, 30, 'lb', 10, today, now(), gen_random_uuid(), 'up'); raise exception '4: bad side';
  exception when others then if sqlerrm <> 'invalid_side' then raise; end if; end;

  -- 5. One-side sets never prompt a PR, even when heavier than every earlier set.
  perform public.log_training_set(curl, null, 1, 20, 'lb', 8, today - 1, now() - interval '1 day', gen_random_uuid());
  r := public.log_training_set(curl, null, 2, 90, 'lb', 8, today, now(), gen_random_uuid(), 'left');
  if (r ->> 'is_pr')::boolean then raise exception '5: a one-side set was called a PR'; end if;

  -- 6. Edits keep the side unless asked; moving onto a taken slot is refused; 'none' makes it bilateral.
  perform public.update_training_set(l1, 32.5, 'lb', 10, null, null);
  if (select side from public.training_sets where id = l1) <> 'left' or (select entered_weight from public.training_sets where id = l1) <> 32.5 then
    raise exception '6: edit lost the side'; end if;
  begin perform public.update_training_set(l1, 32.5, 'lb', 10, null, null, 'right'); raise exception '6: moved onto the right slot';
  exception when others then if sqlerrm <> 'set_slot_taken' then raise; end if; end;
  perform public.update_training_set(r1, 25, 'lb', 12, today - 2, now() - interval '2 days', 'none');
  if (select side from public.training_sets where id = r1) is not null then raise exception '6: side not cleared'; end if;
  begin perform public.update_training_set(b1, 60, 'lb', 8, null, null, 'left'); raise exception '6: left slot 1 is taken';
  exception when others then if sqlerrm <> 'set_slot_taken' then raise; end if; end;

  -- 7. One-side sets can't go on the boards.
  begin perform public.submit_training_set(l1, 'public', '{}'); raise exception '7: one-side set submitted';
  exception when others then if sqlerrm <> 'unilateral_not_on_boards' then raise; end if; end;
  if exists (select 1 from public.lifts where user_id = a) then raise exception '7: a lift was created'; end if;

  -- 8. Another account can't read or change any of it.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.training_sets; if n <> 0 then raise exception '8: other user reads sets'; end if;
  select count(*) into n from public.exercise_preferences; if n <> 0 then raise exception '8: other user reads preferences'; end if;
  begin
    insert into public.exercise_preferences (user_id, exercise_id, unilateral) values (a, curl, false);
    raise exception '8: direct write allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  begin perform public.update_training_set(l1, 100, 'lb', 1, null, null, 'right'); raise exception '8: other user edited';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
end;
$$;
select 'all passed' as result;
