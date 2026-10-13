-- LiftRank 0011 — Phase 7: profile pictures, reports and moderation, rate limits.
--
-- Additive. No existing rows change.
--
-- Profile pictures live in a public-read bucket: they appear on every board
-- row, so signing a URL per row would cost far more than it protects. Writes
-- are locked to your own folder, images only, 512 KB max (the app uploads a
-- ~256 px WebP of ~20 KB), and at most 3 files at once. set_avatar checks the
-- file and limits changes per day.

-- ───────────── Profile pictures ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create table public.avatar_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index avatar_changes_user_idx on public.avatar_changes (user_id, created_at desc);
alter table public.avatar_changes enable row level security;
revoke all on public.avatar_changes from anon, authenticated;
grant all on public.avatar_changes to service_role;

-- <your id>/<random>.webp|jpg|png, and fewer than 3 files already in your folder.
create function public._avatar_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_name ~ ('^' || auth.uid()::text || '/[a-z0-9-]{8,64}\.(webp|jpg|png)$')
    and (select count(*) from storage.objects o
         where o.bucket_id = 'avatars' and split_part(o.name, '/', 1) = auth.uid()::text) < 3
$$;

-- Your own files (to replace your picture), or any file for moderators (to remove a reported one).
create function public._avatar_can_manage(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (split_part(p_name, '/', 1) = auth.uid()::text or public._is_moderator(auth.uid()))
$$;

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public._avatar_can_upload(name));
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public._avatar_can_manage(name));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public._avatar_can_manage(name));
-- No update policy: files are never overwritten.

-- Sets (or, with null, clears) your picture. Returns the previous file so the
-- app can remove it.
create function public.set_avatar(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select avatar_path into v_old from public.profiles where id = v_uid;
  if p_path is not null then
    if split_part(p_path, '/', 1) <> v_uid::text
       or not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then
      raise exception 'invalid_avatar';
    end if;
    if (select count(*) from public.avatar_changes where user_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
      raise exception 'too_many_avatar_changes';
    end if;
    insert into public.avatar_changes (user_id) values (v_uid);
  end if;
  update public.profiles set avatar_path = p_path, updated_at = now() where id = v_uid;
  return jsonb_build_object('remove_paths',
    case when v_old is not null and v_old is distinct from p_path then jsonb_build_array(v_old) else '[]'::jsonb end);
end;
$$;

-- Account deletion: your own picture files, so the app can remove them.
create function public.my_avatar_paths()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.name), '{}')
  from storage.objects o
  where o.bucket_id = 'avatars' and auth.uid() is not null and split_part(o.name, '/', 1) = auth.uid()::text
$$;

-- For the daily cleanup (service role): picture files older than an hour that
-- no profile uses.
create function public.avatar_orphans()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.name), '{}')
  from storage.objects o
  where o.bucket_id = 'avatars' and o.created_at < now() - interval '1 hour'
    and not exists (select 1 from public.profiles p where p.avatar_path = o.name)
$$;

-- ───────────── Reports ─────────────
alter table public.reports
  add column category text not null default 'other'
    check (category in ('spam', 'harassment', 'inappropriate', 'other')),
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add column action text check (action is null or action in (
    'dismiss', 'remove_avatar', 'clear_profile_text', 'clear_lift_note', 'clear_group_text'));
create unique index reports_one_open_uidx on public.reports (reporter_id, target_type, target_id) where status = 'open';
create index reports_open_idx on public.reports (created_at) where status = 'open';
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
-- Reports go through submit_report only (it checks the target and the limits).
revoke insert on public.reports from authenticated;
drop policy reports_own_insert on public.reports;

