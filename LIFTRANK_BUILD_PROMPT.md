# LiftRank — Build Brief for Claude Code

You are building LiftRank, a mobile-first web app where gymgoers log their best lifts in seconds and see how they rank against friends, groups, their gym, and nearby lifters. Tagline: **Every Lift Is a Leaderboard.**

Think Strava/Hevy polish with Clash Royale-style competition, but far simpler than a workout tracker. No workout sessions, routines, splits, nutrition, rest timers, AI coaching, or heavy analytics.

Core loop: **open app → pick exercise → enter weight and reps → submit → see ranking.**

---

## 0. How to work this session

1. **Scope for this session is Phases 1–3 only** (§7). Phases 4–7 (§9) are listed so the schema can accommodate them. Do not build them yet. When Phases 1–3 meet their acceptance criteria, stop and write the final report (§8).
2. Before coding: inspect the repo (it may be empty), then write `PLAN.md` with the build order and any decision you make that this brief doesn't cover.
3. Keep `PROGRESS.md` updated as you go: completed, in progress, remaining, known issues, required config. Future sessions resume from it.
4. **No Supabase cloud project exists yet.** Develop against local Supabase with the Supabase CLI (`supabase init`, `supabase start`, which needs Docker). If Docker isn't available, still write migrations, RPCs, and tests, and state clearly in the report that DB tests were not run. Never invent credentials.
5. Library APIs change. Check current docs for Next.js App Router, `@supabase/ssr`, and shadcn/ui instead of relying on memory.
6. A feature is done only when it's implemented, typechecked, linted, and tested. Never claim something works that you haven't run.
7. **Never fabricate data that looks real**: no fake users, lifts, gyms, machine models, testimonials, user counts, or population statistics. Allowed: the exercise catalog, machine manufacturer names, and a clearly labeled local-only dev seed (`supabase/seed.sql`) with obviously fake users, never loaded in production. Marketing-page examples must be labeled "Example".

---

## 1. Stack

- Next.js (App Router), React, TypeScript (strict), Tailwind, shadcn/ui, Lucide, Motion for React, React Hook Form, Zod
- Supabase: Postgres, Auth, Storage, RLS. Server actions / route handlers for mutations.
- Vercel hosting. Free tiers only; no paid APIs; no AI APIs.
- Service-role key is server-only (used for account deletion and nothing client-reachable).
- **Analytics:** write product events to an `analytics_events` table from the server. Vercel Analytics only for page views (custom events have required a paid plan; verify before relying on it).
- **Email:** local dev uses the CLI's built-in mail catcher. Supabase's default hosted email is heavily rate-limited, so document setting up custom SMTP (e.g. Resend free tier) before launch.

---

## 2. Design

Dark mode default, premium athletic look, mobile-first.

| Token | Value |
|---|---|
| Background | #090B0F |
| Surface | #131720 |
| Elevated | #1B202B |
| Border | #2A303D |
| Text primary / secondary / muted | #F5F7FA / #9CA5B5 / #687386 |
| Accent | #B7FF36 |
| Success / Warning / Danger | #45D483 / #FFBD59 / #FF626D |

Geist or Inter. Bold, tabular numerals for weights, ranks, PRs, titles. No heavy gradients, glassmorphism, giant empty cards, or generic dashboard look. Short animations only (rank changes, PR celebration, tab transitions, button feedback); respect `prefers-reduced-motion`. Respect iPhone safe areas.

**Navigation:** mobile bottom bar with Home, Leaderboards, Add Lift (visually prominent), Profile. Groups live under Leaderboards, notifications under Home (bell with unread count), settings under Profile. Desktop gets a sidebar.

---

## 3. Resolved rules

These close gaps in the original spec. Follow them exactly; if one turns out to be unworkable, note it in `PLAN.md` and pick the closest alternative.

### 3.1 Exercise catalog

