-- Functional test for migration 0014, run against a real database inside a
-- transaction that is always rolled back (nothing persists):
--   (echo "begin;"; cat supabase/migrations/20261011001400_*.sql tests/sql/1400_*.test.sql; echo "rollback;") > /tmp/t.sql
--   npx supabase db query --linked -f /tmp/t.sql
-- Raises an exception at the first failed expectation; prints "all passed" otherwise.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000a001';
  b uuid := '00000000-0000-4000-8000-00000000a002';
  c uuid := '00000000-0000-4000-8000-00000000a003';
  d uuid := '00000000-0000-4000-8000-00000000a004';
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  dl uuid := (select id from public.exercises where slug = 'deadlift');
  g uuid; tok text; lift_a uuid; lift_b uuid; r jsonb; n int; ok boolean; v record;
  key text;
  procedure_as text;
begin
  insert into auth.users (id, email) values (a, 't1400a@example.com'), (b, 't1400b@example.com'), (c, 't1400c@example.com'), (d, 't1400d@example.com');
  update public.profiles set username = 't1400_' || substr(id::text, 33) where id in (a, b, c, d);

  -- group of three, all lifting bench
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  g := public.create_group('T1400 crew');
  tok := (public.create_group_invite(g, 1, 5)) ->> 'token';
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true); perform public.accept_group_invite(tok);
  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, true); perform public.accept_group_invite(tok);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  lift_a := (public.submit_lift(bench, 200, 'lb', 5, null, 'public', '{}', null, gen_random_uuid())) ->> 'lift_id';
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  lift_b := (public.submit_lift(bench, 210, 'lb', 5, null, 'public', '{}', null, gen_random_uuid())) ->> 'lift_id';
  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, true);
  perform public.submit_lift(bench, 190, 'lb', 5, null, 'public', '{}', null, gen_random_uuid());
  if (select user_id from public.record_history where board_key = 'group:' || g || ':' || bench and until is null) <> b then
    raise exception 'setup: b should be champion'; end if;

  -- 1. editing the weight up recalculates the title and leaves an audit row, no new activity
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  insert into public.activities (actor_id, type, lift_id, exercise_id) values (a, 'pr', lift_a, bench); -- a stale feed item
  r := public.edit_lift(lift_a, bench, 230, 'lb', 5, (select performed_at from public.lifts where id = lift_a), 'public', '{}', null, null, null);
  if not (r ->> 'performance_changed')::boolean then raise exception '1: performance change not detected'; end if;
  if (select user_id from public.record_history where board_key = 'group:' || g || ':' || bench and until is null) <> a then
    raise exception '1: title not recalculated after edit'; end if;
  if (select count(*) from public.lift_edits where lift_id = lift_a) <> 1 then raise exception '1: no audit row'; end if;
  if exists (select 1 from public.activities where lift_id = lift_a) then raise exception '1: stale activity kept'; end if;
  if (select score from public.lifts where id = lift_a) <= (select score from public.lifts where id = lift_b) then raise exception '1: score not recomputed'; end if;

  -- 2. notes only: verification and video kept, no audit row
  update public.lifts set verification_status = 'verified', video_path = 'x/y/z.mp4' where id = lift_a;
  r := public.edit_lift(lift_a, bench, 230, 'lb', 5, (select performed_at from public.lifts where id = lift_a), 'public', '{}', 'Belt, no straps', null, null);
  select * into v from public.lifts where id = lift_a;
  if v.verification_status <> 'verified' or v.video_path is null or v.notes <> 'Belt, no straps' then raise exception '2: notes-only edit touched verification'; end if;
  if (select count(*) from public.lift_edits where lift_id = lift_a) <> 1 then raise exception '2: notes-only edit audited'; end if;

  -- 3. visibility only: verification kept, audited
  r := public.edit_lift(lift_a, bench, 230, 'lb', 5, v.performed_at, 'friends', '{}', 'Belt, no straps', null, null);
  if (select verification_status from public.lifts where id = lift_a) <> 'verified' then raise exception '3: visibility edit cleared verification'; end if;
  if (select count(*) from public.lift_edits where lift_id = lift_a) <> 2 then raise exception '3: visibility edit not audited'; end if;

  -- 4. reps change: verification cleared, video handed back for removal, open request withdrawn
  insert into public.lift_challenges (lift_id, challenger_id, challenged_user_id) values (lift_a, b, a);
  r := public.edit_lift(lift_a, bench, 230, 'lb', 4, v.performed_at, 'public', '{}', null, null, null);
  select * into v from public.lifts where id = lift_a;
  if v.verification_status <> 'unverified' or v.video_path is not null then raise exception '4: verification survived a performance edit'; end if;
  if r -> 'remove_paths' ->> 0 is distinct from 'x/y/z.mp4' then raise exception '4: old video not returned for removal'; end if;
  if exists (select 1 from public.lift_challenges where lift_id = lift_a and status in ('open', 'proof_submitted')) then raise exception '4: proof request left open'; end if;

  -- 5. ownership and validation are enforced
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  begin perform public.edit_lift(lift_a, bench, 100, 'lb', 5, now(), 'public', '{}', null, null, null); raise exception '5: edited someone else''s lift';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  begin perform public.edit_lift(lift_a, bench, 5000, 'kg', 5, now(), 'public', '{}', null, null, null); raise exception '5: weight cap ignored';
  exception when others then if sqlerrm <> 'weight_too_high' then raise; end if; end;
  begin perform public.edit_lift(lift_a, bench, 200, 'lb', 5, now() + interval '2 days', 'public', '{}', null, null, null); raise exception '5: future date allowed';
  exception when others then if sqlerrm <> 'future_date' then raise; end if; end;
  begin perform public.edit_lift(lift_a, bench, 200, 'lb', 0, now(), 'public', '{}', null, null, null); raise exception '5: zero reps allowed';
  exception when others then if sqlerrm <> 'invalid_reps' then raise; end if; end;
  begin perform public.edit_lift(lift_a, bench, 200, 'lb', 5, now(), 'groups', array[gen_random_uuid()], null, null, null); raise exception '5: foreign group allowed';
  exception when others then if sqlerrm <> 'not_a_member' then raise; end if; end;

  -- 6. exercise change moves the lift between boards and titles
  r := public.edit_lift(lift_a, dl, 315, 'lb', 3, v.performed_at, 'public', '{}', null, null, null);
  if (select user_id from public.record_history where board_key = 'group:' || g || ':' || bench and until is null) <> b then
    raise exception '6: bench title not handed back'; end if;
  if (select exercise_id from public.lifts where id = lift_a) <> dl then raise exception '6: exercise not changed'; end if;

  -- 7. audit rows are visible to their owner only (RLS)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.lift_edits where lift_id = lift_a) <> 0 then raise exception '7: audit visible to others'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  if (select count(*) from public.lift_edits where lift_id = lift_a) = 0 then raise exception '7: owner can''t read audit'; end if;
  reset role;

  -- 8. friend invite links: preview, deliberate accept, idempotent, blocks win
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  key := public.create_friend_invite();
  if (select count(*) from public.friend_invites where token_hash = key) <> 0 then raise exception '8: token stored in plain text'; end if;
  perform set_config('request.jwt.claims', '', true);
  r := public.get_friend_invite_preview(key);
  if not (r ->> 'valid')::boolean or r -> 'inviter' ->> 'username' is null then raise exception '8: preview failed signed out'; end if;
  if not (public.get_friend_invite_preview(repeat('0', 64)) ->> 'valid')::boolean is false then raise exception '8: bad token previewed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, true);
  if exists (select 1 from public.friendships where least(requester_id, addressee_id) = least(a, c) and greatest(requester_id, addressee_id) = greatest(a, c)) then
    raise exception '8: previewing created a friendship'; end if;
  r := public.accept_friend_invite(key);
  if r ->> 'status' <> 'friends' or not public._friends(a, c) then raise exception '8: accept failed'; end if;
  if (public.accept_friend_invite(key)) ->> 'status' <> 'already_friends' then raise exception '8: second accept not idempotent'; end if;
  if not exists (select 1 from public.notifications where recipient_id = a and actor_id = c and type = 'friend_accepted') then raise exception '8: inviter not told'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  begin perform public.accept_friend_invite(key); raise exception '8: self-accept allowed';
  exception when others then if sqlerrm <> 'invalid_user' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', d)::text, true);
  perform public.block_user(a);
  begin perform public.accept_friend_invite(key); raise exception '8: blocked user could accept';
  exception when others then if sqlerrm <> 'invalid_user' then raise; end if; end;
  begin perform public.accept_friend_invite(repeat('0', 64)); raise exception '8: invalid token accepted';
  exception when others then if sqlerrm <> 'invite_invalid' then raise; end if; end;

  -- 9. grants
  if has_function_privilege('anon', 'public.accept_friend_invite(text)', 'execute') then raise exception '9: anon can accept'; end if;
  if not has_function_privilege('anon', 'public.get_friend_invite_preview(text)', 'execute') then raise exception '9: anon can''t preview'; end if;
  if has_function_privilege('anon', 'public.edit_lift(uuid, uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid, uuid)', 'execute') then raise exception '9: anon can edit'; end if;
  if has_table_privilege('authenticated', 'public.friend_invites', 'select') then raise exception '9: invites readable'; end if;
  if has_table_privilege('authenticated', 'public.lift_edits', 'insert') then raise exception '9: audit writable'; end if;

  raise notice 'all passed';
end $$;
select 'all passed' as result;
