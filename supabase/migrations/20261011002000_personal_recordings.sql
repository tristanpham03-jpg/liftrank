-- 0020: My Recordings — private personal set videos (Phase 3).
--
-- Files live in a private Cloudflare R2 bucket; this database holds only
-- metadata, ownership, associations and storage accounting. The app signs
-- short-lived R2 URLs on the server after these functions say yes.
--
-- Additive: new tables and functions, plus finish_training_session redefined
-- with one addition (linking a recording to the set it was attached to while
-- the workout was in progress). No existing row is changed.
--
-- Upload lifecycle:
--   begin_recording   reserves the declared size under a per-user lock (so
--                     concurrent uploads can't overshoot the quota), returns a
--                     random object key. The app presigns a PUT for exactly
--                     that many bytes, valid for 15 minutes.
--   finalize_recording (server only, after it checked the stored object:
--                     size, type signature, real duration) marks it ready and
--                     records the actual stored bytes.
--   cancel_recording  gives the reservation back.
--   A pending reservation lapses after 30 minutes (longer than any upload URL
--   lives, so a lapsed reservation can never be filled later).
-- Every file that stops being needed (cancelled, failed, lapsed, deleted, or its
-- owner's account deleted) is queued in recording_object_deletions; the daily
-- job removes it from R2. Recordings are never deleted automatically.

-- ───────────── Plans ─────────────
create table public.storage_plans (
  id text primary key check (id ~ '^[a-z]{2,20}$'),
  label text not null,
  quota_bytes bigint not null check (quota_bytes > 0)
);
insert into public.storage_plans (id, label, quota_bytes) values
  ('free', 'Free', 524288000),     -- 500 MB
  ('pro', 'Pro', 5368709120);      -- 5 GB, for the future Pro tier (nobody is on it yet)

-- One row per user who has used recordings: their plan, and the row every
-- reservation locks, so one user's uploads are accounted one at a time.
-- Plan changes are server-side only (no grants to users).
create table public.video_storage_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan_id text not null default 'free' references public.storage_plans (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── Recordings ─────────────
create table public.personal_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  -- The working set it shows; null = the exercise in general. A deleted set leaves the recording on the exercise.
  training_set_id uuid references public.training_sets (id) on delete set null,
  -- Attached while a workout was in progress: the session, and the draft row ("<block>/<row>") until End saves that set.
  session_id uuid references public.training_sessions (id) on delete set null,
  draft_ref text check (draft_ref is null or char_length(draft_ref) between 1 and 120),
  -- Random, unguessable, never shown to users; only the server signs URLs for it.
  object_key text not null unique check (object_key ~ '^rec/[0-9a-f]{32}\.(mp4|mov|webm)$'),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  mime text not null check (mime in ('video/mp4', 'video/quicktime', 'video/webm')),
  -- Declared size, reserved until the upload is finalized; then the actual stored size.
  reserved_bytes bigint not null check (reserved_bytes between 1 and 104857600),
  bytes bigint check (bytes is null or bytes between 1 and 104857600),
  duration_s numeric(6, 2) check (duration_s is null or (duration_s > 0 and duration_s <= 90.5)),
  width integer check (width is null or width between 1 and 8192),
  height integer check (height is null or height between 1 and 8192),
  title text check (title is null or char_length(title) between 1 and 60),
  note text check (note is null or char_length(note) between 1 and 300),
  recorded_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status <> 'ready' or (bytes is not null and duration_s is not null and completed_at is not null))
);
create index personal_recordings_user_idx on public.personal_recordings (user_id, status);
create index personal_recordings_exercise_idx on public.personal_recordings (user_id, exercise_id, created_at desc);
create index personal_recordings_set_idx on public.personal_recordings (training_set_id) where training_set_id is not null;
create index personal_recordings_session_idx on public.personal_recordings (session_id) where session_id is not null;
create index personal_recordings_pending_idx on public.personal_recordings (expires_at) where status = 'pending';

-- Files to remove from R2. Filled by trigger whenever a recording row goes away.
create table public.recording_object_deletions (
  object_key text primary key,
  queued_at timestamptz not null default now()
);

-- Owner-only reads; every write goes through the functions below. No public access at all.
alter table public.storage_plans enable row level security;
alter table public.video_storage_accounts enable row level security;
alter table public.personal_recordings enable row level security;
alter table public.recording_object_deletions enable row level security;
revoke all on public.storage_plans, public.video_storage_accounts, public.personal_recordings, public.recording_object_deletions
  from anon, authenticated;
grant select on public.personal_recordings, public.video_storage_accounts, public.storage_plans to authenticated;
create policy storage_plans_read on public.storage_plans for select to authenticated using (true);
create policy video_storage_accounts_own on public.video_storage_accounts for select to authenticated using (user_id = auth.uid());
create policy personal_recordings_own on public.personal_recordings for select to authenticated using (user_id = auth.uid());

-- A recording row that goes away for any reason (deleted, cancelled, lapsed,
-- or its owner's account deleted) queues its file for removal.
create function public._queue_recording_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.recording_object_deletions (object_key) values (old.object_key) on conflict do nothing;
  return old;
end;
$$;
create trigger personal_recordings_queue_object after delete on public.personal_recordings
  for each row execute function public._queue_recording_object();

-- A workout that ends (saved or discarded) leaves any recording still waiting
-- for a draft set on the exercise. Recordings are never deleted here.
create function public._release_draft_recordings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.personal_recordings set draft_ref = null where session_id = new.id and draft_ref is not null;
  return new;
end;
$$;
create trigger training_sessions_release_recordings after update of status on public.training_sessions
  for each row when (old.status = 'active' and new.status <> 'active')
  execute function public._release_draft_recordings();

-- ───────────── Limits and usage ─────────────
create function public._recording_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'max_bytes', 104857600,        -- 100 MB per original file
    'max_seconds', 90,
    'uploads_per_day', 60,
    'pending_minutes', 30,         -- a reservation lapses after this (upload URLs live 15 minutes)
    'max_pending', 4               -- uploads in flight at once, per user
  )
$$;

-- Bytes in use: finalized files at their actual size, plus live reservations.
create function public._recording_usage(p_uid uuid)
returns table (used_bytes bigint, reserved_bytes bigint, ready_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(r.bytes) filter (where r.status = 'ready'), 0)::bigint,
    coalesce(sum(r.reserved_bytes) filter (where r.status = 'pending' and r.expires_at > now()), 0)::bigint,
    (count(*) filter (where r.status = 'ready'))::integer
  from public.personal_recordings r
  where r.user_id = p_uid
$$;

create function public._recording_quota(p_uid uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.quota_bytes from public.video_storage_accounts a join public.storage_plans p on p.id = a.plan_id where a.user_id = p_uid),
    (select quota_bytes from public.storage_plans where id = 'free'))