- Each exercise has: id, name, slug, category, muscle_group, equipment_type, `ranking_method`, `weight_convention`, `supports_machine_selection`, `max_weight_kg` (hard cap), `flag_threshold_kg` (soft review flag), aliases, is_active.
- Categories: Chest, Back, Shoulders, Arms, Legs, Core, Full Body. Equipment types: Barbell, Dumbbell, Smith Machine, Cable, Plate-Loaded Machine, Selectorized Machine, Bodyweight, Assisted Bodyweight, Other.
- Each exercise appears **once**. Pull-Up, Chin-Up, Dip, Push-Up are category Back/Chest with equipment Bodyweight (the original list duplicated Pull-Up and Chin-Up).
- Add separate entries: **Weighted Pull-Up, Weighted Chin-Up, Weighted Dip**.
- Initial list:
  - Chest: Barbell Bench Press, Incline Barbell Bench Press, Dumbbell Bench Press, Incline Dumbbell Bench Press, Smith Machine Bench Press, Incline Smith Press, Machine Chest Press, Incline Machine Chest Press, Pec Deck, Cable Fly, Dip, Weighted Dip, Push-Up
  - Back: Deadlift, Romanian Deadlift, Barbell Row, Chest-Supported Row, Seated Cable Row, T-Bar Row, Lat Pulldown, Machine Row, Pull-Up, Chin-Up, Weighted Pull-Up, Weighted Chin-Up
  - Shoulders: Barbell Overhead Press, Dumbbell Shoulder Press, Machine Shoulder Press, Lateral Raise, Cable Lateral Raise, Rear Delt Fly
  - Arms: Barbell Curl, EZ-Bar Curl, Preacher Curl, Dumbbell Curl, Hammer Curl, Cable Curl, Triceps Pushdown, Overhead Triceps Extension, Skull Crusher
  - Legs: Barbell Back Squat, Front Squat, Smith Squat, Leg Press, Hack Squat, Leg Extension, Seated Leg Curl, Lying Leg Curl, Bulgarian Split Squat, Calf Raise
- Search: case-insensitive, partial, aliases and abbreviations (`"incl smith"` → Incline Smith Press, `"lat pull"` → Lat Pulldown, `"rdl"` → Romanian Deadlift, `"ohp"` → Barbell Overhead Press). Use Postgres `pg_trgm` plus an alias table. Before typing, show the user's recent and favorite exercises, then popular ones.

### 3.2 Scoring

Each lift gets a single numeric `score` computed **server-side** from the exercise's `ranking_method`, plus `is_ranked`:

| ranking_method | Used for | score | Ranked when |
|---|---|---|---|
| `e1rm` | weighted exercises | Epley: `w × (1 + reps/30)`; reps = 1 → `w` | reps 1–12 |
| `max_reps` | unweighted bodyweight | reps | reps ≥ 1 |
| `added_load_e1rm` | Weighted Pull-Up/Chin-Up/Dip | Epley on added weight only | reps 1–12, added > 0 |
| `none` | assisted variants (later) | null | never (history only) |

- Store unrounded scores; round only for display. Example: 185 × 8 → 234.3, shown as "≈ 234 lb".
- **Order:** score desc → weight desc → performed_at asc → created_at asc → id asc. Because the order is total, ranks are unique (use `row_number()`).
- Each user appears once per board: their best eligible lift in that scope (`DISTINCT ON (user_id)` in the same order).

### 3.3 Weights and units

- Store `entered_weight` (numeric), `entered_unit` (`lb`|`kg`), and `weight_kg` (numeric, 0.45359237 kg/lb). Score is computed from `weight_kg`.
- Display in the viewer's preferred unit. If it matches the entered unit, show the entered value exactly (no 165 → 164.99 drift). Otherwise round to 0.5 lb or 0.25 kg.
- **One fixed weight convention per exercise**, shown as a hint under the weight field: barbell = total incl. bar; dumbbell = per dumbbell; selectorized/cable = stack number; plate-loaded = total plates on both sides, excluding sled/carriage; weighted bodyweight = added weight. No per-lift convention choice, so lifts on one exercise are always comparable in convention. Store the convention on the lift as well for history.

