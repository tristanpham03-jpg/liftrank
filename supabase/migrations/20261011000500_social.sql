-- LiftRank 0005 — profiles, groups, invites, friends, blocks, notifications, feed, home.

-- ───────────── Profiles ─────────────
create function public.complete_username(p_username text, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_display text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_username !~ '^[a-z0-9_]{3,20}$' then raise exception 'username_invalid'; end if;
  if public.is_reserved_username(v_username) then raise exception 'username_reserved'; end if;
  if v_display is not null and char_length(v_display) > 40 then raise exception 'display_name_too_long'; end if;
  if exists (select 1 from public.profiles where username = v_username and id <> v_uid) then
    raise exception 'username_taken';
  end if;
  update public.profiles
  set username = v_username,
      display_name = coalesce(v_display, display_name, v_username),
      onboarded_at = coalesce(onboarded_at, now())
  where id = v_uid;
exception
  when unique_violation then raise exception 'username_taken';
end;
$$;

create function public.update_my_profile(
  p_display_name text,
  p_bio text,
  p_preferred_unit public.weight_unit,
  p_profile_visibility public.profile_visibility
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_display text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_display is not null and char_length(v_display) > 40 then raise exception 'display_name_too_long'; end if;
  if v_bio is not null and char_length(v_bio) > 160 then raise exception 'bio_too_long'; end if;
  update public.profiles
  set display_name = coalesce(v_display, username),
      bio = v_bio,
      preferred_unit = coalesce(p_preferred_unit, preferred_unit),
      profile_visibility = coalesce(p_profile_visibility, profile_visibility)
  where id = v_uid;
end;
$$;

create function public.get_my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
    'bio', p.bio, 'preferred_unit', p.preferred_unit, 'profile_visibility', p.profile_visibility,
    'public_leaderboard_opt_in', p.public_leaderboard_opt_in, 'onboarded_at', p.onboarded_at,
    'created_at', p.created_at,
    'settings', to_jsonb(s) - 'user_id' - 'updated_at'
  )
  from public.profiles p
  left join public.user_settings s on s.user_id = p.id
  where p.id = auth.uid()
$$;

create function public._relationship(p_me uuid, p_other uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_me = p_other then 'self'
    when exists (select 1 from public.blocks where blocker_id = p_me and blocked_id = p_other) then 'blocked'
    else coalesce((
      select case
        when f.status = 'accepted' then 'friends'
        when f.requester_id = p_me then 'outgoing'
        else 'incoming'
      end
      from public.friendships f
      where least(f.requester_id, f.addressee_id) = least(p_me, p_other)
        and greatest(f.requester_id, f.addressee_id) = greatest(p_me, p_other)
    ), 'none')
  end
$$;

-- Another user's profile as the caller may see it. Null when missing or blocked either way.
create function public.get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles%rowtype;
  v_rel text;
  v_details boolean;
  v_featured uuid[];
  v_friendship uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_p from public.profiles where username = lower(p_username);
  if not found then return null; end if;
  if v_p.id <> v_uid and exists (
    select 1 from public.blocks where blocker_id = v_p.id and blocked_id = v_uid
  ) then
    return null;
  end if;

  v_rel := public._relationship(v_uid, v_p.id);
  v_details := v_rel <> 'blocked' and (
    v_p.id = v_uid
    or v_p.profile_visibility = 'public'
    or (v_p.profile_visibility = 'friends' and v_rel = 'friends')
  );
  select featured_exercise_ids into v_featured from public.user_settings where user_id = v_p.id;
  select f.id into v_friendship from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(v_uid, v_p.id)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_uid, v_p.id);

  return jsonb_build_object(
    'id', v_p.id, 'username', v_p.username, 'display_name', v_p.display_name,
    'avatar_path', v_p.avatar_path, 'created_at', v_p.created_at,
    'relationship', v_rel, 'friendship_id', v_friendship,
    'can_see_details', v_details,
    'bio', case when v_details then v_p.bio end,
    'featured_exercise_ids', case when v_details then to_jsonb(coalesce(v_featured, '{}')) else '[]'::jsonb end,
    'prs', case when v_details and v_rel <> 'blocked' then public.get_prs(v_p.id) else '[]'::jsonb end,
    'friend_count', (select count(*) from public.friendships f
                     where f.status = 'accepted' and v_p.id in (f.requester_id, f.addressee_id))
  );
end;
$$;

-- ───────────── Groups ─────────────
create function public.create_group(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'onboarding_required';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 50 then raise exception 'group_name_invalid'; end if;
  if v_desc is not null and char_length(v_desc) > 280 then raise exception 'description_too_long'; end if;
  if (select count(*) from public.group_members where user_id = v_uid and role = 'owner') >= 20 then
    raise exception 'too_many_groups';
  end if;
  insert into public.groups (name, description, created_by) values (v_name, v_desc, v_uid) returning id into v_id;
  insert into public.group_members (group_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end;
$$;

create function public.update_group(p_group_id uuid, p_name text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if not public.am_group_admin(p_group_id) then raise exception 'forbidden'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 50 then raise exception 'group_name_invalid'; end if;
  if v_desc is not null and char_length(v_desc) > 280 then raise exception 'description_too_long'; end if;
  update public.groups set name = v_name, description = v_desc where id = p_group_id;
end;
$$;

create function public.delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public._role(p_group_id, auth.uid()) <> 'owner', true) then raise exception 'forbidden'; end if;
  delete from public.groups where id = p_group_id;
end;
$$;

create function public.get_my_groups()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'name', g.name, 'description', g.description, 'avatar_path', g.avatar_path,
    'role', m.role,
    'member_count', (select count(*) from public.group_members x where x.group_id = g.id),
    'champion_count', (select count(*) from public.record_history rh
                       where rh.group_id = g.id and rh.until is null and rh.user_id = auth.uid())
  ) order by g.name), '[]'::jsonb)
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
$$;

