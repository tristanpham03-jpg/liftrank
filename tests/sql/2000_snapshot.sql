-- Taken just before migration 0020 in the rolled-back test.
create temp table before_0020 as
select 'sets' as kind, md5(coalesce(string_agg(row_to_json(s)::text, ',' order by s.id), '')) as v from public.training_sets s
union all select 'sessions', md5(coalesce(string_agg(row_to_json(s)::text, ',' order by s.id), '')) from public.training_sessions s
union all select 'lifts', md5(coalesce(string_agg(row_to_json(l)::text, ',' order by l.id), '')) from public.lifts l;