### 3.4 Validation (client and server, same Zod schema)

- Weight > 0, ≤ exercise `max_weight_kg` (set realistic caps that still allow elite lifts, e.g. barbell lifts 600 kg, leg press 1500 kg, dumbbells 120 kg each).
- Reps: integer 1–50 for weighted, 1–200 for `max_reps`. Lifts over 12 reps are saved but unranked for `e1rm`; tell the user so before they submit.
- `performed_at`: not in the future; defaults to now; may be backdated.
- Above `flag_threshold_kg`: save and rank normally, set an internal `flagged_for_review` flag. Never show users that a lift was flagged. Never imply cheating.
- **Duplicates:** the client sends an idempotency key per submit. Additionally, the same user + exercise + weight + reps within 10 minutes returns the existing lift instead of inserting.

### 3.5 Lift visibility

Options: **Private**, **Selected groups**, **Friends**, **Public** (signed-in users only). Default for new users: **Public**, changeable in settings and per lift. Public lifts still never appear on gym or nearby boards unless the user turns on `public_leaderboard_opt_in`.

| Visibility | Who can see it | Appears on |
|---|---|---|
| Private | owner | owner's history and PRs only |
| Selected groups | owner + members of groups in `lift_group_shares` | those groups' boards |
| Friends | owner + accepted friends | Friends board |
| Public | any signed-in user | Friends board, all of owner's group boards, profile; gym/nearby only with opt-in |

- Group boards must be identical for every member, so they include only Public lifts of members and lifts explicitly shared with that group. Friends-only lifts never appear on group boards.
- Enforce visibility in **RLS on `lifts`**, using `stable` helper functions (`is_friend`, `is_group_member`, `lift_shared_with_member`). Leaderboard and feed functions are `SECURITY INVOKER` so RLS applies. Anything else that reads lifts must go through the same policy.
- Activities, notifications, profile stats, rival cards, share links, and aggregate counts must **reference the lift and re-check visibility at read time**. Never copy weights into an activity row. Changing a lift to Private must remove it from every surface immediately.
- Blocks: blocked pairs can't see each other's lifts, profiles, activity, or search results; can't friend, invite, or challenge each other. On group boards, a blocked user's row is hidden from the blocker without renumbering ranks.

### 3.6 Lift edits and deletes

- Users can edit notes, visibility, and group shares anytime.
- Weight, reps, exercise, and date are **not editable**; the user deletes and re-logs. This keeps verification and record history honest.
- Delete is a soft delete (`deleted_at`). Deleted lifts drop off every board; `record_history` rows remain.

### 3.7 Time periods

- All Time and This Month. Months are calendar months in a configurable `APP_TIMEZONE` (default `America/Los_Angeles`).
- Monthly boards use `performed_at`, but exclude lifts submitted more than 3 days after `performed_at`, so a past month can't be rewritten later. Those lifts still count all-time.

### 3.8 PRs

- A PR means the new lift's score beats the user's previous best score on that exercise (across all their own lifts regardless of visibility; ranked lifts only).
- The first lift on an exercise is "First lift logged", not a PR. Equal score is not a PR.

### 3.9 Rivals

- Rival = the person directly above the user on a board.
- Gap text: same reps → "5 lb away at 5 reps"; different reps → "5 lb away on estimated 1RM"; `max_reps` → "2 reps away".
- Home shows at most 2 rivals, chosen from Friends and Group boards for exercises the user logged in the last 60 days, smallest relative gap first.

### 3.10 "You passed someone" notifications

