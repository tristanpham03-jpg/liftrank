-- LiftRank 0014 — Edit lifts; friend invite links.
--
-- 1. edit_lift: owners can correct a lift instead of deleting and re-logging.
--    Same validation as submit_lift. If the performance changes (exercise,
--    weight, reps, date or machine), verification is cleared (video removed,
--    open proof requests withdrawn) and feed items / "passed you" notifications
--    that described the old numbers are removed, so nothing is duplicated or
--    left stale. Notes-only or visibility-only edits keep verification.
--    Champions and gym records are recalculated; PRs and boards are computed
--    live. Meaningful changes are kept in lift_edits (owner-readable audit).
-- 2. Friend invite links: a personal link (hashed token, 30 days, 50 uses).
--    Opening it never adds anyone: the invitee taps "Add friend" to accept.
--
-- Additive. No existing rows change.

create table public.lift_edits (
  id bigint generated always as identity primary key,
  lift_id uuid not null references public.lifts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  before jsonb not null,
  after jsonb not null,
  performance_changed boolean not null,
  created_at timestamptz not null default now()
);
create index lift_edits_lift_idx on public.lift_edits (lift_id, created_at desc);
create index lift_edits_user_idx on public.lift_edits (user_id, created_at desc);
alter table public.lift_edits enable row level security;
revoke all on public.lift_edits from anon, authenticated;
grant all on public.lift_edits to service_role;
grant select on public.lift_edits to authenticated;
create policy lift_edits_own_read on public.lift_edits for select to authenticated using (user_id = auth.uid());