create function public.get_group(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public._member(p_group_id, v_uid) then return null; end if;
  return (
    select jsonb_build_object(
      'id', g.id, 'name', g.name, 'description', g.description, 'avatar_path', g.avatar_path,
      'created_at', g.created_at,
      'my_role', public._role(g.id, v_uid),
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'username', p.username, 'display_name', p.display_name,
          'avatar_path', p.avatar_path, 'role', m.role, 'joined_at', m.joined_at,
          'hidden', public._blocked(v_uid, m.user_id)
        ) order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at), '[]'::jsonb)
        from public.group_members m join public.profiles p on p.id = m.user_id
        where m.group_id = g.id
      ),
      'champions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'exercise_id', e.id, 'exercise_name', e.name, 'ranking_method', e.ranking_method,
          'user_id', rh.user_id, 'username', p.username, 'display_name', p.display_name,
          'since', rh.since, 'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit,
          'weight_kg', l.weight_kg, 'reps', l.reps, 'score', l.score
        ) order by e.popular_rank, e.name), '[]'::jsonb)
        from public.record_history rh
        join public.exercises e on e.id = rh.exercise_id
        left join public.profiles p on p.id = rh.user_id
        left join public.lifts l on l.id = rh.lift_id
        where rh.group_id = g.id and rh.until is null
          and (rh.user_id is null or not public._blocked(v_uid, rh.user_id))
      ),
      'board_exercises', (
        select coalesce(jsonb_agg(jsonb_build_object('exercise_id', x.id, 'exercise_name', x.name, 'lifters', x.lifters)
          order by x.lifters desc, x.name), '[]'::jsonb)
        from (
          select e.id, e.name, count(distinct l.user_id) as lifters
          from public.lifts l
          join public.group_members m on m.user_id = l.user_id and m.group_id = g.id
          join public.exercises e on e.id = l.exercise_id
          where l.is_ranked and l.deleted_at is null
            and (l.visibility = 'public' or (l.visibility = 'groups' and exists (
              select 1 from public.lift_group_shares s where s.lift_id = l.id and s.group_id = g.id)))
          group by e.id, e.name
        ) x
      ),
      'invites', case when public._role(g.id, v_uid) in ('owner', 'admin') then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'created_at', i.created_at, 'expires_at', i.expires_at,
          'max_uses', i.max_uses, 'use_count', i.use_count
        ) order by i.created_at desc), '[]'::jsonb)
        from public.group_invites i
        where i.group_id = g.id and i.revoked_at is null and i.expires_at > now()
          and (i.max_uses is null or i.use_count < i.max_uses)
      ) else '[]'::jsonb end
    )
    from public.groups g where g.id = p_group_id
  );
