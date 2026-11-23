-- Taken just before migration 0021 in the rolled-back test.
create temp table before_2100 as
select 'sblift_reserved' as k, public.is_reserved_username('sblift')::text as v
union all select 'acl', coalesce((select proacl::text from pg_proc where oid = 'public.is_reserved_username(text)'::regprocedure), '')
union all select 'config', coalesce((select proconfig::text from pg_proc where oid = 'public.is_reserved_username(text)'::regprocedure), '')
union all select 'profiles', md5(coalesce(string_agg(row_to_json(p)::text, ',' order by p.id), '')) from public.profiles p;
