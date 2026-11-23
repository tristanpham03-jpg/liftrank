-- 0021: reserve "sblift" as a username (the app's name since the rebrand; "liftrank" was already reserved).
-- Same function, same signature and properties, one name added. `create or replace` keeps its grants.
-- Enforced everywhere the function is: the profiles.username check constraint, complete_username and
-- update_my_profile. Existing rows aren't re-checked; no profile holds this name (asserted below).
do $$
begin
  if exists (select 1 from public.profiles where lower(username) = 'sblift') then
    raise exception 'a profile already uses the username sblift; resolve that before reserving it';
  end if;
end $$;

create or replace function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
as $$
  select lower(p_username) = any (array[
    'admin', 'administrator', 'liftrank', 'sblift', 'settings', 'support', 'help', 'api', 'auth',
    'login', 'logout', 'signin', 'signup', 'onboarding', 'home', 'profile', 'groups', 'group',
    'friends', 'notifications', 'leaderboard', 'leaderboards', 'lift', 'lifts', 'invite',
    'me', 'root', 'system', 'moderator', 'mod', 'staff', 'official', 'null', 'undefined',
    'about', 'terms', 'privacy', 'security', 'deleted_user', 'anonymous'
  ])
$$;
