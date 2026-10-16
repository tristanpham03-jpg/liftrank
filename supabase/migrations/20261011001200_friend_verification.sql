-- LiftRank 0012 — Friends verify proof videos.
--
-- Owner's decision (Oct 15): any friend or groupmate who can see a lift can
-- watch its proof video and confirm it; one confirmation marks it Verified.
-- They can also say "not enough to tell" (Disputed; the lift still counts).
-- Nobody can mark a lift invalid any more, and moderators no longer review
-- videos (they keep reports, gyms and machine models), so the moderator review
-- and appeal functions are no longer callable. Their tables and the
-- invalidated_at column stay, unused, so history is kept.
--
-- Additive: no existing rows change.

-- A lift's verifiers: people who can see it (blocks and visibility apply) and
-- are the owner's friend, or share a group the lift appears in. Never the owner.
create function public._can_verify(p_viewer uuid, p_lift uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lifts l
    where l.id = p_lift and l.deleted_at is null and p_viewer is not null and l.user_id <> p_viewer
      and public._can_view_lift(p_viewer, l.id, l.user_id, l.visibility)
      and (
        public._friends(p_viewer, l.user_id)
        or exists (
          select 1 from public.group_members a
          join public.group_members b on b.group_id = a.group_id and b.user_id = l.user_id
          where a.user_id = p_viewer
            and (l.visibility = 'public'
                 or exists (select 1 from public.lift_group_shares s where s.lift_id = l.id and s.group_id = a.group_id))
        )
      )
  )
$$;

-- A friend who opened a video may also remove it once no lift uses it (after
-- "not enough to tell"); the daily sweep catches anything left.
create or replace function public._proof_can_delete(p_name text)
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
    and (split_part(p_name, '/', 1) = auth.uid()::text
         or public._is_moderator(auth.uid())
         or exists (select 1 from public.proof_view_grants g where g.path = p_name and g.user_id = auth.uid()))
$$;

-- Playback: the owner, the person who asked for proof, and the lift's verifiers.
-- Same 2-minute grant, daily limit and monthly budget for everyone.
create or replace function public.request_proof_view(p_lift_id uuid)
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
  if v_lift.id is null or v_lift.video_path is null or not (
    v_lift.user_id = v_uid
    or public._is_proof_requester(v_uid, v_lift.id, v_lift.user_id, v_lift.visibility)
    or public._can_verify(v_uid, v_lift.id)
  ) then
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


create or replace function public.get_proof_state(p_lift_id uuid)
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
  v_appeal public.proof_appeals%rowtype;
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

  select * into v_appeal from public.proof_appeals where lift_id = p_lift_id;

  if v_owner then
    select jsonb_build_object('decision', r.decision, 'notes', r.notes, 'created_at', r.created_at)
    into v_review
    from public.verification_reviews r where r.lift_id = p_lift_id order by r.created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'status', case when v_owner then v_lift.verification_status::text else public._public_vstatus(v_lift.verification_status) end,
    'is_owner', v_owner,
    'has_video', v_lift.video_path is not null
      and (v_owner or public._is_proof_requester(v_uid, v_lift.id, v_lift.user_id, v_lift.visibility)
           or public._can_verify(v_uid, v_lift.id)),
    -- A friend or groupmate can confirm a video that's waiting.
    'can_verify', not v_owner and v_lift.verification_status = 'proof_uploaded' and v_lift.video_path is not null
      and public._can_verify(v_uid, v_lift.id),
    'verified_by', case when v_lift.verification_status = 'verified' then (
      select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)
      from public.verification_reviews r join public.profiles p on p.id = r.reviewer_id
      where r.lift_id = v_lift.id and r.decision = 'verified'
      order by r.created_at desc limit 1) end,
    'can_upload', v_owner and public._proof_upload_allowed(v_lift.id, v_lift.verification_status),
    'invalidated', v_lift.invalidated_at is not null,
    'can_appeal', false, -- appeals ended with moderator review (0012)
    'appeal', case when v_owner and v_appeal.id is not null then
      jsonb_build_object('status', v_appeal.status, 'note', v_appeal.note, 'created_at', v_appeal.created_at) end,
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


-- A friend or groupmate confirms a waiting video ("verified") or says it isn't
-- enough to tell ("insufficient": Disputed, the lift still counts, the video is
-- removed and the owner may add a clearer one). They must have opened the
-- video first. The first decision settles it.
create function public.verify_proof(p_lift_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lift public.lifts%rowtype;
  v_ch public.lift_challenges%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_decision is null or p_decision not in ('verified', 'insufficient') then raise exception 'invalid_decision'; end if;
  select * into v_lift from public.lifts
  where id = p_lift_id and deleted_at is null and verification_status = 'proof_uploaded' and video_path is not null
  for update;
  if v_lift.id is null or not public._can_verify(v_uid, v_lift.id) then raise exception 'not_found'; end if;
  if not exists (select 1 from public.proof_view_grants g where g.user_id = v_uid and g.path = v_lift.video_path) then
    raise exception 'watch_first';
  end if;

  insert into public.verification_reviews (lift_id, reviewer_id, decision)
  values (v_lift.id, v_uid, case when p_decision = 'verified' then 'verified' else 'disputed' end);
  update public.lifts set
    verification_status = case when p_decision = 'verified' then 'verified' else 'disputed' end::public.verification_status,
    video_path = case when p_decision = 'verified' then video_path end
  where id = v_lift.id;

  -- The owner hears who checked it; whoever asked for proof hears the outcome.
  insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
  values (v_lift.user_id, v_uid, 'proof_reviewed', v_lift.exercise_id, v_lift.id, p_decision);
  update public.lift_challenges set status = 'resolved', resolved_at = now()
  where lift_id = v_lift.id and status in ('open', 'proof_submitted')
  returning * into v_ch;
  if v_ch.id is not null and v_ch.challenger_id <> v_uid then
    insert into public.notifications (recipient_id, actor_id, type, exercise_id, lift_id, detail)
    values (v_ch.challenger_id, v_lift.user_id, 'proof_reviewed', v_lift.exercise_id, v_lift.id, p_decision);
  end if;

  return jsonb_build_object(
    'remove_paths', case when p_decision = 'verified' then '[]'::jsonb else jsonb_build_array(v_lift.video_path) end
  );
end;
$$;

-- Videos waiting for the viewer to check: friends' and groupmates' lifts.
create function public.get_proofs_to_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lift_id', l.id, 'exercise_name', e.name, 'ranking_method', e.ranking_method,
    'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit, 'weight_kg', l.weight_kg,
    'reps', l.reps, 'score', l.score,
    'user', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path)
  ) order by l.created_at desc), '[]'::jsonb)
  from (
    select l.* from public.lifts l
    where auth.uid() is not null and l.deleted_at is null
      and l.verification_status = 'proof_uploaded' and l.video_path is not null and l.user_id <> auth.uid()
      and public._can_verify(auth.uid(), l.id)
    order by l.created_at desc
    limit 10
  ) l
  join public.exercises e on e.id = l.exercise_id
  join public.profiles p on p.id = l.user_id
$$;


-- ───────────── Grants ─────────────
-- mod_proof_queue, mod_review_proof and appeal_proof are no longer granted.
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
  public._proof_can_delete(text)
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;

grant execute on function public.get_invite_preview(text) to anon;
