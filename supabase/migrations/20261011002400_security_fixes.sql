-- 0024: pre-launch security fixes (audit 2026-11-23).
--
-- 1. Sign-in and sign-up throttling. Sign-in runs on the server, so Supabase's per-IP limits see the app's
--    servers, not the person: 25 wrong passwords in a row were never limited. The server now records attempts
--    keyed by a hash of the email and of the client IP (no raw emails or IPs are stored):
--      sign-in: 10 failures per email or 30 per IP in 15 minutes → refused until the window passes;
--      sign-up: 5 per IP per hour.
--    Rows older than a day are pruned on every call. Only the server (secret key) can call these.
-- 2. Analytics. Any signed-in user could insert unlimited events of any size (a 200 KB event was accepted).
--    Direct inserts are revoked; log_event validates the name (lowercase, ≤ 40 chars), caps props at 2 KB and
--    keeps at most 300 events per user per hour (extra events are dropped silently).

create table public.auth_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('signin', 'signup')),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now()
);
create index auth_attempts_email_idx on public.auth_attempts (kind, email_hash, at);
create index auth_attempts_ip_idx on public.auth_attempts (kind, ip_hash, at);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from public, anon, authenticated;

-- May this attempt go ahead? { allowed, retry_after_s }.
create function public.auth_throttle_check(p_kind text, p_email_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := case p_kind when 'signin' then interval '15 minutes' else interval '1 hour' end;
  v_email int := 0;
  v_ip int := 0;
  v_oldest timestamptz;
begin
  if p_kind not in ('signin', 'signup') then raise exception 'invalid_request'; end if;
  delete from public.auth_attempts where at < now() - interval '1 day';
  if p_email_hash is not null then
    select count(*) into v_email from public.auth_attempts where kind = p_kind and email_hash = p_email_hash and at > now() - v_window;
  end if;
  if p_ip_hash is not null then
    select count(*) into v_ip from public.auth_attempts where kind = p_kind and ip_hash = p_ip_hash and at > now() - v_window;
  end if;
  if (p_kind = 'signin' and (v_email >= 10 or v_ip >= 30)) or (p_kind = 'signup' and v_ip >= 5) then
    select min(at) into v_oldest from public.auth_attempts
    where kind = p_kind and at > now() - v_window and (email_hash = p_email_hash or ip_hash = p_ip_hash);
    return jsonb_build_object('allowed', false, 'retry_after_s', greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())))::int));
  end if;
  return jsonb_build_object('allowed', true);
end;
$$;

-- Record an attempt. Sign-in: failures count; a success clears that email's failures. Sign-up: every attempt counts.
create function public.auth_throttle_record(p_kind text, p_email_hash text, p_ip_hash text, p_success boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('signin', 'signup') then raise exception 'invalid_request'; end if;
  if p_kind = 'signin' and p_success then
    delete from public.auth_attempts where kind = 'signin' and email_hash = p_email_hash;
  elsif p_kind = 'signup' or not p_success then
    insert into public.auth_attempts (kind, email_hash, ip_hash) values (p_kind, p_email_hash, p_ip_hash);
  end if;
end;
$$;

-- Analytics only through this function.
revoke insert on public.analytics_events from authenticated;
alter table public.analytics_events add constraint analytics_events_bounded
  check (char_length(name) between 1 and 40 and pg_column_size(props) <= 4096) not valid;

create function public.log_event(p_name text, p_props jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_name is null or p_name !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'invalid_request'; end if;
  if p_props is null or jsonb_typeof(p_props) <> 'object' or pg_column_size(p_props) > 2048 then raise exception 'invalid_request'; end if;
  if (select count(*) from public.analytics_events where user_id = v_uid and created_at > now() - interval '1 hour') >= 300 then return; end if;
  insert into public.analytics_events (user_id, name, props) values (v_uid, p_name, p_props);
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
  public.import_training_split(text, text, text, jsonb, uuid),
  public.delete_training_session(uuid, text),
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
  public.my_recording_keys(),
  -- 0024: analytics only through a checked function
  public.log_event(text, jsonb)
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;
-- 0020: finalizing an upload (after the server checked the stored file) and the R2 cleanup job.
grant execute on function public.finalize_recording(uuid, uuid, bigint, numeric, integer, integer), public.recording_maintenance(),
  public.recording_objects_removed(text[]) to service_role;

grant execute on function public.get_invite_preview(text), public.get_friend_invite_preview(text) to anon;
-- 0024: sign-in / sign-up throttling (called by the server with the secret key).
grant execute on function public.auth_throttle_check(text, text, text), public.auth_throttle_record(text, text, text, boolean) to service_role;