end;
$$;

create function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.group_role := public._role(p_group_id, auth.uid());
begin
  if v_role is null then raise exception 'not_a_member'; end if;
  if v_role = 'owner' then raise exception 'owner_must_transfer'; end if;
  delete from public.group_members where group_id = p_group_id and user_id = v_uid;
  perform public._sync_group_all(p_group_id);
end;
$$;

create function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role public.group_role := public._role(p_group_id, auth.uid());
  v_their_role public.group_role := public._role(p_group_id, p_user_id);
begin
  if v_their_role is null then raise exception 'not_a_member'; end if;
  if p_user_id = auth.uid() then raise exception 'use_leave'; end if;
  if v_my_role is null or v_my_role = 'member'
     or v_their_role = 'owner'
     or (v_my_role = 'admin' and v_their_role = 'admin') then
    raise exception 'forbidden';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
  perform public._sync_group_all(p_group_id);
end;
$$;

-- Owner only. p_role = 'owner' transfers ownership (the old owner becomes admin).
create function public.set_group_member_role(p_group_id uuid, p_user_id uuid, p_role public.group_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if coalesce(public._role(p_group_id, v_uid) <> 'owner', true) then raise exception 'forbidden'; end if;
  if p_user_id = v_uid then raise exception 'forbidden'; end if;
  if not public._member(p_group_id, p_user_id) then raise exception 'not_a_member'; end if;
  if p_role = 'owner' then
    update public.group_members set role = 'admin' where group_id = p_group_id and user_id = v_uid;
    update public.group_members set role = 'owner' where group_id = p_group_id and user_id = p_user_id;
  else
    update public.group_members set role = p_role where group_id = p_group_id and user_id = p_user_id;
  end if;
end;
$$;

-- ───────────── Invites ─────────────
-- Tokens are 32 random bytes (64 hex chars). Only their SHA-256 is stored.
create function public.create_group_invite(
  p_group_id uuid, p_expires_in_days integer default 7, p_max_uses integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz;
begin
  if not public.am_group_admin(p_group_id) then raise exception 'forbidden'; end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 30 then
    raise exception 'invalid_expiry';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 200) then raise exception 'invalid_max_uses'; end if;
  if (select count(*) from public.group_invites
      where group_id = p_group_id and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'too_many_invites';
  end if;
  v_expires := now() + make_interval(days => p_expires_in_days);
  insert into public.group_invites (group_id, token_hash, created_by, expires_at, max_uses)
  values (p_group_id, extensions.digest(v_token, 'sha256'), auth.uid(), v_expires, p_max_uses)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

create function public.revoke_group_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  select group_id into v_group from public.group_invites where id = p_invite_id;
  if v_group is null or not public.am_group_admin(v_group) then raise exception 'forbidden'; end if;
  update public.group_invites set revoked_at = now() where id = p_invite_id and revoked_at is null;
end;
$$;

create function public._invite_by_token(p_token text)
returns public.group_invites
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.group_invites
  where p_token ~ '^[0-9a-f]{64}$' and token_hash = extensions.digest(p_token, 'sha256')
$$;

-- Callable while signed out so the invite page can show the group name.
create function public.get_invite_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.group_invites;
  v_reason text;
begin
  v_inv := public._invite_by_token(p_token);
  if v_inv.id is null then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  v_reason := case
    when v_inv.revoked_at is not null then 'revoked'
    when v_inv.expires_at <= now() then 'expired'
    when v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then 'used_up'
    when (select count(*) from public.group_members where group_id = v_inv.group_id) >= 200 then 'group_full'
  end;
  return (
    select jsonb_build_object(
      'valid', v_reason is null,
      'reason', v_reason,
      'group_id', case when v_reason is null then g.id end,
      'group_name', case when v_reason is null then g.name end,
      'member_count', case when v_reason is null then
        (select count(*) from public.group_members m where m.group_id = g.id) end,
      'is_member', auth.uid() is not null and public._member(g.id, auth.uid())
    )
    from public.groups g where g.id = v_inv.group_id
  );
end;
$$;

create function public.accept_group_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.group_invites;
  v_admin uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'onboarding_required';
  end if;
  v_inv := public._invite_by_token(p_token);
  if v_inv.id is null then raise exception 'invite_invalid'; end if;
  perform pg_advisory_xact_lock(hashtext('group:' || v_inv.group_id));
  if public._member(v_inv.group_id, v_uid) then return v_inv.group_id; end if;

  select * into v_inv from public.group_invites where id = v_inv.id for update;
  if v_inv.revoked_at is not null or v_inv.expires_at <= now()
     or (v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses) then
    raise exception 'invite_invalid';
  end if;
  if (select count(*) from public.group_members where group_id = v_inv.group_id) >= 200 then
    raise exception 'group_full';
  end if;
  if exists (
    select 1 from public.group_members m
    where m.group_id = v_inv.group_id and m.role = 'owner' and public._blocked(m.user_id, v_uid)
  ) then
    raise exception 'invite_invalid';
  end if;

  insert into public.group_members (group_id, user_id, role) values (v_inv.group_id, v_uid, 'member');
  update public.group_invites set use_count = use_count + 1 where id = v_inv.id;

  insert into public.activities (actor_id, type, group_id) values (v_uid, 'joined_group', v_inv.group_id);
  for v_admin in
    select m.user_id from public.group_members m
    join public.user_settings s on s.user_id = m.user_id
    where m.group_id = v_inv.group_id and m.role in ('owner', 'admin') and m.user_id <> v_uid
      and s.notify_group_joins and not public._blocked(m.user_id, v_uid)
  loop
    insert into public.notifications (recipient_id, actor_id, type, group_id)
    values (v_admin, v_uid, 'group_joined', v_inv.group_id);
  end loop;

  perform public._sync_group_all(v_inv.group_id);
  return v_inv.group_id;
end;
$$;

-- ───────────── Friends & blocks ─────────────
create function public.search_users(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
    'relationship', public._relationship(auth.uid(), p.id)
  ) order by (p.username = lower(btrim(p_query))) desc, p.username), '[]'::jsonb)
  from (
    select * from public.profiles p
    where auth.uid() is not null
      and char_length(btrim(coalesce(p_query, ''))) >= 2
      and p.username is not null
      and p.id <> auth.uid()
      and not public._blocked(auth.uid(), p.id)
      and (
        starts_with(p.username, lower(btrim(p_query)))
        or starts_with(lower(coalesce(p.display_name, '')), lower(btrim(p_query)))
      )
    order by p.username
    limit 20
  ) p
