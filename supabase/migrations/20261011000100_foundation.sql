-- LiftRank 0001 — extensions, enum types, app-wide constants.

create extension if not exists pgcrypto with schema extensions;

create type public.weight_unit as enum ('lb', 'kg');
create type public.lift_visibility as enum ('private', 'groups', 'friends', 'public');
create type public.profile_visibility as enum ('public', 'friends', 'private');
create type public.ranking_method as enum ('e1rm', 'max_reps', 'added_load_e1rm', 'none');
-- total: whole load incl. bar · per_dumbbell · stack: selectorized/cable pin number
-- plates_total: plates on both sides, excluding sled · added: belt/vest load · bodyweight: none
create type public.weight_convention as enum ('total', 'per_dumbbell', 'stack', 'plates_total', 'added', 'bodyweight');
create type public.exercise_category as enum ('chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'full_body');
create type public.equipment_type as enum (
  'barbell', 'dumbbell', 'smith_machine', 'cable', 'plate_loaded',
  'selectorized', 'bodyweight', 'assisted_bodyweight', 'other'
);
create type public.group_role as enum ('owner', 'admin', 'member');
create type public.friendship_status as enum ('pending', 'accepted');
create type public.verification_status as enum (
  'unverified', 'proof_uploaded', 'under_review', 'verified', 'disputed', 'rejected'
);
create type public.moderation_status as enum ('pending', 'approved', 'rejected');

-- Calendar months for "This Month" boards are evaluated in this time zone.
-- To change it, add a migration that replaces this function.
create function public.app_timezone()
returns text
language sql
immutable
as $$ select 'America/Los_Angeles'::text $$;

create function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
as $$
  select lower(p_username) = any (array[
    'admin', 'administrator', 'liftrank', 'settings', 'support', 'help', 'api', 'auth',
    'login', 'logout', 'signin', 'signup', 'onboarding', 'home', 'profile', 'groups', 'group',
    'friends', 'notifications', 'leaderboard', 'leaderboards', 'lift', 'lifts', 'invite',
    'me', 'root', 'system', 'moderator', 'mod', 'staff', 'official', 'null', 'undefined',
    'about', 'terms', 'privacy', 'security', 'deleted_user', 'anonymous'
  ])
$$;

-- Single source of truth for lift scoring (mirrored and parity-tested in src/lib/scoring.ts).
-- Epley as w × (30 + reps) / 30, rounded to 6 decimals so equal lifts compare equal.
create function public.compute_score(p_method public.ranking_method, p_weight_kg numeric, p_reps integer)
returns table (score numeric, is_ranked boolean)
language sql
immutable
as $$
  select
    case p_method
      when 'e1rm' then round(case when p_reps = 1 then p_weight_kg else p_weight_kg * (30 + p_reps) / 30.0 end, 6)
      when 'added_load_e1rm' then round(case when p_reps = 1 then p_weight_kg else p_weight_kg * (30 + p_reps) / 30.0 end, 6)
      when 'max_reps' then p_reps::numeric
      else null
    end,
    case p_method
      when 'e1rm' then coalesce(p_weight_kg, 0) > 0 and p_reps between 1 and 12
      when 'added_load_e1rm' then coalesce(p_weight_kg, 0) > 0 and p_reps between 1 and 12
      when 'max_reps' then p_reps >= 1
      else false
    end
$$;
