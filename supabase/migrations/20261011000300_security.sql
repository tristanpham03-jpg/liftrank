-- LiftRank 0003 — visibility helpers, row-level security, table grants.
--
-- Model: clients read the catalog, their own settings/favorites, and lifts
-- (through RLS) directly. Every write and every social read goes through a
-- SECURITY DEFINER function that checks auth.uid() and visibility itself.

-- ───────────── Internal helpers (not callable by clients) ─────────────
create function public._blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  )
$$;

create function public._friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and least(requester_id, addressee_id) = least(a, b)
      and greatest(requester_id, addressee_id) = greatest(a, b)
  )
$$;

create function public._member(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = p_user)
$$;

create function public._role(p_group uuid, p_user uuid)
returns public.group_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.group_members where group_id = p_group and user_id = p_user
$$;

-- Can p_viewer see this lift? The single visibility rule for the whole app.
create function public._can_view_lift(
  p_viewer uuid, p_lift uuid, p_owner uuid, p_visibility public.lift_visibility
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_viewer is null then false
    when p_owner = p_viewer then true
    when public._blocked(p_viewer, p_owner) then false
    when p_visibility = 'public' then true
    when p_visibility = 'friends' then public._friends(p_viewer, p_owner)
    when p_visibility = 'groups' then exists (
      select 1
      from public.lift_group_shares s
      join public.group_members viewer_m on viewer_m.group_id = s.group_id and viewer_m.user_id = p_viewer
      join public.group_members owner_m on owner_m.group_id = s.group_id and owner_m.user_id = p_owner
      where s.lift_id = p_lift
    )
    else false
  end
$$;

-- ───────────── Client-callable helpers used inside policies ─────────────
-- These only answer questions about the caller, never about two arbitrary users.
create function public.can_view_lift(p_lift uuid, p_owner uuid, p_visibility public.lift_visibility)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._can_view_lift(auth.uid(), p_lift, p_owner, p_visibility) $$;

create function public.is_blocked_with_me(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select auth.uid() is not null and public._blocked(auth.uid(), p_other) $$;

create function public.am_group_member(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select auth.uid() is not null and public._member(p_group, auth.uid()) $$;

create function public.am_group_admin(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public._role(p_group, auth.uid()) in ('owner', 'admin'), false) $$;

-- ───────────── Row-level security ─────────────
alter table public.gyms enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_aliases enable row level security;
alter table public.favorite_exercises enable row level security;
alter table public.machine_manufacturers enable row level security;
alter table public.machine_models enable row level security;
alter table public.gym_memberships enable row level security;
alter table public.gym_equipment enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.lifts enable row level security;
alter table public.lift_group_shares enable row level security;
alter table public.activities enable row level security;
alter table public.activity_reactions enable row level security;
alter table public.notifications enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.record_history enable row level security;
alter table public.analytics_events enable row level security;
alter table public.lift_challenges enable row level security;
alter table public.verification_reviews enable row level security;
alter table public.reports enable row level security;

-- Catalog: readable by everyone.
create policy exercises_read on public.exercises for select to anon, authenticated using (is_active);
create policy exercise_aliases_read on public.exercise_aliases for select to anon, authenticated using (true);
create policy manufacturers_read on public.machine_manufacturers for select to authenticated using (true);
create policy machine_models_read on public.machine_models for select to authenticated
  using (status = 'approved' or submitted_by = auth.uid());
create policy gyms_read on public.gyms for select to authenticated
  using (status = 'approved' or submitted_by = auth.uid());
create policy achievements_read on public.achievements for select to authenticated using (true);

-- Profiles: basic identity columns only (see column grants below); hidden across blocks.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or not public.is_blocked_with_me(id));

-- Own rows.
create policy user_settings_own_read on public.user_settings for select to authenticated
  using (user_id = auth.uid());
create policy user_settings_own_update on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy favorites_own_read on public.favorite_exercises for select to authenticated
  using (user_id = auth.uid());
create policy favorites_own_insert on public.favorite_exercises for insert to authenticated
  with check (user_id = auth.uid());
create policy favorites_own_delete on public.favorite_exercises for delete to authenticated
  using (user_id = auth.uid());
create policy gym_memberships_own_read on public.gym_memberships for select to authenticated
  using (user_id = auth.uid());
create policy blocks_own_read on public.blocks for select to authenticated
  using (blocker_id = auth.uid());
create policy friendships_own_read on public.friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy user_achievements_read on public.user_achievements for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked_with_me(user_id));
create policy reports_own_insert on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());
create policy analytics_own_insert on public.analytics_events for insert to authenticated
  with check (user_id = auth.uid());

-- Groups are private: members only.
create policy groups_member_read on public.groups for select to authenticated
  using (public.am_group_member(id));
create policy group_members_member_read on public.group_members for select to authenticated
  using (public.am_group_member(group_id));
create policy group_invites_admin_read on public.group_invites for select to authenticated
  using (public.am_group_admin(group_id));
create policy record_history_member_read on public.record_history for select to authenticated
  using (group_id is not null and public.am_group_member(group_id));

-- Lifts: the core visibility rule.
create policy lifts_visible_read on public.lifts for select to authenticated
  using (deleted_at is null and public.can_view_lift(id, user_id, visibility));
create policy lift_group_shares_owner_read on public.lift_group_shares for select to authenticated
  using (exists (select 1 from public.lifts l where l.id = lift_id and l.user_id = auth.uid()));

-- activities, activity_reactions, notifications, lift_challenges, verification_reviews:
-- RLS on, no policies → no direct access. Read through get_feed / get_notifications.

-- ───────────── Grants ─────────────
-- Supabase grants broad table privileges to anon/authenticated by default.
-- Reset to an explicit allow-list.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.exercises, public.exercise_aliases to anon, authenticated;
grant select on public.machine_manufacturers, public.machine_models, public.gyms, public.achievements to authenticated;
grant select (id, username, display_name, avatar_path, created_at) on public.profiles to authenticated;
grant select on public.user_settings to authenticated;
grant update (default_visibility, notify_friend_requests, notify_passed, notify_first_place, notify_group_joins, featured_exercise_ids)
  on public.user_settings to authenticated;
grant select, insert, delete on public.favorite_exercises to authenticated;
grant select on public.gym_memberships, public.blocks, public.friendships, public.user_achievements to authenticated;
grant select on public.groups, public.group_members, public.group_invites, public.record_history to authenticated;
grant select on public.lifts, public.lift_group_shares to authenticated;
grant insert on public.reports, public.analytics_events to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.can_view_lift(uuid, uuid, public.lift_visibility),
  public.is_blocked_with_me(uuid),
  public.am_group_member(uuid),
  public.am_group_admin(uuid),
  public.app_timezone(),
  public.is_reserved_username(text),
  public.compute_score(public.ranking_method, numeric, integer)
to authenticated;
