-- Functional test for migration 0022, always rolled back (ends in an exception):
--   (echo "begin;"; cat tests/sql/2200_snapshot.sql supabase/migrations/20261011002200_*.sql tests/sql/2200_*.test.sql; echo "rollback;")
do $$
declare
  over uuid := '00000000-0000-4000-8000-00000000f201';  -- 300 MB from before the change
  fresh uuid := '00000000-0000-4000-8000-00000000f202';
  pro uuid := '00000000-0000-4000-8000-00000000f203';
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  mb bigint := 1048576; r jsonb; v_rid uuid; v_key text;
  as_over text := json_build_object('sub', over, 'role', 'authenticated')::text;
  as_fresh text := json_build_object('sub', fresh, 'role', 'authenticated')::text;
begin
  -- 1. Plans: Free is 250 MB; Pro is unchanged; nothing else changed.
  if (select quota_bytes from public.storage_plans where id = 'free') <> 250 * mb then raise exception '1: free'; end if;
  if (select quota_bytes from public.storage_plans where id = 'pro') <> 5120 * mb then raise exception '1: pro'; end if;
  if (select md5(string_agg(row_to_json(p)::text, ',' order by p.id)) from public.storage_plans p where id <> 'free') <> (select v from before_2200 where k = 'plans') then
    raise exception '1: other plans changed'; end if;
  if (select md5(coalesce(string_agg(row_to_json(p)::text, ',' order by p.id), '')) from public.profiles p where p.id::text not like '00000000-0000-4000-8000-00000000f2%') <> (select v from before_2200 where k = 'profiles') then
    raise exception '1: profiles changed'; end if;

  -- 2. A user already over the new allowance keeps every recording, sees the new limit, and can't upload.
  if (select count(*) from public.personal_recordings where user_id = over and status = 'ready') <> 3 then raise exception '2: recordings lost'; end if;
  perform set_config('request.jwt.claims', as_over, true);
  r := public.get_recording_usage();
  if (r ->> 'used_bytes')::bigint <> 300 * mb or (r ->> 'quota_bytes')::bigint <> 250 * mb then raise exception '2: usage %', r; end if;
  begin perform public.begin_recording(bench, 1, 'video/mp4', 1); raise exception '2: upload allowed while over';
  exception when others then if sqlerrm <> 'storage_full' then raise; end if; end;
  -- Delete one (200 MB left): a 51 MB file still doesn't fit; 50 MB fits exactly; then nothing more.
  select id into v_rid from public.personal_recordings where user_id = over limit 1;
  v_key := public.delete_recording(v_rid);
  begin perform public.begin_recording(bench, 51 * mb, 'video/mp4', 10); raise exception '2: 51 MB allowed at 200 MB used';
  exception when others then if sqlerrm <> 'storage_full' then raise; end if; end;
  r := public.begin_recording(bench, 50 * mb, 'video/mp4', 10);
  begin perform public.begin_recording(bench, 1, 'video/mp4', 1); raise exception '2: reservation not counted';
  exception when others then if sqlerrm <> 'storage_full' then raise; end if; end;

  -- 3. A new user: reservations count against 250 MB (two 100 MB in flight, the third refused, 50 MB fits).
  insert into auth.users (id, email) values (fresh, 't2200fresh@example.com');
  perform set_config('request.jwt.claims', as_fresh, true);
  perform public.begin_recording(bench, 100 * mb, 'video/mp4', 30);
  perform public.begin_recording(bench, 100 * mb, 'video/mp4', 30);
  begin perform public.begin_recording(bench, 100 * mb, 'video/mp4', 30); raise exception '3: third 100 MB allowed';
  exception when others then if sqlerrm <> 'storage_full' then raise; end if; end;
  perform public.begin_recording(bench, 50 * mb, 'video/mp4', 10);
  if (public.get_recording_usage() ->> 'reserved_bytes')::bigint <> 250 * mb then raise exception '3: reserved'; end if;

  -- 4. Pro still gets 5 GB.
  insert into auth.users (id, email) values (pro, 't2200pro@example.com');
  insert into public.video_storage_accounts (user_id, plan_id) values (pro, 'pro');
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  if (public.get_recording_usage() ->> 'quota_bytes')::bigint <> 5120 * mb then raise exception '4: pro quota'; end if;
  perform public.begin_recording(bench, 100 * mb, 'video/mp4', 30);
  perform public.begin_recording(bench, 100 * mb, 'video/mp4', 30);
  perform public.begin_recording(bench, 100 * mb, 'video/mp4', 30);

  raise exception 'TEST_2200_OK';
end $$;