- After a lift is saved: for each user who can see the lift (friend or member of a group where the lift appears) whose best score on that exercise the submitter just moved above, create one "passed" notification. Score comparison, not per-board rank, so a single event yields a single notification.
- Rate limit: at most one passed notification per (recipient, actor, exercise) per 24 hours.
- Never notify about a lift the recipient can't see.

### 3.11 Champions and record history

- Champions exist only for **group boards** (Phase 3) and later gym boards. Friends boards differ per viewer, so they have no champion.
- A board needs at least **3 ranked lifters** to have a champion, and for "Top Three"/"Group Champion" style achievements to count.
- When the champion changes, insert into `record_history` (board key, user, lift, since, until). Compute on lift insert/delete inside the submit/delete RPC.

### 3.12 Percentiles (used from Phase 4)

- Show "Top X%" only when participants ≥ 20. X = `ceil(100 × rank / participants)`, minimum 1. Always show the participant count and scope, e.g. "Top 9% of 143 ranked Bench Press lifters within 10 mi of your gym."
- Below 20 participants, show "#3 of 12 lifters".

### 3.13 Submitting a lift (one RPC)

Implement lift submission as a single Postgres function `submit_lift(...)` called from a server action:

1. Read the user from `auth.uid()` (never accept a user id from the client).
2. Validate, compute score/is_ranked, dedupe.
3. Capture the user's previous best and their rank on the relevant boards.
4. Insert lift and group shares.
5. Compute new ranks, PR status, passed users, champion changes.
6. Write activities, notifications, record_history.
7. Return everything the result screen needs: PR yes/no, est. 1RM, rank before/after per board, who was passed.

It runs `SECURITY DEFINER` only because it writes notifications for other users, so it must set `search_path`, use `auth.uid()`, and do every visibility check itself. No other path may insert notifications.

### 3.14 Groups

- Private groups only in the MVP (no public discovery). Max 200 members.
- Roles: owner (one), admin, member. Owners/admins: edit details, remove members, manage invites. Owner can't leave without transferring ownership or deleting the group.
- Invites: 32-byte random token, store only its SHA-256 hash, expires after 7 days by default, optional max uses, revocable. `/invite/[token]`: if signed out, keep the token in an httpOnly cookie through signup and onboarding, then auto-join.
- Group boards exist automatically for any exercise with at least one eligible lift. No manual setup.

### 3.15 Friends

- Search by username, send/accept/decline/cancel, remove, block.
- One row per unordered pair (unique index on `least(a,b), greatest(a,b)`).
- Being friends doesn't expose Private or Selected-groups lifts.

### 3.16 Usernames and accounts

- Username: 3–20 chars, `a–z 0–9 _`, unique case-insensitively, reserved words blocked (admin, liftrank, settings, etc.).
- Profile visibility (public / friends / private) controls bio, gym, and featured lifts on the profile page.
- Account deletion: server route using the service-role key. Cascades personal data; `record_history` keeps rows with the user set to null and shown as "Deleted user".

---

## 4. Schema

UUID primary keys, versioned migrations in `supabase/migrations`, foreign keys, unique constraints, and indexes. RLS enabled on every table.

Tables:

`profiles`, `user_settings`, `exercises`, `exercise_aliases`, `favorite_exercises`, `lifts`, `lift_group_shares`, `groups`, `group_members`, `group_invites`, `friendships`, `blocks`, `activities`, `activity_reactions`, `notifications`, `achievements`, `user_achievements`, `record_history`, `analytics_events`

Create now with no UI (Phases 4–5): `machine_manufacturers`, `machine_models`, `gyms`, `gym_memberships`, `gym_equipment`, `lift_challenges`, `verification_reviews`, `reports`

Key `lifts` columns: id, user_id, exercise_id, entered_weight, entered_unit, weight_kg, added_weight_kg, reps, weight_convention, score, is_ranked, performed_at, created_at, visibility, verification_status (default `unverified`), flagged_for_review, notes, gym_id, machine_model_id, gym_equipment_id, video_path, idempotency_key, deleted_at.