create function public.edit_lift(
  p_lift_id uuid,
  p_exercise_id uuid,
  p_weight numeric,
  p_unit public.weight_unit,
  p_reps integer,
  p_performed_at timestamptz,
  p_visibility public.lift_visibility,
  p_group_ids uuid[] default '{}',
  p_notes text default null,
  p_machine_manufacturer_id uuid default null,
  p_machine_model_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.lifts%rowtype;
  v_ex public.exercises%rowtype;
  v_weight_kg numeric;
  v_score numeric;
  v_ranked boolean;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_mfr uuid := p_machine_manufacturer_id;
  v_model public.machine_models%rowtype;
  v_perf boolean;
  v_old_groups uuid[];
  v_new_groups uuid[];
  v_remove text;
  v_gym uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_old from public.lifts where id = p_lift_id and user_id = v_uid and deleted_at is null for update;
  if v_old.id is null then raise exception 'not_found'; end if;
  if (select count(*) from public.lift_edits where user_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_edits';
  end if;

  -- Validation (same rules as submit_lift and src/lib/validation.ts).
  select * into v_ex from public.exercises where id = p_exercise_id and is_active;
  if not found then raise exception 'invalid_exercise'; end if;
  if v_ex.ranking_method = 'max_reps' then
    if p_weight is not null then raise exception 'weight_not_allowed'; end if;
    if p_reps is null or p_reps < 1 or p_reps > 200 then raise exception 'invalid_reps'; end if;
  else
    if p_weight is null or p_weight <= 0 or p_weight <> round(p_weight, 2) then raise exception 'invalid_weight'; end if;
    if p_unit is null then raise exception 'invalid_unit'; end if;
    if p_reps is null or p_reps < 1 or p_reps > 50 then raise exception 'invalid_reps'; end if;
    v_weight_kg := case when p_unit = 'kg' then p_weight else p_weight * 0.45359237 end;
    if v_weight_kg > v_ex.max_weight_kg then raise exception 'weight_too_high'; end if;
  end if;
  if p_performed_at is null then raise exception 'invalid_date'; end if;
  if p_performed_at > now() + interval '5 minutes' then raise exception 'future_date'; end if;
  if p_performed_at < now() - interval '5 years' then raise exception 'date_too_old'; end if;
  if v_notes is not null and char_length(v_notes) > 280 then raise exception 'notes_too_long'; end if;
  if p_machine_model_id is not null or p_machine_manufacturer_id is not null then
    if not v_ex.supports_machine_selection then raise exception 'machine_not_allowed'; end if;
  end if;
  if p_machine_model_id is not null then
    select * into v_model from public.machine_models where id = p_machine_model_id and status <> 'rejected';
    if not found then raise exception 'invalid_machine'; end if;
    if v_mfr is not null and v_mfr <> v_model.manufacturer_id then raise exception 'invalid_machine'; end if;
    v_mfr := v_model.manufacturer_id;
  elsif v_mfr is not null and not exists (select 1 from public.machine_manufacturers where id = v_mfr) then
    raise exception 'invalid_machine';
  end if;
  if p_visibility is null then raise exception 'invalid_visibility'; end if;
  if p_visibility = 'groups' then
    if coalesce(cardinality(p_group_ids), 0) = 0 then raise exception 'groups_required'; end if;
    if exists (select 1 from unnest(p_group_ids) g(id) where not public._member(g.id, v_uid)) then
      raise exception 'not_a_member';
    end if;
  end if;

  select s.score, s.is_ranked into v_score, v_ranked
  from public.compute_score(v_ex.ranking_method, v_weight_kg, p_reps) s;

  v_perf := v_old.exercise_id <> p_exercise_id
    or v_old.weight_kg is distinct from v_weight_kg
    or v_old.reps <> p_reps
    or v_old.performed_at <> p_performed_at
    or v_old.machine_manufacturer_id is distinct from v_mfr
    or v_old.machine_model_id is distinct from p_machine_model_id;

  v_old_groups := array(select group_id from public.lift_group_shares where lift_id = p_lift_id order by group_id);
  v_new_groups := case when p_visibility = 'groups' then array(select distinct g from unnest(p_group_ids) g order by g) else '{}'::uuid[] end;

  -- Audit meaningful changes (performance, visibility or sharing; not notes alone).
  if v_perf or v_old.visibility <> p_visibility or v_old_groups is distinct from v_new_groups then
    insert into public.lift_edits (lift_id, user_id, before, after, performance_changed)
    values (p_lift_id, v_uid,
      jsonb_build_object('exercise_id', v_old.exercise_id, 'entered_weight', v_old.entered_weight, 'entered_unit', v_old.entered_unit,
        'reps', v_old.reps, 'performed_at', v_old.performed_at, 'visibility', v_old.visibility, 'group_ids', to_jsonb(v_old_groups),
        'machine_manufacturer_id', v_old.machine_manufacturer_id, 'machine_model_id', v_old.machine_model_id,
        'verification_status', v_old.verification_status),
      jsonb_build_object('exercise_id', p_exercise_id, 'entered_weight', case when v_weight_kg is null then null else p_weight end,
        'entered_unit', case when v_weight_kg is null then null else p_unit end, 'reps', p_reps, 'performed_at', p_performed_at,
        'visibility', p_visibility, 'group_ids', to_jsonb(v_new_groups),
        'machine_manufacturer_id', v_mfr, 'machine_model_id', p_machine_model_id),
      v_perf);
  end if;

  if v_perf then
    -- The old proof (and any check of it) no longer matches the claim.
    v_remove := v_old.video_path;
    update public.lift_challenges set status = 'withdrawn', resolved_at = now()
    where lift_id = p_lift_id and status in ('open', 'proof_submitted');
    -- Feed items and "passed you"/"first place" notices described the old numbers.
    delete from public.activities where lift_id = p_lift_id;
    delete from public.notifications where lift_id = p_lift_id and type in ('passed', 'first_place', 'gym_record');
  end if;

  update public.lifts set
    exercise_id = p_exercise_id,
    entered_weight = case when v_weight_kg is null then null else p_weight end,
    entered_unit = case when v_weight_kg is null then null else p_unit end,
    weight_kg = v_weight_kg,
    reps = p_reps,
    weight_convention = v_ex.weight_convention,
    score = v_score,
    is_ranked = v_ranked,
    performed_at = p_performed_at,
    flagged_for_review = coalesce(v_weight_kg > v_ex.flag_threshold_kg, false),
    machine_manufacturer_id = v_mfr,
    machine_model_id = p_machine_model_id,
    visibility = p_visibility,
    notes = v_notes,
    verification_status = case when v_perf then 'unverified'::public.verification_status else verification_status end,
    video_path = case when v_perf then null else video_path end,
    invalidated_at = case when v_perf then null else invalidated_at end
  where id = p_lift_id;

  delete from public.lift_group_shares where lift_id = p_lift_id;
  if p_visibility = 'groups' then
    insert into public.lift_group_shares (lift_id, group_id) select p_lift_id, g from unnest(v_new_groups) g;
  end if;

  -- Titles follow the lift (its old and new exercise).
  perform public._sync_user_groups(v_uid, v_old.exercise_id);
  if p_exercise_id <> v_old.exercise_id then perform public._sync_user_groups(v_uid, p_exercise_id); end if;
  select primary_gym_id into v_gym from public.profiles where id = v_uid and public_leaderboard_opt_in;
  if v_gym is not null then
    perform public._sync_gym_record(v_gym, v_old.exercise_id);
    if p_exercise_id <> v_old.exercise_id then perform public._sync_gym_record(v_gym, p_exercise_id); end if;
  end if;

  return jsonb_build_object('lift_id', p_lift_id, 'performance_changed', v_perf,
    'remove_paths', case when v_remove is null then '[]'::jsonb else jsonb_build_array(v_remove) end);
end;
$$;

-- ───────────── Friend invite links ─────────────
create table public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  uses integer not null default 0,
  max_uses integer not null default 50,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);
create index friend_invites_inviter_idx on public.friend_invites (inviter_id, created_at desc);
alter table public.friend_invites enable row level security;
revoke all on public.friend_invites from anon, authenticated;
grant all on public.friend_invites to service_role;

-- A new personal invite link. Only the hash is stored; the token is returned once.
create function public.create_friend_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then raise exception 'onboarding_required'; end if;
  if (select count(*) from public.friend_invites where inviter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'too_many_friend_invites';
  end if;
  insert into public.friend_invites (inviter_id, token_hash) values (v_uid, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;

create function public._friend_invite_by_token(p_token text)
returns public.friend_invites
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.friend_invites
  where p_token ~ '^[0-9a-f]{64}$' and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and expires_at > now() and uses < max_uses
$$;

-- Who invited you (shown on the invite page, signed in or not).
create function public.get_friend_invite_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when i.id is null then jsonb_build_object('valid', false) else jsonb_build_object(
    'valid', true,
    'inviter', jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path),
    'relationship', case when auth.uid() is null then null else public._relationship(auth.uid(), p.id) end
  ) end
  from (select 1) one
  left join lateral public._friend_invite_by_token(p_token) i on true
  left join public.profiles p on p.id = i.inviter_id
$$;

-- The invitee's deliberate "Add friend". Blocks always win.
create function public.accept_friend_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.friend_invites%rowtype;
  v_f public.friendships%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then raise exception 'onboarding_required'; end if;
  select * into v_inv from public._friend_invite_by_token(p_token);
  if v_inv.id is null then raise exception 'invite_invalid'; end if;
  if v_inv.inviter_id = v_uid or public._blocked(v_uid, v_inv.inviter_id) then raise exception 'invalid_user'; end if;

  select * into v_f from public.friendships
  where least(requester_id, addressee_id) = least(v_uid, v_inv.inviter_id)
    and greatest(requester_id, addressee_id) = greatest(v_uid, v_inv.inviter_id)
  for update;
  if v_f.id is not null and v_f.status = 'accepted' then
    return jsonb_build_object('status', 'already_friends', 'username', (select username from public.profiles where id = v_inv.inviter_id));
  end if;
  if v_f.id is null then
    insert into public.friendships (requester_id, addressee_id, status, responded_at)
    values (v_inv.inviter_id, v_uid, 'accepted', now());
  else
    update public.friendships set status = 'accepted', responded_at = now() where id = v_f.id;
  end if;
  update public.friend_invites set uses = uses + 1 where id = v_inv.id;
  if coalesce((select notify_friend_requests from public.user_settings where user_id = v_inv.inviter_id), true) then
    insert into public.notifications (recipient_id, actor_id, type) values (v_inv.inviter_id, v_uid, 'friend_accepted');
  end if;
  return jsonb_build_object('status', 'friends', 'username', (select username from public.profiles where id = v_inv.inviter_id));
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
  public._proof_can_delete(text)
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;

grant execute on function public.get_invite_preview(text), public.get_friend_invite_preview(text) to anon;
