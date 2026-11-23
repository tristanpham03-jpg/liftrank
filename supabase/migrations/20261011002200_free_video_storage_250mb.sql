-- 0022: the Free plan's video storage allowance goes from 500 MB to 250 MB (owner decision, 2026-11-22).
-- Reuses the existing quota system: begin_recording already refuses any upload where
-- used + live reservations + the new file > the plan's quota_bytes, under the per-user account lock.
-- So: existing recordings are kept even if a user is now over 250 MB; they can't upload again until
-- their usage is below the limit by at least the new file's size. Pro (5 GB) is unchanged.
update public.storage_plans set quota_bytes = 262144000 where id = 'free';  -- 250 MB

do $$
begin
  if (select quota_bytes from public.storage_plans where id = 'free') <> 262144000
     or (select quota_bytes from public.storage_plans where id = 'pro') <> 5368709120 then
    raise exception 'storage plans not as expected after 0022';
  end if;
end $$;