Key indexes: `lifts(exercise_id, is_ranked, score desc)` filtered on `deleted_at is null`; `lifts(user_id, exercise_id, score desc)`; `lifts(exercise_id, performed_at)`; group member and friendship lookup indexes; trigram index on exercise names and aliases.

Remembered Add Lift defaults (last exercise, weight, reps, unit) come from the user's latest lift and `user_settings`. No extra table needed.

---

## 5. Screens

**Landing (`/`):** hero "EVERY LIFT IS A LEADERBOARD." / "Compete with friends. Claim gym records. See how strong you really are." CTAs: Start Competing, See How It Works. Four steps: Submit your PR → See your ranking → Challenge your friends → Claim your spot. App previews labeled as examples.

**Auth:** email signup/login, password reset, logout, protected routes, account deletion. Google OAuth wired up but disabled until configured.

**Onboarding (under one minute, every step after username skippable):** username → gym (shows "coming soon" placeholder until Phase 4, skippable) → first lift → invite friends. Never ask birthday, height, bodyweight, gender, goals, or history.

**Add Lift (the most important screen, about five seconds):** exercise (prefilled with last used), weight + unit toggle, reps, big Submit. Collapsed "More": date, visibility, groups to share with, note. Machine and video fields arrive in Phases 4–5.

**Result:** if PR, celebrate ("NEW PERSONAL RECORD", lift, est. 1RM, rank change "#4 → #2", "You passed Ryan"). If not a PR, show the saved lift and current rank without celebrating. Actions: View Leaderboard, Log Another.

**Home:** your rankings (top 3–5 boards where you rank best), next rival (max 2), recent activity, Add Lift. Bell with unread count.

**Leaderboards:** exercise picker, scope tabs Friends / Groups (with group selector) / Gym / Nearby (last two show a "coming soon" empty state until Phase 4), time filter. Sticky "your rank" card with your best, est. 1RM, next rival. Rows: rank, avatar, username, weight × reps, est. 1RM where relevant, verification badge. Current user highlighted. Paginated. Tap row → profile.

**Groups:** list, create (name, description, avatar), detail with exercise boards, champion per board, members, activity, invite link with native share and copy.

**Friends:** search, requests, list, block.

**Profile:** avatar, username, display name, bio, PRs (featured lifts choosable), ranking highlights, titles, recent visible activity. Settings: units, default visibility, notification toggles, account deletion.

**Notifications:** list, mark read / mark all read, per-type toggles in settings. Phase 3 types: friend request, group invite accepted, passed, took first place, new group member.

**Activity feed:** friend PRs, group first places, passes, members joining. Simple reactions. No video feed.

**Empty states** each with a next action: "Your first lift puts you on the board." / "Invite your friends and see who's strongest." / "Create a group to start competing." / "Be one of the first lifters ranked in your area."

**PWA (basic in Phase 3):** manifest, icons, standalone, theme color. Offline: show a banner and disable Submit. Never pretend a lift was saved offline. Don't cache private data.

---

## 6. Testing

- **Vitest:** scoring per method, Epley edge cases (1 rep, 12 vs 13 reps), unit conversion and display rounding, ordering and tie-breakers, PR detection, gap text, validation schema, username rules.
- **Database tests (`supabase test db` with pgTAP):** RLS for every visibility level, block behavior, group board composition, a non-member can't join without a valid invite, users can't insert notifications or achievements directly, `submit_lift` returns correct ranks/PR/passes, monthly cutoff rule, dedupe.
- **Playwright against local Supabase:**
  - Flow A: signup → onboarding → submit lift → see ranking
  - Flow B: create group → invite link → second user signs up via link → both submit → board order and passed notification correct
  - Flow D: private lift → other user tries profile, board, feed, and direct lift URL → nothing leaks

---

## 7. Phases for this session

