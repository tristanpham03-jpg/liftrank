-- LiftRank 0002 — tables, constraints, indexes.

-- ───────────── Gyms & machines (UI arrives in Phase 4) ─────────────
create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  address text check (address is null or char_length(address) <= 200),
  city text not null check (char_length(city) <= 100),
  region text check (region is null or char_length(region) <= 100),
  country text not null check (char_length(country) <= 100),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  status public.moderation_status not null default 'pending',
  submitted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ───────────── Profiles ─────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (
    username is null
    or (username ~ '^[a-z0-9_]{3,20}$' and not public.is_reserved_username(username))
  ),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  bio text check (bio is null or char_length(bio) <= 160),
  primary_gym_id uuid references public.gyms (id) on delete set null,
  preferred_unit public.weight_unit not null default 'lb',
  profile_visibility public.profile_visibility not null default 'public',
  public_leaderboard_opt_in boolean not null default false,
  is_moderator boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  default_visibility public.lift_visibility not null default 'public',
  notify_friend_requests boolean not null default true,
  notify_passed boolean not null default true,
  notify_first_place boolean not null default true,
  notify_group_joins boolean not null default true,
  featured_exercise_ids uuid[] not null default '{}' check (cardinality(featured_exercise_ids) <= 6),
  updated_at timestamptz not null default now()
);

-- ───────────── Exercise catalog ─────────────
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  category public.exercise_category not null,
  muscle_group text not null,
  equipment_type public.equipment_type not null,
  ranking_method public.ranking_method not null,
  weight_convention public.weight_convention not null,
  supports_machine_selection boolean not null default false,
  max_weight_kg numeric check (max_weight_kg is null or max_weight_kg > 0),
  flag_threshold_kg numeric check (flag_threshold_kg is null or flag_threshold_kg > 0),
  popular_rank smallint not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((ranking_method = 'max_reps') = (max_weight_kg is null)),
  check ((ranking_method = 'max_reps') = (weight_convention = 'bodyweight'))
);

create table public.exercise_aliases (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  alias text not null check (alias = lower(alias) and char_length(alias) between 2 and 40),
  unique (exercise_id, alias)
);

create table public.favorite_exercises (
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create table public.machine_manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.machine_models (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.machine_manufacturers (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  equipment_type public.equipment_type not null,
  status public.moderation_status not null default 'pending',
  submitted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (manufacturer_id, name)
);

create table public.gym_memberships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, gym_id)
);

create table public.gym_equipment (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  machine_model_id uuid references public.machine_models (id) on delete set null,
  label text check (label is null or char_length(label) <= 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ───────────── Groups ─────────────
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 50),
  description text check (description is null or char_length(description) <= 280),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create unique index group_members_one_owner_uidx on public.group_members (group_id) where role = 'owner';
create index group_members_user_idx on public.group_members (user_id);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  max_uses integer check (max_uses is null or max_uses between 1 and 200),
  use_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_invites_group_idx on public.group_invites (group_id);

-- ───────────── Friends & blocks ─────────────
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_uidx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester_idx on public.friendships (requester_id);
create index friendships_addressee_idx on public.friendships (addressee_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- ───────────── Lifts ─────────────
create table public.lifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  -- Exactly what the user typed, for drift-free display in their own unit.
  entered_weight numeric check (entered_weight is null or entered_weight > 0),
  entered_unit public.weight_unit,
  -- Normalized load. For weight_convention = 'added' this is the added load only.
  weight_kg numeric check (weight_kg is null or weight_kg > 0),
  reps integer not null check (reps between 1 and 200),
  weight_convention public.weight_convention not null,
  score numeric,
  is_ranked boolean not null,
  performed_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Lifts logged more than 3 days after they happened count all-time but not
  -- on monthly boards, so a finished month can't be rewritten.
  monthly_eligible boolean generated always as (created_at - performed_at <= interval '3 days') stored,
  visibility public.lift_visibility not null,
  verification_status public.verification_status not null default 'unverified',
  flagged_for_review boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 280),
  gym_id uuid references public.gyms (id) on delete set null,
  machine_model_id uuid references public.machine_models (id) on delete set null,
  gym_equipment_id uuid references public.gym_equipment (id) on delete set null,
  video_path text,
  idempotency_key uuid,
  deleted_at timestamptz,
  check ((entered_weight is null) = (weight_kg is null)),
  check ((entered_weight is null) = (entered_unit is null)),
  check (not is_ranked or score is not null)
);
create unique index lifts_idempotency_uidx on public.lifts (user_id, idempotency_key) where idempotency_key is not null;
create index lifts_board_idx on public.lifts (exercise_id, score desc) where deleted_at is null and is_ranked;
create index lifts_user_exercise_idx on public.lifts (user_id, exercise_id, score desc) where deleted_at is null;
create index lifts_exercise_performed_idx on public.lifts (exercise_id, performed_at) where deleted_at is null;
create index lifts_user_created_idx on public.lifts (user_id, created_at desc);

