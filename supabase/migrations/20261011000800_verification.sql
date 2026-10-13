-- LiftRank 0008 — Phase 5: proof videos, proof requests, verification.
--
-- Additive: new tables, columns, a private Storage bucket and its policies,
-- and new functions. No existing rows are changed or removed.
--
-- Flow: a friend requests proof → the owner uploads a short video (or
-- declines) → a moderator reviews it → verified / insufficient / rejected.
-- Uploading never verifies a lift by itself.
--
-- Cost control (Supabase Free: 1 GB storage, 50 MB per file, 5 GB egress/month):
--   • every limit lives in public.proof_settings (one row, editable in SQL);
--   • the bucket's own size cap follows proof_settings.max_bytes;
--   • uploads stop once the bucket reaches storage_budget_bytes;
--   • only the lift's owner and moderators can play a video, through a
--     2-minute grant that is rate-limited per person and per month overall;
--   • rejected / insufficient videos and deleted lifts' videos are removed.
-- Files can't be deleted with SQL (storage.protect_objects_delete), so the app
-- removes them through the Storage API: the RPCs return the paths to remove,
-- and scripts/cleanup-proofs.mjs (or /api/cron/proof-cleanup) sweeps orphans.

-- ───────────── Settings ─────────────
create table public.proof_settings (
  id boolean primary key default true check (id),
  max_bytes bigint not null default 26214400 check (max_bytes between 1048576 and 52428800),   -- 25 MB (Free cap: 50 MB)
  max_seconds integer not null default 30 check (max_seconds between 5 and 120),
  storage_budget_bytes bigint not null default 786432000 check (storage_budget_bytes > 0),     -- 750 MB of the 1 GB
  monthly_view_budget_bytes bigint not null default 3221225472 check (monthly_view_budget_bytes > 0), -- 3 GB of 5 GB egress
  uploads_per_day integer not null default 3 check (uploads_per_day between 1 and 50),
  views_per_day integer not null default 20 check (views_per_day between 1 and 1000),
  moderator_views_per_day integer not null default 300 check (moderator_views_per_day between 1 and 5000),
  requests_per_day integer not null default 3 check (requests_per_day between 1 and 50),
  updated_at timestamptz not null default now()
);
insert into public.proof_settings default values;

-- ───────────── Schema ─────────────
alter table public.lift_challenges
  add column response text check (response is null or char_length(response) <= 280),
  add column answered_at timestamptz;
create index lift_challenges_challenger_idx on public.lift_challenges (challenger_id, created_at desc);

alter table public.notifications add column detail text check (detail is null or char_length(detail) <= 40);
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'friend_request', 'friend_accepted', 'passed', 'first_place', 'group_joined',
  'proof_requested', 'proof_response', 'proof_reviewed'
));

create index lifts_video_path_idx on public.lifts (video_path) where video_path is not null;
create index lifts_proof_queue_idx on public.lifts (verification_status) where deleted_at is null and verification_status = 'proof_uploaded';

-- One row per upload slot. A slot is valid for an hour; an object may only be
-- written to a pending slot's exact path.
create table public.proof_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  lift_id uuid not null references public.lifts (id) on delete cascade,
  path text not null unique,
  bytes bigint not null check (bytes > 0),
  mime text not null,
  seconds numeric not null check (seconds > 0),
  status text not null default 'pending' check (status in ('pending', 'complete', 'discarded')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index proof_uploads_user_idx on public.proof_uploads (user_id, created_at desc);
create index proof_uploads_pending_idx on public.proof_uploads (created_at) where status = 'pending';

-- One row per playback grant (what lets a signed URL be created). Also the
-- ledger for the daily and monthly viewing limits.
create table public.proof_view_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lift_id uuid not null references public.lifts (id) on delete cascade,
  path text not null,
  bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index proof_view_grants_user_idx on public.proof_view_grants (user_id, created_at desc);
create index proof_view_grants_path_idx on public.proof_view_grants (path, user_id, expires_at);
create index proof_view_grants_created_idx on public.proof_view_grants (created_at);

-- No direct client access: everything goes through the functions below.
alter table public.proof_settings enable row level security;
alter table public.proof_uploads enable row level security;
alter table public.proof_view_grants enable row level security;
revoke all on public.proof_settings, public.proof_uploads, public.proof_view_grants from anon, authenticated;
grant all on public.proof_settings, public.proof_uploads, public.proof_view_grants to service_role;

-- ───────────── Storage bucket ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lift-proofs', 'lift-proofs', false, 26214400, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

-- Keep the bucket's hard size cap equal to proof_settings.max_bytes.
create function public._sync_proof_bucket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  update storage.buckets set file_size_limit = new.max_bytes where id = 'lift-proofs';
  return new;
end;
$$;
create trigger proof_settings_sync before update on public.proof_settings
  for each row execute function public._sync_proof_bucket();

create function public._proof_settings()
returns public.proof_settings
language sql
stable
security definer
set search_path = ''
as $$ select * from public.proof_settings where id $$;

-- Paths look like <owner uuid>/<lift uuid>/<upload uuid>.<ext>.
create function public._proof_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lifts where video_path = p_name and deleted_at is null)
$$;