$$;

create function public.send_friend_request(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_f public.friendships%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'invalid_user'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and username is not null) then
    raise exception 'invalid_user';
  end if;
  if public._blocked(v_uid, p_user_id) then raise exception 'invalid_user'; end if;

  select * into v_f from public.friendships
  where least(requester_id, addressee_id) = least(v_uid, p_user_id)
    and greatest(requester_id, addressee_id) = greatest(v_uid, p_user_id)
  for update;

  if found then
    if v_f.status = 'accepted' then return 'friends'; end if;
    if v_f.requester_id = v_uid then return 'outgoing'; end if;
    -- They already asked us: accept.
    perform public.respond_friend_request(v_f.id, true);
    return 'friends';
  end if;

  if (select count(*) from public.friendships where requester_id = v_uid and status = 'pending') >= 100 then
    raise exception 'too_many_requests';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_uid, p_user_id) returning id into v_id;
  if coalesce((select notify_friend_requests from public.user_settings where user_id = p_user_id), true) then
    insert into public.notifications (recipient_id, actor_id, type, friendship_id)
    values (p_user_id, v_uid, 'friend_request', v_id);
  end if;
  return 'outgoing';
end;
$$;

create function public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_f public.friendships%rowtype;
begin
  select * into v_f from public.friendships where id = p_friendship_id and addressee_id = v_uid and status = 'pending';
  if not found then raise exception 'not_found'; end if;
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now() where id = p_friendship_id;
    delete from public.notifications where friendship_id = p_friendship_id and type = 'friend_request';
    if coalesce((select notify_friend_requests from public.user_settings where user_id = v_f.requester_id), true) then
      insert into public.notifications (recipient_id, actor_id, type, friendship_id)
      values (v_f.requester_id, v_uid, 'friend_accepted', p_friendship_id);
    end if;
  else
    delete from public.friendships where id = p_friendship_id;
  end if;
