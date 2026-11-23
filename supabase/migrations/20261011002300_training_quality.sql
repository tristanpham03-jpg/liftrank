-- 0023: training quality fixes.
--
-- 1. Split imports are idempotent. Choosing a template used to always insert a new split, and a
--    double tap, a retry, or leaving mid-import could create a second copy (with its days). Each
--    import now carries a client-generated request id: the same id returns the split it already
--    created. import_training_split gains p_request_id (default null, so older clients still work).
-- 2. delete_training_session: delete a completed workout you own. Its sets go; your routine, other
--    workouts and competitive submissions (lifts keep their numbers; their training_set_id link is
--    cleared by the existing FK) stay. Linked recordings need an explicit choice: 'keep' moves them
--    to the exercise in general, 'delete' removes them (their files are queued for R2 deletion and
--    returned so the server removes them at once). Later workouts' stored PR summaries for the
--    affected exercises are recomputed the way finish_training_session decided them.

alter table public.training_splits add column import_key uuid;
create unique index training_splits_import_key on public.training_splits (user_id, import_key) where import_key is not null;

drop function public.import_training_split(text, text, text, jsonb);
create function public.import_training_split(p_name text, p_template text, p_rotation text, p_days jsonb, p_request_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_split uuid;
  v_day uuid;
  v_item jsonb;
  v_pos integer := 0;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then raise exception 'onboarding_required'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  if p_template not in ('ul', 'ppl', 'ap', 'arnold', 'full_body', 'fbeod', 'custom') then raise exception 'invalid_template'; end if;
  if p_rotation not in ('1x', '2x', '3x', 'infinite') then raise exception 'invalid_rotation'; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) not between 1 and 7 then raise exception 'invalid_routine'; end if;

  perform pg_advisory_xact_lock(hashtext('training:' || v_uid));
  -- The same request again (double tap, retry, a second tab): the split it created, made active again.
  if p_request_id is not null then
    select id into v_split from public.training_splits where user_id = v_uid and import_key = p_request_id;
    if found then
      update public.training_splits set is_active = false where user_id = v_uid and is_active and id <> v_split;
      update public.training_splits set is_active = true where id = v_split and not is_active;
      return v_split;
    end if;
  end if;
  if (select count(*) from public.training_splits where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_splits';
  end if;

  update public.training_splits set is_active = false where user_id = v_uid and is_active;
  insert into public.training_splits (user_id, name, template, rotation, import_key) values (v_uid, v_name, p_template, p_rotation, p_request_id)
  returning id into v_split;
  for v_item in select * from jsonb_array_elements(p_days) loop
    if char_length(btrim(coalesce(v_item ->> 'name', ''))) not between 1 and 30 then raise exception 'invalid_name'; end if;
    insert into public.training_days (user_id, split_id, name, position)
    values (v_uid, v_split, btrim(v_item ->> 'name'), v_pos) returning id into v_day;
    perform public._write_day_exercises(v_uid, v_day, coalesce(v_item -> 'exercises', '[]'::jsonb));
    v_pos := v_pos + 1;
  end loop;
  return v_split;
end;
$$;

-- PR summaries of completed sessions after p_after, for these exercises, decided as finish_training_session
-- does: a session's best both-sides ranked set is a PR if there was a prior ranked both-sides set (or a lift)
-- and it beats every ranked set and lift that existed when that session ended.
create function public._recompute_session_prs(p_uid uuid, p_exercises uuid[], p_after timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_rec record;
  v_prs jsonb;
  v_best numeric;
  v_prior boolean;
  v_n integer := 0;
begin
  for v_s in
    select s.id, s.local_date, s.ended_at, s.result from public.training_sessions s
    where s.user_id = p_uid and s.status = 'completed' and s.ended_at > p_after
      and exists (select 1 from public.training_sets t where t.session_id = s.id and t.exercise_id = any (p_exercises))
    order by s.ended_at
  loop
    v_prs := '[]'::jsonb;
    for v_rec in
      select distinct on (t.exercise_id) t.id, t.exercise_id, t.score
      from public.training_sets t
      where t.session_id = v_s.id and t.side is null and t.is_ranked
      order by t.exercise_id, t.score desc, t.set_number
    loop
      select max(x) into v_best from (
        select score x from public.training_sets
        where user_id = p_uid and exercise_id = v_rec.exercise_id and is_ranked and session_id is distinct from v_s.id and performed_at < v_s.ended_at
        union all
        select score from public.lifts
        where user_id = p_uid and exercise_id = v_rec.exercise_id and is_ranked and deleted_at is null and invalidated_at is null and created_at < v_s.ended_at
      ) b;
      v_prior := exists (select 1 from public.training_sets where user_id = p_uid and exercise_id = v_rec.exercise_id and is_ranked and side is null
                           and local_date < v_s.local_date and session_id is distinct from v_s.id)
              or exists (select 1 from public.lifts where user_id = p_uid and exercise_id = v_rec.exercise_id and is_ranked
                           and deleted_at is null and invalidated_at is null and created_at < v_s.ended_at);
      if v_prior and v_best is not null and v_rec.score > v_best then
        v_prs := v_prs || jsonb_build_object('set_id', v_rec.id, 'exercise_id', v_rec.exercise_id);
      end if;
    end loop;
    if v_s.result is not null and coalesce(v_s.result -> 'prs', '[]'::jsonb) <> v_prs then
      update public.training_sessions set result = result || jsonb_build_object('prs', v_prs) where id = v_s.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

create function public.delete_training_session(p_session_id uuid, p_recordings text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.training_sessions%rowtype;
  v_exercises uuid[];
  v_recs uuid[];
  v_keys text[] := '{}';
  v_sets integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_recordings is not null and p_recordings not in ('keep', 'delete') then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtext('training:' || v_uid));
  select * into v_s from public.training_sessions where id = p_session_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.status <> 'completed' then raise exception 'session_not_completed'; end if;

  select coalesce(array_agg(distinct exercise_id), '{}') into v_exercises from public.training_sets where session_id = v_s.id and user_id = v_uid;
  select coalesce(array_agg(r.id), '{}') into v_recs from public.personal_recordings r
  where r.user_id = v_uid and (r.session_id = v_s.id or r.training_set_id in (select id from public.training_sets where session_id = v_s.id));

  -- Never decide about videos silently.
  if cardinality(v_recs) > 0 and p_recordings is null then raise exception 'recordings_choice_required'; end if;
  if cardinality(v_recs) > 0 and p_recordings = 'delete' then
    with gone as (delete from public.personal_recordings where id = any (v_recs) returning object_key)
    select coalesce(array_agg(object_key), '{}') into v_keys from gone;
  elsif cardinality(v_recs) > 0 then
    update public.personal_recordings set training_set_id = null, session_id = null, draft_ref = null where id = any (v_recs);
  end if;

  delete from public.training_sets where session_id = v_s.id and user_id = v_uid;
  get diagnostics v_sets = row_count;
  delete from public.training_sessions where id = v_s.id;
  perform public._recompute_session_prs(v_uid, v_exercises, coalesce(v_s.ended_at, v_s.started_at));
  return jsonb_build_object('sets', v_sets, 'recordings', cardinality(v_recs), 'recordings_deleted', cardinality(v_keys), 'keys', to_jsonb(v_keys));
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
  public.my_recording_keys()
to authenticated;

-- The cleanup job runs with the secret key.
grant execute on function public.proof_orphans(), public.close_monthly_records(), public.avatar_orphans() to service_role;
-- 0020: finalizing an upload (after the server checked the stored file) and the R2 cleanup job.
grant execute on function public.finalize_recording(uuid, uuid, bigint, numeric, integer, integer), public.recording_maintenance(),
  public.recording_objects_removed(text[]) to service_role;

grant execute on function public.get_invite_preview(text), public.get_friend_invite_preview(text) to anon;