create function public._proof_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.proof_uploads u
    where u.path = p_name and u.user_id = auth.uid() and u.status = 'pending'
      and u.created_at > now() - interval '1 hour'
  )
$$;

-- Read (which is what signing a URL needs): a live playback grant, or a file
-- that no live lift uses any more, in your own folder or (moderators) anywhere,
-- so it can be cleaned up.
create function public._proof_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.proof_view_grants g
      where g.path = p_name and g.user_id = auth.uid() and g.expires_at > now()
    )
    or (
      not public._proof_in_use(p_name)
      and (split_part(p_name, '/', 1) = auth.uid()::text or public._is_moderator(auth.uid()))
    )
  )
$$;

-- Delete: only files no live lift uses, in your own folder or (moderators) anywhere.
create function public._proof_can_delete(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not public._proof_in_use(p_name)
    and not exists (
      select 1 from public.proof_uploads u
      where u.path = p_name and u.status = 'pending' and u.created_at > now() - interval '1 hour'
        and u.user_id <> auth.uid()
    )
    and (split_part(p_name, '/', 1) = auth.uid()::text or public._is_moderator(auth.uid()))
$$;

create policy lift_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lift-proofs' and public._proof_can_upload(name));
create policy lift_proofs_select on storage.objects for select to authenticated
  using (bucket_id = 'lift-proofs' and public._proof_can_read(name));
create policy lift_proofs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lift-proofs' and public._proof_can_delete(name));
-- No update policy: files are never overwritten.

-- ───────────── Status shown to others ─────────────
-- 'rejected' is shown to everyone but the owner as 'disputed' (never "cheating");
-- 'under_review' isn't used and reads as 'proof_uploaded'.
create function public._public_vstatus(p_status public.verification_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'rejected' then 'disputed'
    when 'under_review' then 'proof_uploaded'
    else p_status::text
  end
$$;

-- ───────────── Proof state for the lift page ─────────────
create function public.get_proof_state(p_lift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_owner boolean;
  v_mod boolean;
  v_settings public.proof_settings;
  v_active public.lift_challenges%rowtype;
  v_mine public.lift_challenges%rowtype;
  v_review jsonb;
  v_can_request boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_lift from public.lifts where id = p_lift_id and deleted_at is null;
  if v_lift.id is null or not public._can_view_lift(v_uid, v_lift.id, v_lift.user_id, v_lift.visibility) then
    raise exception 'not_found';
  end if;
  v_owner := v_lift.user_id = v_uid;
  v_mod := public._is_moderator(v_uid);
  v_settings := public._proof_settings();

  select * into v_active from public.lift_challenges
  where lift_id = p_lift_id and status in ('open', 'proof_submitted') limit 1;
  select * into v_mine from public.lift_challenges
  where lift_id = p_lift_id and challenger_id = v_uid order by created_at desc limit 1;

  v_can_request := not v_owner
    and public._friends(v_uid, v_lift.user_id)
    and v_lift.verification_status in ('unverified', 'disputed', 'rejected')
    and v_active.id is null
    and v_mine.id is null;

  if v_owner then
    select jsonb_build_object('decision', r.decision, 'notes', r.notes, 'created_at', r.created_at)
    into v_review
    from public.verification_reviews r where r.lift_id = p_lift_id order by r.created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'status', case when v_owner then v_lift.verification_status::text else public._public_vstatus(v_lift.verification_status) end,
    'is_owner', v_owner,
    'has_video', (v_owner or v_mod) and v_lift.video_path is not null,
    'can_upload', v_owner and v_lift.verification_status in ('unverified', 'disputed', 'rejected'),
    'can_request', v_can_request,
    -- The owner sees who asked; the person who asked sees their own request.
    'challenge', case
      when v_owner and v_active.id is not null then (
        select jsonb_build_object(
          'id', v_active.id, 'status', v_active.status, 'reason', v_active.reason, 'created_at', v_active.created_at,
          'challenger', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name))
        from public.profiles p where p.id = v_active.challenger_id
      )
      when v_mine.id is not null then jsonb_build_object(
        'id', v_mine.id, 'status', v_mine.status, 'response', v_mine.response, 'created_at', v_mine.created_at, 'mine', true)
    end,
    'review', v_review,
    'limits', case when v_owner then jsonb_build_object(
      'max_bytes', v_settings.max_bytes, 'max_seconds', v_settings.max_seconds,
      'mime_types', jsonb_build_array('video/mp4', 'video/quicktime', 'video/webm')) end
  );
end;
$$;

-- ───────────── Proof requests ─────────────
-- Only friends who can see the lift, once per lift per person, one open request
-- per lift, and a few per day. Blocked pairs aren't friends, so they can't.
create function public.request_proof(p_lift_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_lift from public.lifts where id = p_lift_id and deleted_at is null;
  if v_lift.id is null or not public._can_view_lift(v_uid, v_lift.id, v_lift.user_id, v_lift.visibility) then
    raise exception 'not_found';
  end if;
  if v_lift.user_id = v_uid or not public._friends(v_uid, v_lift.user_id) or public._blocked(v_uid, v_lift.user_id)
     or v_lift.verification_status not in ('unverified', 'disputed', 'rejected') then
    raise exception 'cannot_request_proof';
  end if;
  if char_length(coalesce(v_reason, '')) > 280 then raise exception 'reason_too_long'; end if;
  if exists (select 1 from public.lift_challenges where lift_id = p_lift_id
             and (challenger_id = v_uid or status in ('open', 'proof_submitted'))) then
    raise exception 'proof_already_requested';
  end if;
  if (select count(*) from public.lift_challenges
      where challenger_id = v_uid and created_at > now() - interval '24 hours') >= (public._proof_settings()).requests_per_day then
    raise exception 'too_many_proof_requests';
  end if;

  insert into public.lift_challenges (lift_id, challenger_id, challenged_user_id, reason)
  values (p_lift_id, v_uid, v_lift.user_id, v_reason)
  returning id into v_id;
  insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id)
  values (v_lift.user_id, v_uid, 'proof_requested', v_lift.exercise_id, p_lift_id);
  return v_id;
end;
$$;

-- The owner can say no, with an optional short reply. Declining changes nothing
-- about the lift.
create function public.decline_proof_request(p_challenge_id uuid, p_response text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ch public.lift_challenges%rowtype;
  v_response text := nullif(btrim(coalesce(p_response, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if char_length(coalesce(v_response, '')) > 280 then raise exception 'reason_too_long'; end if;
  update public.lift_challenges
  set status = 'declined', response = v_response, answered_at = now(), resolved_at = now()
  where id = p_challenge_id and challenged_user_id = v_uid and status = 'open'
  returning * into v_ch;
  if v_ch.id is null then raise exception 'not_found'; end if;
  insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
  select v_ch.challenger_id, v_uid, 'proof_response', l.exercise_id, l.id, 'declined'
  from public.lifts l where l.id = v_ch.lift_id;
end;
$$;

-- ───────────── Uploads ─────────────
create function public.begin_proof_upload(p_lift_id uuid, p_bytes bigint, p_mime text, p_seconds numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_s public.proof_settings := public._proof_settings();
  v_used bigint;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_stale text[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_lift from public.lifts where id = p_lift_id and user_id = v_uid and deleted_at is null;
  if v_lift.id is null then raise exception 'not_found'; end if;
  if v_lift.verification_status not in ('unverified', 'disputed', 'rejected') then
    raise exception 'proof_not_needed';
  end if;
  if p_mime is null or p_mime not in ('video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'invalid_video_type';
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > v_s.max_bytes then raise exception 'video_too_large'; end if;
  if p_seconds is null or p_seconds <= 0 or p_seconds > v_s.max_seconds + 0.5 then raise exception 'video_too_long'; end if;
  if (select count(*) from public.proof_uploads
      where user_id = v_uid and created_at > now() - interval '24 hours') >= v_s.uploads_per_day then
    raise exception 'too_many_uploads';
  end if;

  -- Your own abandoned slots are given up; the app removes any half-written files.
  with stale as (
    update public.proof_uploads set status = 'discarded'
    where user_id = v_uid and status = 'pending'
    returning path
  )
  select coalesce(array_agg(path), '{}') into v_stale from stale;

  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into v_used
  from storage.objects o where o.bucket_id = 'lift-proofs';
  v_used := v_used + coalesce((
    select sum(bytes) from public.proof_uploads
    where status = 'pending' and created_at > now() - interval '1 hour'
  ), 0);
  if v_used + p_bytes > v_s.storage_budget_bytes then raise exception 'proof_storage_full'; end if;

  v_path := v_uid || '/' || p_lift_id || '/' || v_id || case p_mime
    when 'video/mp4' then '.mp4' when 'video/quicktime' then '.mov' else '.webm' end;
  insert into public.proof_uploads (id, user_id, lift_id, path, bytes, mime, seconds)
  values (v_id, v_uid, p_lift_id, v_path, p_bytes, p_mime, p_seconds);

  return jsonb_build_object('upload_id', v_id, 'path', v_path, 'bucket', 'lift-proofs', 'stale_paths', to_jsonb(v_stale));
end;
$$;

-- Called once the file is in Storage. Checks the stored file itself, attaches
-- it to the lift as proof (status proof_uploaded, never verified), and tells
-- whoever asked for proof.
create function public.complete_proof_upload(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_up public.proof_uploads%rowtype;
  v_obj jsonb;
  v_lift public.lifts%rowtype;
  v_ch public.lift_challenges%rowtype;
  v_s public.proof_settings := public._proof_settings();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_up from public.proof_uploads
  where id = p_upload_id and user_id = v_uid and status = 'pending' and created_at > now() - interval '1 hour'
  for update;
  if v_up.id is null then raise exception 'upload_expired'; end if;

  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'lift-proofs' and o.name = v_up.path;
  if v_obj is null then raise exception 'upload_missing'; end if;
  if coalesce((v_obj ->> 'size')::bigint, 0) > v_s.max_bytes
     or coalesce(v_obj ->> 'mimetype', '') not in ('video/mp4', 'video/quicktime', 'video/webm') then
    update public.proof_uploads set status = 'discarded' where id = v_up.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_video_type', 'remove_paths', jsonb_build_array(v_up.path));
  end if;

  select * into v_lift from public.lifts where id = v_up.lift_id and user_id = v_uid and deleted_at is null for update;
  if v_lift.id is null or v_lift.verification_status not in ('unverified', 'disputed', 'rejected') then
    update public.proof_uploads set status = 'discarded' where id = v_up.id;
    return jsonb_build_object('ok', false, 'error', 'proof_not_needed', 'remove_paths', jsonb_build_array(v_up.path));
  end if;

  update public.lifts set video_path = v_up.path, verification_status = 'proof_uploaded' where id = v_lift.id;
  update public.proof_uploads set status = 'complete', completed_at = now(), bytes = coalesce((v_obj ->> 'size')::bigint, bytes)
  where id = v_up.id;

  update public.lift_challenges set status = 'proof_submitted', answered_at = now()
  where lift_id = v_lift.id and status = 'open'
  returning * into v_ch;
  if v_ch.id is not null then
    insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
    values (v_ch.challenger_id, v_uid, 'proof_response', v_lift.exercise_id, v_lift.id, 'uploaded');
  end if;

  return jsonb_build_object(
    'ok', true,
    'remove_paths', case when v_lift.video_path is not null and v_lift.video_path <> v_up.path
                         then jsonb_build_array(v_lift.video_path) else '[]'::jsonb end
  );
end;
$$;

-- ───────────── Playback ─────────────
-- Owner and moderators only. Returns the path; the app then signs a short URL,
-- which Storage allows only while this grant is live.
create function public.request_proof_view(p_lift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_mod boolean;
  v_s public.proof_settings := public._proof_settings();
  v_bytes bigint;
  v_month_start timestamptz := date_trunc('month', now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_mod := public._is_moderator(v_uid);
  select * into v_lift from public.lifts where id = p_lift_id and deleted_at is null;
  if v_lift.id is null or v_lift.video_path is null or not (v_lift.user_id = v_uid or v_mod) then
    raise exception 'not_found';
  end if;

  -- Re-opening the same video within its grant is free.
  if exists (select 1 from public.proof_view_grants
             where user_id = v_uid and path = v_lift.video_path and expires_at > now()) then
    return jsonb_build_object('path', v_lift.video_path, 'bucket', 'lift-proofs');
  end if;

  if (select count(*) from public.proof_view_grants where user_id = v_uid and created_at > now() - interval '24 hours')
     >= (case when v_mod then v_s.moderator_views_per_day else v_s.views_per_day end) then
    raise exception 'too_many_views';
  end if;
  select coalesce((o.metadata ->> 'size')::bigint, 0) into v_bytes
  from storage.objects o where o.bucket_id = 'lift-proofs' and o.name = v_lift.video_path;
  if v_bytes is null then raise exception 'not_found'; end if;
  if coalesce((select sum(bytes) from public.proof_view_grants where created_at >= v_month_start), 0) + v_bytes
     > v_s.monthly_view_budget_bytes then
    raise exception 'proof_view_budget';
  end if;

  insert into public.proof_view_grants (user_id, lift_id, path, bytes, expires_at)
  values (v_uid, v_lift.id, v_lift.video_path, v_bytes, now() + interval '2 minutes');
  return jsonb_build_object('path', v_lift.video_path, 'bucket', 'lift-proofs');
end;
$$;

-- ───────────── Review (moderators only) ─────────────
create function public.mod_proof_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_moderator(auth.uid()) then raise exception 'forbidden'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'lift_id', l.id, 'user_id', l.user_id, 'username', p.username,
      'exercise', jsonb_build_object('name', e.name, 'ranking_method', e.ranking_method, 'weight_convention', e.weight_convention),
      'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit, 'weight_kg', l.weight_kg,
      'reps', l.reps, 'score', l.score, 'performed_at', l.performed_at,
      'uploaded_at', u.completed_at, 'seconds', u.seconds, 'bytes', u.bytes,
      'requested', exists (select 1 from public.lift_challenges c where c.lift_id = l.id and c.status = 'proof_submitted')
    ) order by q.uploaded_at nulls first), '[]'::jsonb)
    from (
      select l.id, u.completed_at as uploaded_at
      from public.lifts l
      left join public.proof_uploads u on u.path = l.video_path
      where l.deleted_at is null and l.verification_status = 'proof_uploaded' and l.video_path is not null
        and l.user_id <> auth.uid()
      order by u.completed_at nulls first
      limit 100
    ) q
    join public.lifts l on l.id = q.id
    join public.profiles p on p.id = l.user_id
    join public.exercises e on e.id = l.exercise_id
    left join public.proof_uploads u on u.path = l.video_path
  );
end;
$$;

-- verified: keeps the video. insufficient: lift becomes 'disputed', video removed,
-- the owner may try again. rejected: lift becomes 'rejected' (shown to others as
-- disputed), video removed. Returns the file to remove.
create function public.mod_review_proof(p_lift_id uuid, p_decision text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_ch public.lift_challenges%rowtype;
begin
  if not public._is_moderator(v_uid) then raise exception 'forbidden'; end if;
  if p_decision not in ('verified', 'insufficient', 'rejected') then raise exception 'invalid_decision'; end if;
  if char_length(coalesce(v_notes, '')) > 500 then raise exception 'notes_too_long'; end if;
  select * into v_lift from public.lifts
  where id = p_lift_id and deleted_at is null and verification_status = 'proof_uploaded' and video_path is not null
  for update;
  if v_lift.id is null then raise exception 'not_found'; end if;
  if v_lift.user_id = v_uid then raise exception 'cannot_review_own'; end if;

  insert into public.verification_reviews (lift_id, reviewer_id, decision, notes)
  values (v_lift.id, v_uid, case p_decision when 'insufficient' then 'disputed' else p_decision end, v_notes);
  update public.lifts set
    verification_status = case p_decision when 'verified' then 'verified' when 'insufficient' then 'disputed' else 'rejected' end::public.verification_status,
    video_path = case when p_decision = 'verified' then video_path end
  where id = v_lift.id;

  -- The owner hears the outcome (no reviewer named); so does whoever asked.
  insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
  values (v_lift.user_id, null, 'proof_reviewed', v_lift.exercise_id, v_lift.id, p_decision);
  update public.lift_challenges set status = 'resolved', resolved_at = now()
  where lift_id = v_lift.id and status in ('open', 'proof_submitted')
  returning * into v_ch;
  if v_ch.id is not null then
    insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
    values (v_ch.challenger_id, v_lift.user_id, 'proof_reviewed', v_lift.exercise_id, v_lift.id, p_decision);
  end if;

  return jsonb_build_object(
    'remove_paths', case when p_decision = 'verified' then '[]'::jsonb else jsonb_build_array(v_lift.video_path) end
  );
end;
$$;

-- ───────────── Housekeeping ─────────────
-- A deleted lift closes any open proof request. (Its video is removed by the app.)
create function public._close_challenges_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lift_challenges set status = 'withdrawn', resolved_at = now()
  where lift_id = new.id and status in ('open', 'proof_submitted');
  return new;
end;
$$;
create trigger lifts_close_challenges after update of deleted_at on public.lifts
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public._close_challenges_on_delete();

-- For the cleanup job (service role only): files older than an hour that no
-- live lift uses and no upload in progress owns. Also expires old slots and grants.
create function public.proof_orphans()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  update public.proof_uploads set status = 'discarded'
  where status = 'pending' and created_at < now() - interval '1 hour';
  delete from public.proof_view_grants where created_at < now() - interval '45 days';
  select coalesce(array_agg(o.name), '{}') into v_paths
  from storage.objects o
  where o.bucket_id = 'lift-proofs'
    and o.created_at < now() - interval '1 hour'
    and not public._proof_in_use(o.name)
    and not exists (select 1 from public.proof_uploads u where u.path = o.name and u.status = 'pending');
  return v_paths;
end;
$$;

-- Account deletion: the paths of your own files, so the server can remove them.
create function public.my_proof_paths()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.name), '{}')
  from storage.objects o
  where o.bucket_id = 'lift-proofs' and auth.uid() is not null and split_part(o.name, '/', 1) = auth.uid()::text
$$;

-- ───────────── Boards: verified-only filter ─────────────
-- _board_x gains p_verified (default false, so existing callers are unchanged).
drop function public._board_x(uuid, text, uuid, uuid, text, uuid, double precision, uuid);

create function public._board_x(
  p_viewer uuid, p_kind text, p_group uuid, p_exercise uuid, p_period text,
  p_gym uuid, p_radius_mi double precision, p_model uuid,
  p_verified boolean default false
)
returns table (
  pos bigint, uid uuid, lid uuid, score numeric, weight_kg numeric,
  entered_weight numeric, entered_unit public.weight_unit, reps integer,
  performed_at timestamptz, vstatus public.verification_status
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('month', now() at time zone public.app_timezone())) at time zone public.app_timezone() as m_start,
      (date_trunc('month', now() at time zone public.app_timezone()) + interval '1 month') at time zone public.app_timezone() as m_end
  ),
  origin as (
    select g.latitude, g.longitude from public.gyms g
    where g.id = p_gym and g.status = 'approved' and g.latitude is not null and g.longitude is not null
  ),
  participants as (
    select p_viewer as id where p_kind = 'friends' and p_viewer is not null
    union
    select case when f.requester_id = p_viewer then f.addressee_id else f.requester_id end
    from public.friendships f
    where p_kind = 'friends' and f.status = 'accepted' and p_viewer in (f.requester_id, f.addressee_id)
    union
    select m.user_id from public.group_members m where p_kind = 'group' and m.group_id = p_group
    union
    select pr.id from public.profiles pr
    join public.gyms g on g.id = pr.primary_gym_id and g.status = 'approved'
    where p_kind = 'gym' and pr.primary_gym_id = p_gym and pr.public_leaderboard_opt_in
    union
    select pr.id from public.profiles pr
    join public.gyms g on g.id = pr.primary_gym_id and g.status = 'approved'
    cross join origin o
    where p_kind = 'nearby' and pr.public_leaderboard_opt_in
      and g.latitude is not null and g.longitude is not null
      and public._miles(o.latitude, o.longitude, g.latitude, g.longitude) <= p_radius_mi
  ),
  eligible as (
    select l.*
    from public.lifts l
    join participants p on p.id = l.user_id
    cross join bounds b
    where l.exercise_id = p_exercise
      and l.is_ranked
      and l.deleted_at is null
      and (p_model is null or l.machine_model_id = p_model)
      and (not coalesce(p_verified, false) or l.verification_status = 'verified')
      and (
        p_period = 'all'
        or (l.monthly_eligible and l.performed_at >= b.m_start and l.performed_at < b.m_end)
      )
      and case
        when p_kind = 'friends' then l.visibility in ('public', 'friends')
        when p_kind = 'group' then l.visibility = 'public'
          or (l.visibility = 'groups' and exists (
            select 1 from public.lift_group_shares s where s.lift_id = l.id and s.group_id = p_group
          ))
        else l.visibility = 'public'
      end
  ),
  best as (
    select distinct on (e.user_id) e.*
    from eligible e
    order by e.user_id, e.score desc, e.weight_kg desc nulls last, e.performed_at, e.created_at, e.id
  )
  select
    row_number() over (order by b.score desc, b.weight_kg desc nulls last, b.performed_at, b.created_at, b.id),
    b.user_id, b.id, b.score, b.weight_kg, b.entered_weight, b.entered_unit, b.reps, b.performed_at,
    b.verification_status
  from best b
$$;

-- Others see 'rejected' as 'disputed'; you see your own status as it is.
create or replace function public._board_row(p_pos bigint, p_lid uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rank', p_pos,
    'user_id', l.user_id,
    'username', pr.username,
    'display_name', pr.display_name,
    'avatar_path', pr.avatar_path,
    'lift_id', l.id,
    'score', l.score,
    'weight_kg', l.weight_kg,
    'entered_weight', l.entered_weight,
    'entered_unit', l.entered_unit,
    'reps', l.reps,
    'performed_at', l.performed_at,
    'verification_status', case when l.user_id = p_viewer then l.verification_status::text
                                else public._public_vstatus(l.verification_status) end,
    'is_me', l.user_id = p_viewer,
    'machine', case when l.machine_manufacturer_id is not null then jsonb_build_object(
      'manufacturer', mf.name,
      'model_id', case when mm.status = 'approved' then mm.id end,
      'model', case when mm.status = 'approved' then mm.name end
    ) end
  )
  from public.lifts l
  join public.profiles pr on pr.id = l.user_id
  left join public.machine_manufacturers mf on mf.id = l.machine_manufacturer_id
  left join public.machine_models mm on mm.id = l.machine_model_id
  where l.id = p_lid
$$;

drop function public.get_leaderboard(uuid, text, uuid, text, integer, integer, integer, uuid);

create function public.get_leaderboard(
  p_exercise_id uuid,
  p_kind text default 'friends',
  p_group_id uuid default null,
  p_period text default 'all',
  p_limit integer default 50,
  p_offset integer default 0,
  p_radius_mi integer default null,
  p_machine_model_id uuid default null,
  p_verified boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_champion jsonb;
  v_gym public.gyms%rowtype;
  v_radius double precision;
  v_machine boolean;
  v_reason text;
  v_opted boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('friends', 'group', 'gym', 'nearby') then raise exception 'invalid_board'; end if;
  if p_period not in ('all', 'month') then raise exception 'invalid_period'; end if;
  if p_kind = 'group' and (p_group_id is null or not public._member(p_group_id, v_uid)) then
    raise exception 'not_a_member';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  select coalesce(supports_machine_selection, false) into v_machine from public.exercises where id = p_exercise_id;
  if p_machine_model_id is not null and not v_machine then raise exception 'invalid_machine'; end if;

  if p_kind in ('gym', 'nearby') then
    select g.* into v_gym from public.profiles pr join public.gyms g on g.id = pr.primary_gym_id where pr.id = v_uid;
    select public_leaderboard_opt_in into v_opted from public.profiles where id = v_uid;
    v_reason := case
      when v_gym.id is null then 'no_gym'
      when v_gym.status <> 'approved' then 'gym_pending'
      when p_kind = 'nearby' and (v_gym.latitude is null or v_gym.longitude is null) then 'no_location'
    end;
    if p_kind = 'nearby' then
      if coalesce(p_radius_mi, 10) not in (5, 10, 25) then raise exception 'invalid_radius'; end if;
      v_radius := coalesce(p_radius_mi, 10);
    end if;
    if v_reason is not null then
      return jsonb_build_object(
        'total', 0, 'rows', '[]'::jsonb, 'me', null, 'above', null, 'champion', null,
        'gym', case when v_gym.id is not null then public._gym_json(v_gym.id) end,
        'reason', v_reason, 'opted_in', coalesce(v_opted, false)
      );
    end if;
  end if;

  -- Blocked users stay in the ranking (so every viewer sees the same numbers)
  -- but their row is hidden from the viewer.
  with b as materialized (
    select x.*, public._blocked(v_uid, x.uid) as hidden
    from public._board_x(v_uid, p_kind, p_group_id, p_exercise_id, p_period, v_gym.id, v_radius, p_machine_model_id, coalesce(p_verified, false)) x
  ),
  me as (select * from b where uid = v_uid)
  select jsonb_build_object(
    'total', (select count(*) from b),
    'rows', (
      select coalesce(jsonb_agg(public._board_row(pg.pos, pg.lid, v_uid) order by pg.pos), '[]'::jsonb)
      from (select * from b where not b.hidden order by b.pos limit p_limit offset p_offset) pg
    ),
    'me', (select public._board_row(m.pos, m.lid, v_uid) from me m),
    'above', (
      select public._board_row(a.pos, a.lid, v_uid)
      from b a
      where not a.hidden and a.pos < (select m.pos from me m)
      order by a.pos desc
      limit 1
    ),
    'top', (select public._board_row(t.pos, t.lid, v_uid) from b t where t.pos = 1 and not t.hidden)
  )
  into v_result;

  if coalesce(p_verified, false) then
    -- Verified-only boards are a filter, not a competition: no champion.
    v_champion := null;
  elsif p_kind = 'group' and not v_machine and p_period = 'all' then
    select jsonb_build_object(
      'user_id', rh.user_id, 'username', pr.username, 'display_name', pr.display_name,
      'avatar_path', pr.avatar_path, 'lift_id', rh.lift_id, 'since', rh.since,
      'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit, 'reps', l.reps,
      'score', l.score, 'weight_kg', l.weight_kg
    )
    into v_champion
    from public.record_history rh
    left join public.profiles pr on pr.id = rh.user_id
    left join public.lifts l on l.id = rh.lift_id
    where rh.board_key = 'group:' || p_group_id || ':' || p_exercise_id and rh.until is null
      and (rh.user_id is null or not public._blocked(v_uid, rh.user_id));
  elsif p_kind in ('group', 'gym') and (v_result->>'total')::integer >= 3
        and (not v_machine or p_machine_model_id is not null) then
    -- Monthly boards, gym boards and exact-machine boards: current leader, 3+ lifters.
    v_champion := v_result->'top';
  end if;

  v_result := (v_result - 'top') || jsonb_build_object('champion', v_champion);
  if p_kind in ('gym', 'nearby') then
    v_result := v_result || jsonb_build_object(
      'gym', public._gym_json(v_gym.id), 'reason', null, 'opted_in', coalesce(v_opted, false),
      'radius_mi', v_radius
    );
  end if;
  return v_result;
end;
$$;

-- ───────────── Notifications carry a short detail (proof outcomes) ─────────────
create or replace function public.get_notifications(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'type', n.type, 'created_at', n.created_at, 'read_at', n.read_at,
    'actor', case when a.id is null then null else jsonb_build_object(
      'id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_path', a.avatar_path) end,
    'group', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
    'exercise', case when e.id is null then null else jsonb_build_object(
      'id', e.id, 'name', e.name, 'ranking_method', e.ranking_method) end,
    'lift', case when l.id is null then null else jsonb_build_object(
      'id', l.id, 'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit,
      'weight_kg', l.weight_kg, 'reps', l.reps, 'score', l.score, 'user_id', l.user_id) end,
    'detail', n.detail,
    'friendship_id', n.friendship_id,
    'friendship_pending', exists (select 1 from public.friendships f where f.id = n.friendship_id and f.status = 'pending')
  ) order by n.created_at desc), '[]'::jsonb)
  from (
    select * from public._visible_notifications(auth.uid())
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) n
  left join public.profiles a on a.id = n.actor_id
  left join public.groups g on g.id = n.group_id
  left join public.exercises e on e.id = n.exercise_id
  left join public.lifts l on l.id = n.lift_id
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
  public.mod_proof_queue(),
  public.mod_review_proof(uuid, text, text),
  -- Storage evaluates its policies as the signed-in user, so these must be callable.
  -- They only answer yes/no about the caller's own access to one path.
  public._proof_can_upload(text),
  public._proof_can_read(text),
  public._proof_can_delete(text)
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans() to service_role;

grant execute on function public.get_invite_preview(text) to anon;
