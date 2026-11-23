-- Functional test for migration 0024, always rolled back (ends in an exception):
--   (echo "begin;"; cat supabase/migrations/20261011002400_*.sql tests/sql/2400_*.test.sql; echo "rollback;")
do $$
declare
  u uuid := '00000000-0000-4000-8000-00000000f401';
  e1 text := repeat('a', 64); e2 text := repeat('b', 64); ip1 text := repeat('c', 64); ip2 text := repeat('d', 64);
  r jsonb; n int;
begin
  -- 1. Sign-in: 10 failures for one email block it (any IP); other emails from another IP are fine.
  for i in 1..9 loop perform public.auth_throttle_record('signin', e1, ip1, false); end loop;
  if not (public.auth_throttle_check('signin', e1, ip2) ->> 'allowed')::boolean then raise exception '1: blocked after 9'; end if;
  perform public.auth_throttle_record('signin', e1, ip1, false);
  r := public.auth_throttle_check('signin', e1, ip2);
  if (r ->> 'allowed')::boolean or (r ->> 'retry_after_s')::int not between 1 and 900 then raise exception '1: not blocked after 10: %', r; end if;
  if not (public.auth_throttle_check('signin', e2, ip2) ->> 'allowed')::boolean then raise exception '1: other email blocked'; end if;
  -- A success clears that email's failures.
  perform public.auth_throttle_record('signin', e1, ip1, true);
  if not (public.auth_throttle_check('signin', e1, ip2) ->> 'allowed')::boolean then raise exception '1: success did not clear'; end if;
  -- 30 failures from one IP (spread over many emails) block that IP.
  for i in 1..30 loop perform public.auth_throttle_record('signin', md5(i::text) || md5(i::text), ip2, false); end loop;
  if (public.auth_throttle_check('signin', e2, ip2) ->> 'allowed')::boolean then raise exception '1: IP not blocked after 30'; end if;
  if not (public.auth_throttle_check('signin', e2, ip1) ->> 'allowed')::boolean then raise exception '1: other IP blocked'; end if;

  -- 2. Sign-up: 5 per IP per hour.
  for i in 1..5 loop perform public.auth_throttle_record('signup', null, ip1, true); end loop;
  if (public.auth_throttle_check('signup', null, ip1) ->> 'allowed')::boolean then raise exception '2: 6th sign-up allowed'; end if;
  if not (public.auth_throttle_check('signup', null, ip2) ->> 'allowed')::boolean then raise exception '2: other IP blocked'; end if;
  -- Old rows are pruned and stop counting.
  update public.auth_attempts set at = now() - interval '2 days';
  perform public.auth_throttle_check('signin', e1, ip1);
  if exists (select 1 from public.auth_attempts) then raise exception '2: old rows not pruned'; end if;

  -- 3. Only the server can call the throttle; nobody can read the table.
  if has_function_privilege('authenticated', 'public.auth_throttle_check(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.auth_throttle_record(text, text, text, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.auth_throttle_check(text, text, text)', 'execute')
     or has_table_privilege('authenticated', 'public.auth_attempts', 'select') then raise exception '3: grants'; end if;

  -- 4. Analytics only through log_event: validated, capped, rate-limited.
  if has_table_privilege('authenticated', 'public.analytics_events', 'insert') then raise exception '4: direct insert still granted'; end if;
  if not has_function_privilege('authenticated', 'public.log_event(text, jsonb)', 'execute') or has_function_privilege('anon', 'public.log_event(text, jsonb)', 'execute') then
    raise exception '4: log_event grants'; end if;
  insert into auth.users (id, email) values (u, 't2400@example.com');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform public.log_event('lift_submitted', '{"exercise":"x"}');
  if (select count(*) from public.analytics_events where user_id = u and name = 'lift_submitted') <> 1 then raise exception '4: valid event not stored'; end if;
  begin perform public.log_event('Bad Name!', '{}'); raise exception '4: bad name accepted';
  exception when others then if sqlerrm <> 'invalid_request' then raise; end if; end;
  begin perform public.log_event('big', jsonb_build_object('x', repeat('y', 3000))); raise exception '4: 3 KB props accepted';
  exception when others then if sqlerrm <> 'invalid_request' then raise; end if; end;
  for i in 1..310 loop perform public.log_event('spam_test', '{}'); end loop;
  select count(*) into n from public.analytics_events where user_id = u;
  if n <> 300 then raise exception '4: expected 300 events in the hour, got %', n; end if;
  perform set_config('request.jwt.claims', '', true);
  begin perform public.log_event('lift_submitted', '{}'); raise exception '4: signed-out event accepted';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;

  -- 5. Every definer function still has an empty search_path.
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and not ('search_path=""' = any (coalesce(proconfig, '{}')))) then
    raise exception '5: search_path'; end if;

  raise exception 'TEST_2400_OK';
end $$;