**Phase 1 — Foundation:** project setup, design system, Supabase local setup, full schema + RLS, auth, profiles, onboarding, navigation, landing page.

**Phase 2 — Core lifting:** catalog + search, Add Lift, `submit_lift`, history, PRs, result screen, Friends and Group leaderboard functions.

**Phase 3 — Social:** friends, blocks, groups, invites, group boards and champions, rivals, activity feed, notifications, basic PWA.

**Acceptance criteria (all must pass before reporting done):**

- `tsc --noEmit`, lint, and `next build` succeed with no errors
- All Vitest, pgTAP, and Playwright suites in §6 pass (or are reported as not run with the reason)
- A new user can sign up and see their first ranking in under a minute
- A returning user can log a lift in five taps or fewer
- Leaderboards come from SQL with one row per user; the browser never downloads all lifts
- No secrets in the client bundle; `.env.example` lists every variable
- No fabricated users, lifts, or stats outside `seed.sql`

---

## 8. Final report

Write to `PROGRESS.md` and summarize in chat: what was built, what's incomplete, how to run it, environment variables, Supabase setup (local and how to create the cloud project and push migrations), test results with counts, known limitations, next steps. Also create `README.md` (install, env, Supabase, migrations, storage, local dev, tests, Vercel deploy) and `ROADMAP.md` (done / not done / future).

Do not mark the project complete if anything in §7 is missing.

---

## 9. Later phases (do not build now; design the schema for them)

**Phase 4 — Gyms and machines**
- Gyms: no fabricated gyms. Users submit a gym (name, address, city, region, country); it's usable by the submitter immediately but stays out of search and boards until a moderator approves it. Coordinates are entered at approval or geocoded with a free service that allows it under its usage policy.
- Gym selection is self-reported; never claim a lift happened at a gym.
- Machines: seed manufacturer names only (Hammer Strength, Life Fitness, Matrix, Technogym, Cybex, Precor, Panatta, Atlantis, Rogue, Other). Models are user-submitted and moderated, never invented. Unknown manufacturer/model and skipping are always allowed; remember the last machine per exercise.
- Machine exercises: the default board combines all submissions and shows the manufacturer on each row with a note that machines differ; an exact-model filter separates them. Champions on machine exercises exist only for exact model or specific gym equipment. No conversion factors between machines.
- Gym boards and nearby boards (my gym, 5, 10, 25 mi) by primary gym coordinates, opt-in only, never exposing user location. Percentile rules in §3.12.

**Phase 5 — Verification**
- Private storage bucket, signed URLs, authorized playback only, upload progress and retry.
- Check current Supabase free-tier limits first; per-file upload caps and total storage have been small (around 50 MB per file, 1 GB total). Default to 50 MB and 60 seconds; duration is enforced client-side only unless processing is added later. Delete videos for rejected or deleted lifts; clean up abandoned uploads with a scheduled job.
- States: unverified, proof uploaded, under review, verified, disputed, rejected. Uploading proof isn't verification.
- Only app moderators (`profiles.is_moderator`, set manually in SQL) can verify. Group admins cannot, since they could verify their own friends. Nobody can verify their own lifts.
- Challenges: one active per lift, rate-limited per challenger, blocked users can't challenge, declining doesn't imply dishonesty, and transitions happen only through server functions.
- Verified-only board filter; report button; moderation queue.

**Phase 6 — Gamification:** achievements (First Lift, First PR, Top Three, Group Champion, Gym Champion, Rival Overtaken, Verified Lifter, Five Records), awarded once each, server-side only, with the 3-lifter minimum. Shareable PR/profile/group cards via OG image generation, never exposing lifts the viewer couldn't see.

**Phase 7 — Polish:** accessibility pass, error handling, performance, PWA refinements, deploy prep.

**Future (not planned):** native app, push, machine QR codes, gym-vs-gym, university leagues, subscriptions, gym-owner dashboards, automated video analysis.
