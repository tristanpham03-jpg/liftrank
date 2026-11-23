-- Taken just before migration 0023 in the rolled-back test.
create temp table before_2300 as
select 'splits_cols' as k, md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) as v
  from (select id, user_id, name, template, rotation, is_active, created_at, null::uuid as import_key from public.training_splits) t
union all select 'sessions', md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.training_sessions t
union all select 'sets', md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.training_sets t
union all select 'lifts', md5(coalesce(string_agg(row_to_json(t)::text, ',' order by t.id), '')) from public.lifts t;