-- Report a profile, a lift, or a group you can see. One open report per
-- target per person; 10 a day.
create function public.submit_report(p_target_type text, p_target_id uuid, p_category text, p_details text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_ok boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_category is null or p_category not in ('spam', 'harassment', 'inappropriate', 'other') then
    raise exception 'invalid_report';
  end if;
  if char_length(coalesce(v_details, '')) > 500 then raise exception 'reason_too_long'; end if;
  v_ok := case p_target_type
    when 'profile' then p_target_id <> v_uid and exists (select 1 from public.profiles where id = p_target_id)
    when 'lift' then exists (
      select 1 from public.lifts l
      where l.id = p_target_id and l.user_id <> v_uid and l.deleted_at is null
        and public._can_view_lift(v_uid, l.id, l.user_id, l.visibility))
    when 'group' then public._member(p_target_id, v_uid)
    else false
  end;
  if not coalesce(v_ok, false) then raise exception 'not_found'; end if;
  if exists (select 1 from public.reports where reporter_id = v_uid and target_type = p_target_type
             and target_id = p_target_id and status = 'open') then
    raise exception 'already_reported';
  end if;
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'too_many_reports';
  end if;
  insert into public.reports (reporter_id, target_type, target_id, category, reason)
  values (v_uid, p_target_type, p_target_id, p_category, coalesce(v_details, p_category));
end;
$$;

-- Moderators: open reports, one entry per reported thing, with what was reported.
create function public.mod_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_moderator(auth.uid()) then raise exception 'forbidden'; end if;
  return (
    select coalesce(jsonb_agg(x order by x->>'first_at'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'target_type', r.target_type,
        'target_id', r.target_id,
        'count', count(*),
        'categories', jsonb_agg(distinct r.category),
        'details', (jsonb_agg(r.reason order by r.created_at desc) filter (where r.reason not in ('spam', 'harassment', 'inappropriate', 'other'))),
        'first_at', min(r.created_at),
        'target', case r.target_type
          when 'profile' then (
            select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'bio', p.bio, 'avatar_path', p.avatar_path)
            from public.profiles p where p.id = r.target_id)
          when 'lift' then (
            select jsonb_build_object('username', p.username, 'exercise', e.name, 'notes', l.notes, 'reps', l.reps,
                                      'entered_weight', l.entered_weight, 'entered_unit', l.entered_unit, 'lift_id', l.id)
            from public.lifts l join public.profiles p on p.id = l.user_id join public.exercises e on e.id = l.exercise_id
            where l.id = r.target_id)
          when 'group' then (
            select jsonb_build_object('name', g.name, 'description', g.description) from public.groups g where g.id = r.target_id)
        end
      ) as x
      from public.reports r
      where r.status = 'open'
      group by r.target_type, r.target_id
      order by min(r.created_at)
      limit 100
    ) q
  );
end;
$$;

-- Resolve every open report on one thing: dismiss, or remove the reported
-- content. Bans are done by an admin in the Supabase dashboard (Auth → Users).
create function public.mod_resolve_reports(p_target_type text, p_target_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_remove text;
begin
  if not public._is_moderator(v_uid) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.reports where target_type = p_target_type and target_id = p_target_id and status = 'open') then
    raise exception 'not_found';
  end if;
  if p_action = 'remove_avatar' and p_target_type = 'profile' then
    select avatar_path into v_remove from public.profiles where id = p_target_id;
    update public.profiles set avatar_path = null where id = p_target_id;
  elsif p_action = 'clear_profile_text' and p_target_type = 'profile' then
    update public.profiles set bio = null, display_name = username where id = p_target_id;
  elsif p_action = 'clear_lift_note' and p_target_type = 'lift' then
    update public.lifts set notes = null where id = p_target_id;
  elsif p_action = 'clear_group_text' and p_target_type = 'group' then
    update public.groups set description = null where id = p_target_id;
  elsif p_action <> 'dismiss' then
    raise exception 'invalid_report';
  end if;
  update public.reports
  set status = case when p_action = 'dismiss' then 'dismissed' else 'reviewed' end,
      action = p_action, reviewed_by = v_uid, reviewed_at = now()
  where target_type = p_target_type and target_id = p_target_id and status = 'open';
  return jsonb_build_object('remove_paths', case when v_remove is null then '[]'::jsonb else jsonb_build_array(v_remove) end);
end;
$$;

-- ───────────── Rate limit: lift submissions ─────────────
-- Generous for real use, a hard stop for scripts and accidental loops.
create function public._limit_lift_inserts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.lifts where user_id = new.user_id and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too_many_lifts';
  end if;
  return new;
end;
$$;
create trigger lifts_rate_limit before insert on public.lifts
  for each row execute function public._limit_lift_inserts();

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
  public.appeal_proof(uuid, text),
  public.get_record_history(text, uuid, uuid),
  public.get_champion_card(text),
  public.set_avatar(text),
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