end;
$$;

create function public.cancel_friend_request(p_friendship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where id = p_friendship_id and requester_id = auth.uid() and status = 'pending';
  if not found then raise exception 'not_found'; end if;
end;
$$;

create function public.remove_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where status = 'accepted'
    and least(requester_id, addressee_id) = least(auth.uid(), p_user_id)
    and greatest(requester_id, addressee_id) = greatest(auth.uid(), p_user_id);
end;
$$;

create function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'invalid_user'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_user_id) on conflict do nothing;
  delete from public.friendships
  where least(requester_id, addressee_id) = least(v_uid, p_user_id)
    and greatest(requester_id, addressee_id) = greatest(v_uid, p_user_id);
end;
$$;

create function public.unblock_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user_id
$$;

create function public.get_friends()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select f.*, case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as other_id
    from public.friendships f
    where auth.uid() in (f.requester_id, f.addressee_id)
  ),
  people as (
    select m.*, jsonb_build_object(
      'friendship_id', m.id, 'user_id', p.id, 'username', p.username,
      'display_name', p.display_name, 'avatar_path', p.avatar_path, 'since', coalesce(m.responded_at, m.created_at)
    ) as j
    from mine m join public.profiles p on p.id = m.other_id
  )
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(j order by j->>'username') from people where status = 'accepted'), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(j order by created_at desc) from people
                          where status = 'pending' and addressee_id = auth.uid()), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(j order by created_at desc) from people
                          where status = 'pending' and requester_id = auth.uid()), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'username', p.username, 'display_name', p.display_name)
                       order by p.username)
      from public.blocks b join public.profiles p on p.id = b.blocked_id
      where b.blocker_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null
$$;

-- ───────────── Notifications ─────────────
-- Visibility is re-checked at read time: a notification about a lift the
-- recipient can no longer see (private, deleted, blocked) is not returned.
create function public._visible_notifications(p_user uuid)
returns setof public.notifications
language sql
stable
security definer
set search_path = ''
as $$
  select n.*
  from public.notifications n
  left join public.lifts l on l.id = n.lift_id
  where n.recipient_id = p_user
    and (n.actor_id is null or not public._blocked(p_user, n.actor_id))
    and (n.lift_id is null or (
      l.deleted_at is null and public._can_view_lift(p_user, l.id, l.user_id, l.visibility)
    ))
    and (n.group_id is null or public._member(n.group_id, p_user))
$$;

create function public.get_notifications(p_limit integer default 50)
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
      'weight_kg', l.weight_kg, 'reps', l.reps, 'score', l.score) end,
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

