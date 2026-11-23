-- Functional test for migration 0021, always rolled back (ends in an exception):
--   (echo "begin;"; cat tests/sql/2100_snapshot.sql supabase/migrations/20261011002100_*.sql tests/sql/2100_*.test.sql; echo "rollback;")
-- Expects temp table before_2100 (taken just before the migration).
do $$
declare
  u uuid := '00000000-0000-4000-8000-00000000f101';
  as_u text := json_build_object('sub', '00000000-0000-4000-8000-00000000f101', 'role', 'authenticated')::text;
  fn oid := 'public.is_reserved_username(text)'::regprocedure;
begin
  -- 1. Before: sblift was free. After: reserved in any case; the old list is intact; near-misses stay allowed.
  if (select v from before_2100 where k = 'sblift_reserved') <> 'false' then raise exception '1: sblift already reserved before'; end if;
  if not (public.is_reserved_username('sblift') and public.is_reserved_username('SBLift') and public.is_reserved_username('SBLIFT')) then
    raise exception '1: sblift not reserved'; end if;
  if not (public.is_reserved_username('liftrank') and public.is_reserved_username('admin') and public.is_reserved_username('anonymous')) then
    raise exception '1: an existing reserved name was lost'; end if;
  if public.is_reserved_username('sblifter') or public.is_reserved_username('sblift_1') or public.is_reserved_username('my_sblift') then
    raise exception '1: near-miss names blocked'; end if;
  if (select count(*) from unnest(regexp_match(pg_get_functiondef(fn), 'array\[(.*)\]')) x, regexp_matches(x, '''[a-z_]+''', 'g')) <> 40 then
    raise exception '1: expected exactly 40 reserved names (39 + sblift)'; end if;

  -- 2. Same function: immutable, not security definer, same grants and config as before.
  if (select provolatile from pg_proc where oid = fn) <> 'i' or (select prosecdef from pg_proc where oid = fn) then raise exception '2: properties changed'; end if;
  if coalesce((select proacl::text from pg_proc where oid = fn), '') <> (select v from before_2100 where k = 'acl')
     or coalesce((select proconfig::text from pg_proc where oid = fn), '') <> (select v from before_2100 where k = 'config') then
    raise exception '2: grants or config changed'; end if;

  -- 3. Existing data untouched, and every existing username is still valid.
  if (select md5(coalesce(string_agg(row_to_json(p)::text, ',' order by p.id), '')) from public.profiles p) <> (select v from before_2100 where k = 'profiles') then
    raise exception '3: profiles changed'; end if;
  if exists (select 1 from public.profiles where username is not null and public.is_reserved_username(username)) then
    raise exception '3: an existing username is now reserved'; end if;

  -- 4. Enforced on every path: the table constraint and complete_username.
  insert into auth.users (id, email) values (u, 'tres2100@example.com');
  begin
    update public.profiles set username = 'sblift' where id = u;
    raise exception '4: constraint allowed sblift';
  exception when check_violation then null; end;
  perform set_config('request.jwt.claims', as_u, true);
  begin
    perform public.complete_username('SBLift', 'Test');
    raise exception '4: complete_username allowed SBLift';
  exception when others then if sqlerrm not in ('username_reserved', 'invalid_username') then raise; end if; end;
  perform public.complete_username('sblift_fan', 'Test');
  if (select username from public.profiles where id = u) <> 'sblift_fan' then raise exception '4: near-miss username refused'; end if;

  raise exception 'TEST_2100_OK';
end $$;