$$;

-- What Settings shows: used / quota (and what's mid-upload).
create function public.get_recording_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_u record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_u from public._recording_usage(v_uid);
  return jsonb_build_object(
    'used_bytes', v_u.used_bytes,
    'reserved_bytes', v_u.reserved_bytes,
    'count', v_u.ready_count,
    'quota_bytes', public._recording_quota(v_uid),
    'plan', coalesce((select plan_id from public.video_storage_accounts where user_id = v_uid), 'free'),
    'limits', public._recording_limits()
  );
end;
$$;

-- ───────────── Upload ─────────────
-- Reserve space for one upload. Everything the client says is checked here:
-- the exercise exists, the set (if any) is the caller's and is that exercise,
-- the session (if any) is the caller's active one, and the size, type and
-- length are within limits. Fails with storage_full before anything is uploaded.
create function public.begin_recording(
  p_exercise_id uuid, p_bytes bigint, p_mime text, p_seconds numeric,
  p_set_id uuid default null, p_session_id uuid default null, p_draft_ref text default null,
  p_recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public._recording_limits();
  v_u record;
  v_quota bigint;
  v_set public.training_sets%rowtype;
  v_key text;
  v_id uuid := gen_random_uuid();
  v_expires timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.exercises where id = p_exercise_id and is_active) then raise exception 'not_found'; end if;
  if p_mime is null or p_mime not in ('video/mp4', 'video/quicktime', 'video/webm') then raise exception 'invalid_video_type'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > (v_lim ->> 'max_bytes')::bigint then raise exception 'video_too_large'; end if;
  if p_seconds is null or p_seconds <= 0 or p_seconds > (v_lim ->> 'max_seconds')::numeric + 0.5 then raise exception 'video_too_long'; end if;
  if p_set_id is not null and p_draft_ref is not null then raise exception 'invalid_request'; end if;
  if p_set_id is not null then
    select * into v_set from public.training_sets where id = p_set_id and user_id = v_uid;
    if v_set.id is null or v_set.exercise_id <> p_exercise_id then raise exception 'not_found'; end if;
  end if;
  if p_draft_ref is not null then
    if char_length(p_draft_ref) not between 1 and 120 then raise exception 'invalid_request'; end if;
    if p_session_id is null then raise exception 'invalid_request'; end if;
  end if;
  if p_session_id is not null and not exists (
    select 1 from public.training_sessions where id = p_session_id and user_id = v_uid and (status = 'active' or p_draft_ref is null)
  ) then raise exception 'not_found'; end if;
  if p_recorded_at is not null and (p_recorded_at > now() + interval '1 day' or p_recorded_at < timestamptz '2000-01-01') then
    p_recorded_at := null;
  end if;

  -- One user's reservations are decided one at a time: lock their account row.
  insert into public.video_storage_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  perform 1 from public.video_storage_accounts where user_id = v_uid for update;

  -- Lapsed reservations are given back (their files, if any, are removed by the daily job).
  delete from public.personal_recordings where user_id = v_uid and status = 'pending' and expires_at <= now();

  if (select count(*) from public.personal_recordings where user_id = v_uid and status = 'pending') >= (v_lim ->> 'max_pending')::integer then
    raise exception 'too_many_uploads';
  end if;
  if (select count(*) from public.personal_recordings where user_id = v_uid and created_at > now() - interval '24 hours')
     >= (v_lim ->> 'uploads_per_day')::integer then
    raise exception 'too_many_uploads';
  end if;

  select * into v_u from public._recording_usage(v_uid);
  v_quota := public._recording_quota(v_uid);
  if v_u.used_bytes + v_u.reserved_bytes + p_bytes > v_quota then raise exception 'storage_full'; end if;

  v_key := 'rec/' || replace(gen_random_uuid()::text, '-', '') || case p_mime
    when 'video/mp4' then '.mp4' when 'video/quicktime' then '.mov' else '.webm' end;
  v_expires := now() + make_interval(mins => (v_lim ->> 'pending_minutes')::integer);
  insert into public.personal_recordings (id, user_id, exercise_id, training_set_id, session_id, draft_ref, object_key, mime,
    reserved_bytes, duration_s, recorded_at, expires_at)
  values (v_id, v_uid, p_exercise_id, p_set_id, case when p_set_id is null then p_session_id else v_set.session_id end,
    p_draft_ref, v_key, p_mime, p_bytes, p_seconds, p_recorded_at, v_expires);
  update public.video_storage_accounts set updated_at = now() where user_id = v_uid;

  return jsonb_build_object('id', v_id, 'object_key', v_key, 'bytes', p_bytes, 'mime', p_mime, 'expires_at', v_expires);
end;
$$;

-- Server only (secret key; execute is granted to service_role alone), after the server checked the stored object itself:
-- p_bytes is the object's real size and p_seconds its real duration. Anything
-- that doesn't match the reservation is rejected and the reservation dropped.
create function public.finalize_recording(p_user_id uuid, p_id uuid, p_bytes bigint, p_seconds numeric,
  p_width integer default null, p_height integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.personal_recordings%rowtype;
  v_lim jsonb := public._recording_limits();
begin
  perform 1 from public.video_storage_accounts where user_id = p_user_id for update;
  select * into v_r from public.personal_recordings where id = p_id and user_id = p_user_id for update;
  if v_r.id is null then raise exception 'not_found'; end if;
  if v_r.status = 'ready' then return jsonb_build_object('ok', true, 'already', true, 'bytes', v_r.bytes); end if;
  if v_r.expires_at <= now() then
    delete from public.personal_recordings where id = v_r.id;
    return jsonb_build_object('ok', false, 'error', 'upload_expired');
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > v_r.reserved_bytes then
    delete from public.personal_recordings where id = v_r.id;
    return jsonb_build_object('ok', false, 'error', 'upload_size_mismatch');
  end if;
  if p_seconds is null or p_seconds <= 0 or p_seconds > (v_lim ->> 'max_seconds')::numeric + 0.5 then
    delete from public.personal_recordings where id = v_r.id;
    return jsonb_build_object('ok', false, 'error', 'video_too_long');
  end if;
  update public.personal_recordings set
    status = 'ready', bytes = p_bytes, duration_s = round(p_seconds, 2), completed_at = now(),
    width = case when p_width between 1 and 8192 then p_width end,
    height = case when p_height between 1 and 8192 then p_height end
  where id = v_r.id;
  return jsonb_build_object('ok', true, 'already', false, 'bytes', p_bytes);
end;
$$;

-- Give back an upload's reservation (cancelled or failed). Ready recordings aren't touched.
create function public.cancel_recording(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.personal_recordings where id = p_id and user_id = v_uid and status = 'pending';
end;
$$;

-- Delete one of your recordings. Its space is free at once; the file is removed from R2 (now, and by the daily job as a backstop).
create function public.delete_recording(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.personal_recordings where id = p_id and user_id = v_uid returning object_key into v_key;
  if v_key is null then raise exception 'not_found'; end if;
  return v_key;
end;
$$;

-- Rename, annotate, or move a recording to another of your sets of the same
-- exercise (or to the exercise in general). Never re-uploads anything.
create function public.update_recording(p_id uuid, p_title text, p_note text, p_set_id uuid, p_exercise_level boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_r public.personal_recordings%rowtype;
  v_set public.training_sets%rowtype;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_r from public.personal_recordings where id = p_id and user_id = v_uid for update;
  if v_r.id is null then raise exception 'not_found'; end if;
  if v_title is not null and char_length(v_title) > 60 then raise exception 'title_too_long'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'notes_too_long'; end if;
  if p_set_id is not null then
    select * into v_set from public.training_sets where id = p_set_id and user_id = v_uid;
    if v_set.id is null or v_set.exercise_id <> v_r.exercise_id then raise exception 'not_found'; end if;
  end if;
  update public.personal_recordings set
    title = v_title,
    note = v_note,
    training_set_id = case when p_set_id is not null then p_set_id when p_exercise_level then null else training_set_id end,
    session_id = case when p_set_id is not null then v_set.session_id else session_id end,
    draft_ref = case when p_set_id is not null or p_exercise_level then null else draft_ref end
  where id = v_r.id;
end;
$$;

-- ───────────── Cleanup ─────────────
-- Daily job (secret key): drop lapsed reservations, then hand back up to 1000
-- queued object keys. The job deletes them from R2 and then calls
-- recording_objects_removed with the ones it removed.
create function public.recording_maintenance()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
begin
  delete from public.personal_recordings where status = 'pending' and expires_at <= now();
  select coalesce(array_agg(object_key order by queued_at), '{}') into v_keys
  from (select object_key, queued_at from public.recording_object_deletions
        -- Only once every upload URL that could still write this key has expired (they live 15 minutes).
        where queued_at < now() - interval '20 minutes'
        order by queued_at limit 1000) q;
  return v_keys;
end;
$$;

create function public.recording_objects_removed(p_keys text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- Never forget a key that is (again) in use.
  delete from public.recording_object_deletions d
  where d.object_key = any (p_keys) and not exists (select 1 from public.personal_recordings r where r.object_key = d.object_key);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Account deletion: your files' keys, so the server can remove them right away
-- (the rows then go with the account, which queues them again as a backstop).
create function public.my_recording_keys()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(object_key), '{}') from public.personal_recordings where auth.uid() is not null and user_id = auth.uid()
$$;

-- ───────────── End of a workout: link recordings to the sets they were attached to ─────────────
create or replace function public.finish_training_session(p_session_id uuid, p_finish_key uuid, p_local_date date, p_sets jsonb,
  p_notes text, p_exercise_notes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.training_sessions%rowtype;
  v_item jsonb;
  v_vals record;
  v_ex uuid;
  v_side text;
  v_weight numeric;
  v_unit public.weight_unit;
  v_reps integer;
  v_rir smallint;
  v_num integer;
  v_counts jsonb := '{}'::jsonb;
  v_slot text;
  v_set_id uuid;
  v_ended timestamptz := now();
  v_bests jsonb := '{}'::jsonb;  -- exercise_id -> {best, prior}, taken before this session's sets are inserted
  v_b jsonb;
  v_rec record;
  v_prs jsonb := '[]'::jsonb;
  v_result jsonb;
  v_n integer := 0;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_finish_key is null then raise exception 'invalid_request'; end if;
  select * into v_s from public.training_sessions where id = p_session_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.status = 'completed' then
    if v_s.finish_key = p_finish_key then return v_s.result || jsonb_build_object('already', true); end if;
    raise exception 'session_already_ended';
  end if;
  if v_s.status <> 'active' then raise exception 'session_not_active'; end if;
  perform public._check_training_date(p_local_date, v_ended);
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) > 300 then raise exception 'invalid_request'; end if;
  if v_notes is not null and char_length(v_notes) > 1000 then raise exception 'notes_too_long'; end if;
  if p_exercise_notes is not null and (jsonb_typeof(p_exercise_notes) <> 'object' or pg_column_size(p_exercise_notes) >= 65536) then
    raise exception 'invalid_request';
  end if;

  for v_item in select * from jsonb_array_elements(p_sets) loop
    v_ex := (v_item ->> 'exercise_id')::uuid;
    v_side := nullif(v_item ->> 'side', '');
    v_weight := (v_item ->> 'weight')::numeric;
    v_unit := nullif(v_item ->> 'unit', '')::public.weight_unit;
    v_reps := (v_item ->> 'reps')::integer;
    v_rir := (v_item ->> 'rir')::smallint;
    if v_rir is not null and (v_rir < 0 or v_rir > 10) then raise exception 'invalid_rir'; end if;
    select * into v_vals from public._training_values(v_ex, v_weight, v_unit, v_reps);
    perform public._check_side(v_ex, v_side);
    if not v_bests ? v_ex::text then
      v_bests := v_bests || jsonb_build_object(v_ex::text, jsonb_build_object(
        'best', public._personal_best(v_uid, v_ex, null),
        'prior', exists (select 1 from public.training_sets where user_id = v_uid and exercise_id = v_ex and is_ranked and side is null and local_date < p_local_date)
              or exists (select 1 from public.lifts where user_id = v_uid and exercise_id = v_ex and is_ranked and deleted_at is null and invalidated_at is null)));
    end if;
    -- Set numbers count per exercise and side, in the order given.
    v_slot := v_ex::text || ':' || coalesce(v_side, '');
    v_num := coalesce((v_counts ->> v_slot)::integer, 0) + 1;
    if v_num > 30 then raise exception 'invalid_set_number'; end if;
    v_counts := v_counts || jsonb_build_object(v_slot, v_num);
    insert into public.training_sets (user_id, exercise_id, day_id, session_id, set_number, side, entered_weight, entered_unit,
      weight_kg, reps, rir, score, is_ranked, local_date, performed_at, client_key)
    values (v_uid, v_ex, v_s.day_id, v_s.id, v_num, v_side, v_weight, case when v_weight is null then null else v_unit end,
      v_vals.weight_kg, v_reps, v_rir, v_vals.score, v_vals.is_ranked, p_local_date, v_ended, gen_random_uuid())
    returning id into v_set_id;
    -- 0020: a recording attached to this draft row (same session and exercise) now belongs to the saved set.
    if nullif(v_item ->> 'ref', '') is not null then
      update public.personal_recordings set training_set_id = v_set_id, draft_ref = null
      where user_id = v_uid and session_id = v_s.id and draft_ref = v_item ->> 'ref' and exercise_id = v_ex and training_set_id is null;
    end if;
    v_n := v_n + 1;
  end loop;

  -- One PR suggestion per exercise: this session's best both-sides set, if it beats every earlier one.
  for v_rec in
    select distinct on (t.exercise_id) t.id, t.exercise_id, t.score
    from public.training_sets t
    where t.session_id = v_s.id and t.side is null and t.is_ranked
    order by t.exercise_id, t.score desc, t.set_number
  loop
    v_b := v_bests -> v_rec.exercise_id::text;
    if (v_b ->> 'prior')::boolean and v_b ->> 'best' is not null and v_rec.score > (v_b ->> 'best')::numeric then
      v_prs := v_prs || jsonb_build_object('set_id', v_rec.id, 'exercise_id', v_rec.exercise_id);
    end if;
  end loop;

  v_result := jsonb_build_object('session_id', v_s.id, 'sets', v_n, 'prs', v_prs);
  update public.training_sessions set
    status = 'completed', ended_at = v_ended, local_date = p_local_date, finish_key = p_finish_key,
    result = v_result, notes = v_notes, exercise_notes = coalesce(p_exercise_notes, '{}'::jsonb),
    draft = '{}'::jsonb, updated_at = now()
  where id = v_s.id;
  return v_result || jsonb_build_object('already', false);
end;
$$;


-- ───────────── Grants ─────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.can_view_lift(uuid, uuid, public.lift_visibility),
  public.is_blocked_with_me(uuid),
  public.am_group_member(uuid),
  public.am_group_admin(uuid),
  public.app_timezone(),
  public.is_reserved_username(text),
  public.compute_score(public.ranking_method, numeric, integer),
  public.get_leaderboard(uuid, text, uuid, text, integer, integer, integer, uuid, boolean),
  public.submit_lift(uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid, uuid, uuid),
  public.update_lift_sharing(uuid, public.lift_visibility, uuid[], text),
  public.delete_lift(uuid),
  public.get_prs(uuid),
  public.get_lift_defaults(),
  public.complete_username(text, text),
  public.update_my_profile(text, text, public.weight_unit, public.profile_visibility),
  public.get_my_profile(),
  public.get_profile(text),
  public.create_group(text, text),
  public.update_group(uuid, text, text),
  public.delete_group(uuid),
  public.get_my_groups(),
  public.get_group(uuid),
  public.leave_group(uuid),
  public.remove_group_member(uuid, uuid),
  public.set_group_member_role(uuid, uuid, public.group_role),
  public.create_group_invite(uuid, integer, integer),
  public.revoke_group_invite(uuid),
  public.get_invite_preview(text),
  public.accept_group_invite(text),
  public.search_users(text),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid),
  public.remove_friend(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.get_friends(),
  public.get_notifications(integer),
  public.unread_notification_count(),
  public.mark_notifications_read(uuid[]),
  public.get_feed(integer, timestamptz, uuid, uuid),
  public.toggle_reaction(uuid, text),
  public.get_home(),
  public.prepare_account_deletion(),
  public.submit_gym(text, text, text, text, text),
  public.search_gyms(text),
  public.set_primary_gym(uuid),
  public.set_gym_board_opt_in(boolean),
  public.mod_pending(),
  public.mod_review_gym(uuid, boolean, double precision, double precision),
  public.mod_review_model(uuid, boolean),
  public.get_machine_options(uuid),
  public.submit_machine_model(uuid, text, uuid),
  public.get_proof_state(uuid),
  public.request_proof(uuid, text),
  public.decline_proof_request(uuid, text),
  public.begin_proof_upload(uuid, bigint, text, numeric),
  public.complete_proof_upload(uuid),
  public.request_proof_view(uuid),
  public.my_proof_paths(),
  public.get_record_history(text, uuid, uuid),
  public.get_champion_card(text),
  public.set_avatar(text),
  public.verify_proof(uuid, text),
  public.edit_lift(uuid, uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid, uuid),
  public.create_friend_invite(),
  public.get_friend_invite_preview(text),
  public.accept_friend_invite(text),
  public.get_proofs_to_check(),
  public.my_avatar_paths(),
  public.submit_report(text, uuid, text, text),
  public.mod_reports(),
  public.mod_resolve_reports(text, uuid, text),
  public._avatar_can_upload(text),
  public._avatar_can_manage(text),
  -- Storage evaluates its policies as the signed-in user, so these must be callable.
  -- They only answer yes/no about the caller's own access to one path.
  public._proof_can_upload(text),
  public._proof_can_read(text),
  public._proof_can_delete(text),
  public.import_training_split(text, text, text, jsonb),
  public.set_active_training_split(uuid),
  public.save_training_day(uuid, text, jsonb),
  public.add_training_day(uuid, text),
  public.delete_training_day(uuid),
  public.log_training_set(uuid, uuid, integer, numeric, public.weight_unit, integer, date, timestamptz, uuid, text),
  public.update_training_set(uuid, numeric, public.weight_unit, integer, date, timestamptz, text, smallint),
  public.start_training_session(uuid, date, jsonb),
  public.save_training_draft(uuid, jsonb, integer),
  public.finish_training_session(uuid, uuid, date, jsonb, text, jsonb),
  public.discard_training_session(uuid),
  public.set_exercise_note(uuid, text),
  public.dismiss_training_tip(text),
  public.set_unilateral_preference(uuid, boolean),
  public.delete_training_set(uuid),
  public.dismiss_training_pr(uuid),
  public.submit_training_set(uuid, public.lift_visibility, uuid[]),
  -- 0020: My Recordings
  public.get_recording_usage(),
  public.begin_recording(uuid, bigint, text, numeric, uuid, uuid, text, timestamptz),
  public.cancel_recording(uuid),
  public.delete_recording(uuid),
  public.update_recording(uuid, text, text, uuid, boolean),
  public.my_recording_keys()
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;
-- 0020: finalizing an upload (after the server checked the stored file) and the R2 cleanup job.
grant execute on function public.finalize_recording(uuid, uuid, bigint, numeric, integer, integer), public.recording_maintenance(),
  public.recording_objects_removed(text[]) to service_role;

grant execute on function public.get_invite_preview(text), public.get_friend_invite_preview(text) to anon;