create function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public._visible_notifications(auth.uid()) where read_at is null
$$;

create function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where recipient_id = auth.uid() and read_at is null
    and (p_ids is null or id = any (p_ids))
$$;

-- ───────────── Activity feed ─────────────
create function public._can_view_activity(p_viewer uuid, p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.activities a
    left join public.lifts l on l.id = a.lift_id
    where a.id = p_activity
      and p_viewer is not null
      and not public._blocked(p_viewer, a.actor_id)
      and (a.target_user_id is null or not public._blocked(p_viewer, a.target_user_id))
      and (a.lift_id is null or (l.deleted_at is null and public._can_view_lift(p_viewer, l.id, l.user_id, l.visibility)))
      and (
        a.actor_id = p_viewer
        or (a.group_id is null and public._friends(p_viewer, a.actor_id))
        or (a.group_id is not null and public._member(a.group_id, p_viewer))
      )
  )
$$;

create function public.get_feed(
  p_limit integer default 30, p_before timestamptz default null, p_group_id uuid default null,
  p_actor_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'type', a.type, 'created_at', a.created_at,
    'actor', jsonb_build_object('id', ac.id, 'username', ac.username, 'display_name', ac.display_name,
                                'avatar_path', ac.avatar_path),
    'target', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'username', t.username, 'display_name', t.display_name) end,
    'group', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
    'exercise', case when e.id is null then null else jsonb_build_object(
      'id', e.id, 'name', e.name, 'ranking_method', e.ranking_method) end,
    'lift', case when l.id is null then null else jsonb_build_object(
      'id', l.id, 'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit,
      'weight_kg', l.weight_kg, 'reps', l.reps, 'score', l.score) end,
    'reactions', (
      select coalesce(jsonb_object_agg(r.emoji, r.n), '{}'::jsonb)
      from (select emoji, count(*) n from public.activity_reactions where activity_id = a.id group by emoji) r
    ),
    'my_reactions', (
      select coalesce(jsonb_agg(emoji), '[]'::jsonb)
      from public.activity_reactions where activity_id = a.id and user_id = auth.uid()
    )
  ) order by a.created_at desc), '[]'::jsonb)
  from (
    select a.*
    from public.activities a
    where auth.uid() is not null
      and (p_before is null or a.created_at < p_before)
      and (p_group_id is null or a.group_id = p_group_id)
      and (p_actor_id is null or a.actor_id = p_actor_id)
      and (
        a.actor_id = auth.uid()
        or public._friends(auth.uid(), a.actor_id)
        or (a.group_id is not null and public._member(a.group_id, auth.uid()))
      )
      and public._can_view_activity(auth.uid(), a.id)
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) a
  join public.profiles ac on ac.id = a.actor_id
  left join public.profiles t on t.id = a.target_user_id
  left join public.groups g on g.id = a.group_id
  left join public.exercises e on e.id = a.exercise_id
  left join public.lifts l on l.id = a.lift_id
$$;