create table public.lift_group_shares (
  lift_id uuid not null references public.lifts (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  primary key (lift_id, group_id)
);
create index lift_group_shares_group_idx on public.lift_group_shares (group_id);

-- ───────────── Social surfaces ─────────────
-- Activities and notifications reference lifts; weights are never copied here.
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('pr', 'passed', 'first_place', 'joined_group')),
  lift_id uuid references public.lifts (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete cascade,
  target_user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index activities_actor_idx on public.activities (actor_id, created_at desc);
create index activities_group_idx on public.activities (group_id, created_at desc) where group_id is not null;
create index activities_created_idx on public.activities (created_at desc);

create table public.activity_reactions (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('💪', '🔥', '👏')),
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id, emoji)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete cascade,
  type text not null check (type in ('friend_request', 'friend_accepted', 'passed', 'first_place', 'group_joined')),
  group_id uuid references public.groups (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete cascade,
  lift_id uuid references public.lifts (id) on delete cascade,
  friendship_id uuid references public.friendships (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_rate_idx on public.notifications (recipient_id, actor_id, type, exercise_id, created_at desc);

-- ───────────── Records, achievements, analytics ─────────────
create table public.achievements (
  id text primary key,
  name text not null,
  description text not null,
  sort_order smallint not null default 0
);

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id) on delete cascade,
  earned_at timestamptz not null default now(),
  context jsonb not null default '{}',
  primary key (user_id, achievement_id)
);

-- One open row (until is null) per board = the current champion.
create table public.record_history (
  id uuid primary key default gen_random_uuid(),
  board_key text not null,
  group_id uuid references public.groups (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  lift_id uuid references public.lifts (id) on delete set null,
  since timestamptz not null default now(),
  until timestamptz
);
create unique index record_history_open_uidx on public.record_history (board_key) where until is null;
create index record_history_group_idx on public.record_history (group_id, exercise_id);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null check (name ~ '^[a-z_]{3,40}$'),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index analytics_events_name_idx on public.analytics_events (name, created_at);

-- ───────────── Verification & moderation (UI arrives in Phase 5) ─────────────
create table public.lift_challenges (
  id uuid primary key default gen_random_uuid(),
  lift_id uuid not null references public.lifts (id) on delete cascade,
  challenger_id uuid not null references public.profiles (id) on delete cascade,
  challenged_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'proof_submitted', 'declined', 'resolved', 'withdrawn')),
  reason text check (reason is null or char_length(reason) <= 280),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (challenger_id <> challenged_user_id)
);
create unique index lift_challenges_active_uidx on public.lift_challenges (lift_id) where status in ('open', 'proof_submitted');

create table public.verification_reviews (
  id uuid primary key default gen_random_uuid(),
  lift_id uuid not null references public.lifts (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  decision text not null check (decision in ('verified', 'rejected', 'disputed')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('lift', 'profile', 'group')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

-- ───────────── Housekeeping triggers ─────────────
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();
create trigger groups_touch before update on public.groups
  for each row execute function public.touch_updated_at();

-- Every new auth user gets a profile and settings row.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
