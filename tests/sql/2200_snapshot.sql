-- Runs just before migration 0022 in the rolled-back test: snapshot, plus a user who has 300 MB of
-- recordings under the old 500 MB allowance (so the test can check they're kept and uploads pause).
create temp table before_2200 as
select 'recordings' as k, md5(coalesce(string_agg(row_to_json(r)::text, ',' order by r.id), '')) as v from public.personal_recordings r
union all select 'plans', md5(string_agg(row_to_json(p)::text, ',' order by p.id)) from public.storage_plans p where id <> 'free'
union all select 'profiles', md5(coalesce(string_agg(row_to_json(p)::text, ',' order by p.id), '')) from public.profiles p;

do $$
declare
  u uuid := '00000000-0000-4000-8000-00000000f201';
  bench uuid := (select id from public.exercises where slug = 'barbell-bench-press');
  mb bigint := 1048576; r jsonb;
begin
  insert into auth.users (id, email) values (u, 't2200over@example.com');
  for i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    r := public.begin_recording(bench, 100 * mb, 'video/mp4', 60);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform public.finalize_recording(u, (r ->> 'id')::uuid, 100 * mb, 60, 1920, 1080);
  end loop;
end $$;