create function public.toggle_reaction(p_activity_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public._can_view_activity(v_uid, p_activity_id) then raise exception 'not_found'; end if;
  if p_emoji not in ('💪', '🔥', '👏') then raise exception 'invalid_reaction'; end if;
  delete from public.activity_reactions where activity_id = p_activity_id and user_id = v_uid and emoji = p_emoji;
  if found then return false; end if;
  insert into public.activity_reactions (activity_id, user_id, emoji) values (p_activity_id, v_uid, p_emoji);
  return true;
end;
$$;

-- ───────────── Home ─────────────
create function public.get_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_boards jsonb := '[]'::jsonb;
  v_ex record;
  v_board record;
  v_me record;
  v_above jsonb;
  v_total integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  for v_ex in
    select l.exercise_id, e.name, e.ranking_method, max(l.created_at) as last_logged
    from public.lifts l join public.exercises e on e.id = l.exercise_id
    where l.user_id = v_uid and l.deleted_at is null and l.is_ranked and l.visibility <> 'private'
    group by l.exercise_id, e.name, e.ranking_method
  loop
    for v_board in
      select 'friends'::text as kind, null::uuid as group_id, null::text as group_name
      union all
      select 'group', g.id, g.name
      from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = v_uid
    loop
      select count(*) into v_total from public._board(v_uid, v_board.kind, v_board.group_id, v_ex.exercise_id, 'all');
      select * into v_me from public._board(v_uid, v_board.kind, v_board.group_id, v_ex.exercise_id, 'all') b
      where b.uid = v_uid;
      continue when v_me.pos is null;

      v_above := null;
      if v_me.pos > 1 then
        select jsonb_build_object(
          'user_id', b.uid, 'username', p.username, 'display_name', p.display_name,
          'avatar_path', p.avatar_path, 'rank', b.pos, 'entered_weight', b.entered_weight,
          'entered_unit', b.entered_unit, 'weight_kg', b.weight_kg, 'reps', b.reps, 'score', b.score)
        into v_above
        from public._board(v_uid, v_board.kind, v_board.group_id, v_ex.exercise_id, 'all') b
        join public.profiles p on p.id = b.uid
        where b.pos < v_me.pos and not public._blocked(v_uid, b.uid)
        order by b.pos desc limit 1;
      end if;

      v_boards := v_boards || jsonb_build_object(
        'exercise_id', v_ex.exercise_id, 'exercise_name', v_ex.name, 'ranking_method', v_ex.ranking_method,
        'kind', v_board.kind, 'group_id', v_board.group_id, 'group_name', v_board.group_name,
        'rank', v_me.pos, 'total', v_total,
        'recent', v_ex.last_logged > now() - interval '60 days',
        'me', jsonb_build_object('lift_id', v_me.lid, 'entered_weight', v_me.entered_weight,
          'entered_unit', v_me.entered_unit, 'weight_kg', v_me.weight_kg, 'reps', v_me.reps, 'score', v_me.score),
        'above', v_above
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'boards', v_boards,
    'lift_count', (select count(*) from public.lifts where user_id = v_uid and deleted_at is null),
    'friend_count', (select count(*) from public.friendships f
                     where f.status = 'accepted' and v_uid in (f.requester_id, f.addressee_id)),
    'group_count', (select count(*) from public.group_members where user_id = v_uid),
    'unread', public.unread_notification_count()
  );
end;
$$;

-- ───────────── Account deletion ─────────────
-- Called by the signed-in user right before the server deletes their auth user.
-- Hands off group ownership, removes them from every board, then lets FK
-- cascades remove personal data. record_history rows keep user_id = null.
create function public.prepare_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group uuid;
  v_heir uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  for v_group in select group_id from public.group_members where user_id = v_uid and role = 'owner' loop
    select user_id into v_heir from public.group_members
    where group_id = v_group and user_id <> v_uid
    order by case role when 'admin' then 0 else 1 end, joined_at
    limit 1;
    if v_heir is null then
      delete from public.groups where id = v_group;
    else
      update public.group_members set role = 'member' where group_id = v_group and user_id = v_uid;
      update public.group_members set role = 'owner' where group_id = v_group and user_id = v_heir;
    end if;
  end loop;

  update public.lifts set deleted_at = now() where user_id = v_uid and deleted_at is null;
  for v_group in select group_id from public.group_members where user_id = v_uid loop
    delete from public.group_members where group_id = v_group and user_id = v_uid;
    perform public._sync_group_all(v_group);
  end loop;
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
  public.get_leaderboard(uuid, text, uuid, text, integer, integer),
  public.submit_lift(uuid, numeric, public.weight_unit, integer, timestamptz, public.lift_visibility, uuid[], text, uuid),
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
  public.prepare_account_deletion()
to authenticated;

grant execute on function public.get_invite_preview(text) to anon;
