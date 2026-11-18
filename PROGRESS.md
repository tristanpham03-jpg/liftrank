# SBLift (formerly LiftRank): Progress

_Last updated: 2026-10-15 · Done: Phases 1–7 + friend verification · **Deployed (unlisted) at https://liftrank-roan.vercel.app** · Finishing launch setup (see "Deployment status")_

## 2026-11-17 SBLift rebrand and SBL training update (migration `…1900` applied with the owner's approval; not yet pushed)

- **Rebrand:**
  - "SBLift" in titles, metadata, the PWA manifest, the wordmark, auth, onboarding, invites, share cards and error copy. Tagline: "Built by lifters. Driven by science."
  - "LiftRank" stays as the name of the leaderboard system ("LiftRank boards").
  - Unchanged: DB names, env vars, routes, the Vercel project/domain, storage keys (`lr.*`), and the icon.
  - Landing gains a short, factual SBL community line.
- **Routine persistence bug:**
  - **Cause:** an exercise added mid-session was session-only by design, but the only way to keep it was a disabled-looking item in the ⋯ menu. The start draft was also built from whatever the page last rendered, so a stale page could start an old routine.
  - **Fix:** Start now builds the session on the server from the routine as saved at that moment. Adding an exercise says "added to this session only", and a visible banner offers "Save to routine" whenever the session differs.
  - **Tests:** `routine persistence and alternative slots` (unit), Flow N (e2e).
- **Alternative slots (needs `…1900`):**
  - Editor: ⋯ → "Add alternative" groups exercises ("Choose one at session time"); "Not an alternative" ungroups them.
  - Session: one block with compact option chips, defaulting to the option you did most recently (never anything outside the slot).
  - Switching with numbers entered asks: keep them and do both, or clear and switch. You can also do both from ⋯ → "Also do X".
  - Each option logs under its own exercise and history. Doing both isn't a routine change.
- **My Exercises** (`/training/exercises`, linked from Training and the session):
  - Lists everything you've logged plus favorites, with search, star, and a history chevron.
  - "+" adds the exercise to the active session (session only), or starts a quick "Workout" session (needs `…1900`). Routines are never changed.
- **History discoverability:** a chevron by exercise names (day preview, session blocks, My Exercises), plus "View history" in the session ⋯ menu. These are separate tap targets from inputs and menus.
- **Catalog (`…1900`): 68 → 87.**
  - Added: Reverse Cable Curl, Machine Lateral Raise, Dumbbell Front Raise, Behind-the-Back Cable Lateral Raise, Smith Machine Decline Press, Low-to-High and High-to-Low Cable Fly, Chest-Supported Wide-Grip and Close-Grip Row, Close-Grip Lat Row, Back Extension, and Smith Machine RDL, Shoulder Press, Hip Thrust and Split Squat.
  - "Preacher Curl" is renamed "Barbell Preacher Curl" (same row, boards and lifts).
  - Already existed: Machine Preacher Curl, Smith flat (Smith Machine Bench Press), Smith incline (Incline Smith Press), Smith Squat, Keenan Flaps, Recline Curl, Kelso Shrug, Bicep Supination and Face Pull.
  - **Owner decisions (2026-11-17), all added:**
    - Cable Triceps Extension: the elbow stays fixed and the arm extends downward. It's distinct from Triceps Pushdown and Overhead Triceps Extension.
    - Close-grip lat row in two versions: Cable Close-Grip Lat Row and Machine Close-Grip Lat Row.
    - The wide-grip chest-supported row stays a plate-loaded machine.
    - Back Extension (bodyweight, reps) plus Weighted Back Extension (held plate or barbell, on the added load, like Weighted Pull-Up).
    - Preacher curls come in barbell, dumbbell (new) and machine versions.
- **Images:** 24 exercises have no approved illustration (icon fallback). See `docs/missing-exercise-images.md` and `.json`.
- **Navigation delay (~2 s), investigated:**
  - **Regions:** Vercel functions run in iad1 and the database is in ca-central-1, about 15–25 ms per round trip.
  - **Where the time goes:**
    - Each in-app navigation is a server render (dynamic, by design for freshness and privacy) behind auth.
    - Pages made several sequential round trips: the layout's profile then unread count; Training's catalog, then defaults, then session, then splits, then settings.
    - The likely rest is serverless cold starts and RSC payload time on phone networks.
  - **Done (safe):**
    - The layout fetches profile and unread count in parallel.
    - Training's independent reads run in one round trip.
    - The public catalog is read cookieless and shared per server instance for 60 s, removing two queries per page. Nothing private is cached.
  - **Not done (would need your call):**
    - Moving the Vercel function region next to the database (yul1/Montreal isn't a Vercel region; the nearest is iad1 already).
    - Prefetching the Training tab.
    - Partial prerendering / Cache Components, which would be a larger change.
- **Docs:** `docs/community-roadmap.md` (future community features, not built) and `docs/ios-packaging.md` (Capacitor, App Store notes, Live Activity plan).
- **Tests so far:**
  - Typecheck, lint and unit tests 51/51.
  - SQL `tests/sql/1900_*` passes in a rolled-back transaction on the hosted DB.
  - **E2E after applying:** hosted 17/17 (including Flow N), art 3/3, iPhone 7/7, 0 stalls, test accounts removed.
  - **`…1900` applied:**
    - Dry run showed only that file.
    - The permission diff adds only `authenticated` SELECT on `training_day_exercises.alt_group`, still behind owner-only RLS.
    - After applying: exercises 1–68, lifts, all 339 training sets, routines, sessions and profiles are identical to the baseline. All 218 old aliases are kept (279 now). 87 exercises; Preacher Curl only renamed.

## 2026-11-16 Training UX review fixes (no migration; committed locally, not yet pushed)

- **Start:** beside the day heading, and floating above the tab bar on phones.
- **Day editor:**
  - Full names on up to two lines, with 44 px controls (set stepper, and one ⋯ menu for Move, Replace and Remove, with Remove separated).
  - Add exercise at the top (and bottom for long days), and a sticky Save/Cancel footer.
- **Picker:**
  - When replacing: titled "Replace X", similar movements first (shared primary muscles, then category and equipment).
  - Marks "Current" and "In this day". When adding: "Add an exercise".
- **Units everywhere sets are summarized** ("240 lb × 6"), and per-dumbbell weights read "each".
- **History set editor:** visible Weight / Reps / RIR (optional) / Date labels, plus "RIR = reps left before failure".
- **"+" is now "Submit lift"** on desktop and phone (with a visible label), and the page is titled "Submit lift".
- **Sessions page:** explains that sets logged on their own live in exercise history, with links to each exercise.
- **Kept on purpose:** one note per exercise (owner's request, 2026-11-16).
- **Tests:** hosted 16/16, iPhone 7/7, unit tests 44/44, 0 stalls.

## 2026-11-15 Training sessions, RIR, notes, SBL exercises, Buddy (applied and deployed)

**Migration `…1800` was applied with the owner's approval.**
- **Before applying:** dry run (only `…1800`); permission diff reviewed (old `update_training_set` replaced, everything else additive).
- **After applying:** existing data identical to the baseline, including the 305 real training sets (none gained a session or RIR). 68 exercises.
- **Tests:** hosted 16/16 including Flow M and M2, iPhone 7/7, 0 stalls, no test accounts left.
- **Bugs the tests caught:**
  - Discard's confirmation was asked inside a React transition and never rendered. Fixed by asking first.
  - The RIR input was 15 px, which makes iPhone zoom. Now 16 px.
- **Security:** Next.js 16.4.0 has critical advisories (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r), fixed in 16.4.6. `next build` now stops once with a security notice. Upgrade pending the owner's OK.

**Done:**
- **Migration `20261011001800_training_sessions.sql`** (not applied).
  - Sessions: one active per user, server draft with versioned autosave, atomic and idempotent `finish_training_session`, discard.
  - Sets: `rir` (null = not recorded) and `session_id`.
  - Notes: routine notes on `exercise_preferences.note`; session notes on the session.
  - Tips: `user_settings.training_tips` and tip dismissals.
  - Exercises: Keenan Flaps, Recline Curl, Kelso Shrug, Bicep Supination (training-only) and Face Pull, with aliases.
  - Rolled-back test `tests/sql/1800_training_sessions.test.sql` passes (11 groups, including atomicity, retries and privacy); canary checked.
- **App:**
  - Start/End session logger (`training/active-session.tsx`): localStorage plus server draft, End with validation and retry, Discard; add, swap, remove and reorder exercises in a session; Save to routine; ±Set; L/R; routine and session notes; optional RIR.
  - Idle day preview with Start; session history (`/training/sessions`); RIR in exercise history.
  - Training Buddy (rule-based, dismissible, can be turned off in Settings).
  - Training-only exercises hidden from competitive pickers.
- **Checks:** typecheck and lint clean, unit tests 40/40.

**Also done:**
- Unit tests for session drafts and tips (44/44).
- Browser tests: Flow M (sessions end to end: Start, RIR, notes, leaving and closing, quick changes, validation, failed save then Retry, PR suggestion, explicit submit, infinite rotation, history, RIR edit, Discard, privacy) and Flow M2 (left/right and ±Set in a session).
- The old checkmark flows (J, K1, K3, L, L2) were removed; K2 (search) is kept. The iPhone Training test starts a session first.
- Docs: `docs/adding-exercises.md`, `docs/ai-assistant-plan.md`.

- Recline Curl confirmed by the owner (2026-11-15): standing one-arm dumbbell curl, upper arm braced on an incline bench back.

## 2026-10-20 "− Set" on the training day (no migration)

- **Problem:** the training day had only "+ Set", so an extra row (or fewer sets than planned today) couldn't be removed. The − in Edit day, which changes the routine's set count, worked.
- **Fix:** "− Set" next to "+ Set" removes the last row for today only.
  - An empty row goes at once. Typed-but-unsaved numbers go through the "Unsaved changes" dialog.
  - A saved set is never removed. A note links to the exercise's history, where saved sets are deleted.
  - In L/R mode the Left and Right rows go together. It can't go below one row, and a reload shows the planned count again.
- **Tests:**
  - Flow K3 (add and remove, the unsaved dialog, saved sets kept, the minimum, today-only) and Flow L2 (L/R pair).
  - The test runner's admin client now has a 15 s timeout with one logged retry, after a K3 run hung 9 minutes on a silently dropped connection. The trace showed the browser idle after sign-up while the runner's lookup waited; the app server showed 0 stalls.
  - Results: hosted 19/19, iPhone 7/7, unit tests 39/39, 0 stalls.

## 2026-10-18 Unilateral (left/right) sets in My Training (applied and deployed)

**Migration `…1700` was applied on 2026-10-18 with the owner's approval.**
- **Before applying:**
  - Final review: the only destructive statements are the two replaced function signatures (same grants) and a dropped-and-recreated index.
  - The permission diff matched exactly. Dry run listed only `…1700`.
- **After applying:**
  - Baseline identical: lifts, exercises apart from the new flag, aliases, records, training sets apart from the new side, routines, notifications, files. The existing real training set stays unassigned. 28 exercises flagged.
  - Live checks 64/64. Hosted Playwright 17/17 including Flow L. Flow L's first run failed on a test selector ("Side" also matched "Both sides best"), was fixed, and passed. iPhone 7/7, 0 stalls, no test accounts left.
- **Unilateral competitive scoring:** still only the proposal below. Not built.

**Migration `20261011001700_unilateral_sets.sql` (NOT applied).** Additive for data: no row is changed or deleted. Leaderboards, lifts, scoring and `submit_lift` are untouched.
- **`exercises.supports_unilateral`:** a new column (default false), set true for 28 exercises:
  - Arms: dumbbell, hammer, incline, cable and machine preacher curls; cable wrist curl; triceps pushdown; overhead triceps extension.
  - Shoulders: lateral and cable lateral raises, rear delt fly, dumbbell and machine shoulder presses.
  - Chest: dumbbell and incline dumbbell presses, machine and incline machine chest presses, cable fly.
  - Back: lat pulldown, seated cable row, machine row, chest-supported row.
  - Legs: Bulgarian split squat, leg press, leg extension, both leg curls, calf raise.
  - Barbell, Smith, bodyweight and fixed-path movements stay bilateral. No other exercise column changes.
- **`training_sets.side`:** `left` / `right` / null. Null means both sides or unspecified, so every existing row stays valid and is never assigned a side.
  - The slot index is now `(user, exercise, date, set number, side) NULLS NOT DISTINCT`, so Left 1 and Right 1 coexist and a both-sides set 1 still can't be saved twice.
- **`exercise_preferences`:** owner-only (RLS select own, no direct writes), set through `set_unilateral_preference`, which refuses exercises that can't be done one side at a time.
- **Function changes:**
  - `log_training_set` and `update_training_set` are replaced by versions with an optional side; old-style calls behave exactly as before.
  - An edit keeps its side unless `p_side` is `left` / `right` / `none`.
  - One-side sets never trigger PR prompts (`_personal_best` counts both-sides sets only).
  - `submit_training_set` refuses them (`unilateral_not_on_boards`).
- **Rolled-back test (`tests/sql/1700_unilateral_sets.test.sql`)** passes. It covers:
  - existing sets untouched and lifts unchanged;
  - the 28 flags; preferences only where allowed;
  - left and right as separate slots, double taps, and old-style calls;
  - sides refused on barbell bench; edits keeping the side, the slot-taken check and clearing a side;
  - no PRs for one-side sets, and no submissions;
  - privacy: no reads or writes by another user.
  A deliberate canary failure was reported correctly.

**App:**
- **Training day:** exercises that support it get an "L/R" switch. The choice is remembered per exercise.
  - In L/R mode each set has a Left and a Right row, each with its own previous value, inputs and ✓. Enter moves Left → Right → next set.
  - Both-sides sets never stand in as a left or right "previous".
  - The unsaved-sets warning tracks each side row, and switching modes with unsaved numbers asks first.
- **History:** best set and trend per group (Both sides / Left / Right). Rows show L/R, and editing shows a Side picker that keeps the saved side unless changed.
- **From Training:** leaves out one-side sets; opening one directly says it stays in the training log.
- **Before the migration:** the code works either way. Catalog and set queries select `*`; the side is sent only when chosen; missing preferences mean "both sides".

**Proposed unilateral competitive scoring (not built; needs approval):**
- **Separate boards:** "single-arm/leg" boards per exercise, never mixed with both-sides boards.
- **A pair, not a side:** an entry is a left and a right set with the same set number on the same day, submitted together. One side alone can't be submitted.
- **Score:** the weaker side's estimated 1RM (existing Epley, both sides at 12 reps or fewer); ties go to the stronger side. Display both sides, e.g. "30×10 · 27.5×10".
  - Using the weaker side stops strong-side-only entries and rewards balance. An average would let one side carry the other.
- **Rules unchanged:** same weight conventions (per dumbbell, stack), verification and privacy. A proof video must show both sides.

**Tests:** typecheck and lint pass; unit tests 39/39 (new: the 28-exercise list is real slugs and never barbell, Smith or bodyweight). Against production, before the migration: hosted Playwright 16/16 and iPhone 7/7, 0 stalls; no test accounts left.
- New Flow L covers the L/R switch and its persistence, Enter order, left/right saves, both-sides bench unchanged, previous per side, unsaved warnings (leaving and switching mode), history groups, editing that keeps the side, one-side sets kept off boards, and privacy.

## 2026-10-16 13 new exercises with illustrations, muscle search, unsaved-set warnings (applied and deployed)

**Migration `…1600` was applied on 2026-10-16 with the owner's approval.**
- **Before applying:**
  - Only three statements; the one delete removes exactly the 2 moved alias rows.
  - Permission diff empty. Dry run listed only `…1600`.
  - Baseline taken of every lift, the 50 exercise rows, all other aliases, records, training data, notifications, achievements and files.
- **After applying:** identical to the baseline, 63 exercises, live checks 64/64.
- **Test run:**
  - A first full run was interrupted when the Mac slept, which left the test server's connections to Supabase stalling for minutes.
  - Diagnosis: `src/instrumentation.ts` with `src/lib/net-debug.ts`, opt-in through `LR_NET_DEBUG=1`, which `scripts/e2e-supabase.sh` sets. It prints server-side Supabase requests slower than 2 s and stalls over 5 s, with no headers or keys. Playwright now uses a 20 s action timeout and a 30 s navigation timeout.
  - Final run on a fresh server: hosted 16/16 (including all 63 illustrations, the unsaved warning and muscle search) and iPhone 7/7, with 0 stalls and no request slower than 2 s.
  - No test accounts remain.

**Migration `20261011001600_more_exercises.sql` (NOT applied).** It inserts 13 exercises (50 → 63) and their aliases, and moves the aliases `sldl` and `stiff leg deadlift` from Romanian Deadlift to the new Stiff-Leg Deadlift. It's additive otherwise: no existing exercise row, lift, score, ranking, function or permission changes.
- **Rolled-back test** (`tests/sql/1600_more_exercises.test.sql`, run after a snapshot) passes. It checks:
  - 63 active exercises; the 50 existing rows unchanged byte for byte; all lifts unchanged;
  - each new exercise's category, equipment and scoring; `sldl` pointing only to SLDL;
  - bodyweight raises scored by reps with weight refused; the sit-up scored on the held weight only; the 12-rep ranking rule;
  - SLDL and RDL on separate boards;
  - new exercises added to an existing customized day without changing its set counts; training sets kept off boards; submitting from training.
  A deliberate canary failure was reported correctly.

**New exercises** (all scored with existing conventions):
- **Abs/Core:**
  - Cable Crunch and Machine Ab Crunch: stack, est. 1RM, machine selectable.
  - Hanging Leg Raise and Hanging Knee Raise: bodyweight, ranked by reps.
  - Weighted Decline Sit-Up: the held weight only, est. 1RM on that added load, like Weighted Pull-Up.
- **Legs:** Stiff-Leg Deadlift (barbell); Hip Abduction and Hip Adduction (stack).
- **Arms:** Smith Machine JM Press (`jm-smith-press`, a Smith machine as the slug and pending illustration show), Incline Dumbbell Curl, Machine Preacher Curl, Cable Wrist Curl.
- **Back:** Close-Grip Lat Pulldown.

The "added weight" hint now mentions a held plate.

**Search** (`src/lib/exercise-search.ts`, one function behind every picker):
- **What it searches:** name, aliases, primary and secondary muscle (`src/lib/exercise-muscles.ts` tags all 63, kept in code so catalog rows don't change), equipment, category and muscle group. It handles plurals and slang (tris, quads, hams, lats, abs/core, db, bb…).
- **Ranking:** exact, then name prefix or whole word, then primary muscle (a name that names the muscle first), then secondary, then equipment/category/group, then typos.
- **Filters:** the picker has category chips: All, Chest, Back, Shoulders, Arms, Legs, Abs/Core. Each chip appears only when that category has exercises, so Abs/Core shows once the migration is applied.

**Unsaved sets** (`src/app/(app)/training/unsaved.tsx`):
- **What counts:** a row is unsaved when its numbers differ from what's saved, or from blank. Focusing an input never counts; copying previous values that change the inputs does.
- **Indicator:** an amber dot on the row and "N unsaved sets" by the day title.
- **When it warns,** only while something is unsaved:
  - refresh or close: the browser's beforeunload prompt;
  - in-app links (day chips, Change split, tab bar, header): a capture-phase click check on `window`, because Next mounts React on `document` and a listener there ran after `<Link>`;
  - browser Back: one extra same-URL history entry;
  - Edit day: the same dialog.
- **The dialog:** "Unsaved changes" with "Stay and save" (keeps everything as typed, saves nothing, scrolls to the first unsaved row) or "Discard changes".

**Tests:**
- Typecheck and lint pass. Unit tests 38/38 (new: the 63-exercise catalog parsed from the migrations, muscle and alias search, SLDL vs RDL, Abs/Core).
- Hosted Playwright 15/15, including new Flow K1 (unsaved: day switch, tab bar, Back, refresh, Edit day, editing a saved set, copying previous values, several unsaved rows, keyboard Enter) and K2 (search in the + and Training pickers, category chips). iPhone 7/7.
- Production data unchanged. The two training splits in production are the owner's own.

**Images:** all 13 new illustrations are integrated, with the owner's go-ahead (2026-10-16), from the Codex output folder `liftrank-additions`.
- `smith-machine-jm-press.png` was renamed to the slug `jm-smith-press`.
- They went through `scripts/optimize-exercise-images.py` (800 px panel and 112 px thumbnail WebP, transparency kept; 1.7 MB for the 13).
- All 63 were processed in a scratch folder and only the 26 new files were copied in. Re-encoding reproduced the existing 100 files byte for byte, so the original 50 are untouched.
- `exercise-images.ts` lists all 63, and a unit test checks that every catalog exercise has both files. The images appear once migration `…1600` adds the exercises.

**Scoring limitations:**
- Crunches, abduction, adduction and wrist curls rank by est. 1RM on the stack number, as every cable or machine exercise does. They're often done for more than 12 reps, and those sets save but don't rank.
- Weighted decline sit-ups depend on bench angle, and est. 1RM of a held plate isn't a tested max. The board is comparable only within the same setup.
- Hanging raises rank by reps, like pull-ups, with no tempo or range standard.

## 2026-10-16 My Training: personal tracker (applied and deployed)

**Migration `…1500` was applied on 2026-10-16 with the owner's approval.**
- **Before applying:**
  - Top-level statements: the only change to an existing table is the nullable `lifts.training_set_id`.
  - A full permission diff (function execute, table and column grants, RLS policies) showed nothing removed and only the expected additions.
  - All 10 callable functions are SECURITY DEFINER with `search_path ''` and use `auth.uid()`. The internal `_` helpers (two of which take a user id) aren't callable by `authenticated` or `anon`.
  - The rolled-back functional test passed, and the dry run listed only `…1500`.
- **After applying:**
  - A baseline of every lift's scoring fields, records, achievements, notifications and files was identical, and live permissions matched the review exactly.
  - Live checks 64/64. New: training sets never reach a board, the feed, notifications or the profile, and a friend can't read or change them; a submitted set's numbers match, are submitted once and survive a race; editing a linked set is refused, and deleting it leaves the board result unchanged.
  - Playwright 13/13 hosted, including Flow J. iPhone checks 7/7, including the 320 px Training test.
- **Bugs found by Flow J and fixed:**
  - Returning mid-workout opened the next day instead of the one in progress.
  - The result screen vanished after submitting from Training, because the refresh re-rendered the page into its "already on board" state.
- **Cleanup:** no test data remains. The one friend invite in production belongs to the real `babana` account.

**What the migration changes** (additive only: no existing row or function is modified):
- **New tables, private to the owner:** `training_splits`, `training_days`, `training_day_exercises` and `training_sets`.
  - RLS allows select by the owner only, and clients get no insert, update or delete grants; every write goes through the functions below.
  - Each set stores the exercise, the weight as typed, kg, reps, the score and whether it's ranked (same `compute_score` as lifts), the local date, the time, the set number and optional machine fields.
  - Unique indexes cover (user, exercise, local date, set number) and (user, client key), so a double tap can't create a duplicate.
- **`lifts.training_set_id`:** a new nullable column with a partial unique index on live lifts, so each set can have only one board entry.
- **New SECURITY DEFINER functions:** all use `search_path ''` and `auth.uid()`, and none takes a user id.
  - Routines: `import_training_split`, `set_active_training_split`, `save_training_day`, `add_training_day`, `delete_training_day`.
  - Sets: `log_training_set`, `update_training_set`, `delete_training_set`, `dismiss_training_pr`.
  - `submit_training_set`: locks the set row, refuses a second live submission, then calls the existing `submit_lift` and links the result. All board rules, notifications and rival logic apply only at that point.
- **Rule for sets on a board:** their numbers and date are locked (`training_set_submitted`); edit the board entry instead. Deleting such a set leaves the board entry as it is, just unlinked.
- **PR rule:** the set must be ranked (12 reps or fewer), there must be earlier history (a set from an earlier day or a counted lift), and it must beat every earlier counted performance. The UI prompts only for the featured exercises in `FEATURED_SLUGS`.

**App changes:**
- **Navigation:** the phone bar is Home | Boards | Training | + | Friends. A header with the logo, bell and avatar (to your profile) appears on every phone page. The desktop sidebar adds Training and keeps Profile.
- **`/training`:**
  - A split chooser with 7 templates and 1x / 2x / 3x / Rotate options, where frequency repeats the same days.
  - Day chips with a "Next" suggestion.
  - Spreadsheet rows: set, previous (tap to copy), weight, reps and ✓. Enter moves from weight to reps, then saves.
  - Saved rows turn green and can be corrected in place. Nothing is written until ✓.
  - An editor to rename, add, remove, replace, reorder and change set counts, plus add or remove days. Changing splits keeps every set, and older splits can be switched back to.
- **`/training/exercise/[slug]`:** your best set, a trend chart, and every set by day, each of which can be edited (including its date) or deleted. Each set shows "Submit" or "On board".
- **+ (`/lift/new`):** two tabs, "From Training" (best sets with featured exercises first, then recent ones) and "Enter a lift" (the existing form, which is still the default).
  - Choosing a set shows its numbers. You pick visibility and submit, and see the usual result screen.
  - A proof video can be added from the lift page afterwards.
- **Phones:** while typing, the tab bar hides and returns 0.35 s after the keyboard closes. That delay prevents the bar from covering a button mid-tap (Flow H caught this). Focused fields scroll clear of it.

**Tests:**
- typecheck and lint pass; unit tests 32/32 (template slugs exist, rotation text, next-day order, set formatting).
- `tests/sql/1500_training_tracker.test.sql` passes in a rolled-back transaction against the live schema, covering:
  - import, customize, log, double tap, slot duplicates, PR rules, edit, delete, submit, a second submission refused;
  - linked-set lock, deleting a linked set, privacy between friends (RLS as `authenticated` and RPC ownership), and switching splits keeping history;
  - existing lifts unchanged.
  A deliberate canary failure was reported correctly.
- Hosted Playwright: all existing flows pass, including A, H and I, plus the 6 iPhone checks.
- Waiting for the migration: `flow-j-training.spec.ts` (20 scenarios end to end) and `training-ios.spec.ts` (320 px). Both skip until `…1500` is applied.

**Not done yet:**
- New competitive notifications ("approaching a close rival") and giving featured exercises more weight in rival notifications. The existing pass and first-place notifications still apply to submitted lifts.
- Choosing a machine for training sets (the database supports it; the UI doesn't yet).

**Production note:** a real account, `babana`, signed up on 2026-10-16 at 06:36 UTC and logged 2 lifts. It's untouched.

## 2026-10-16 exercise illustrations (all 50, no migration)

- **Source:** the approved set of 50 transparent 1254px PNGs (blue wireframe, red/orange muscle highlights), one per catalog slug. None are missing or extra.
- **Optimization:** `scripts/optimize-exercise-images.py <folder>` trims the transparent margins, pads each image back to a square (no stretching), and writes WebP with transparency to `public/exercises/img/`:
  - `<slug>.webp` at 800 px, about 121 KB on average, for the panel;
  - `<slug>-thumb.webp` at 112 px, about 6.5 KB, for search results;
  - 6.4 MB in total, down from 77 MB.
  The script also generates `src/lib/exercise-images.ts`. The original PNGs stay outside the repo. Re-run the script if the set changes.
- **Display:**
  - `ExerciseThumb` and `ExerciseInfo` choose by slug: the WebP first, then the older SVG (`exercises.illustration`), then the dumbbell icon. A failed load moves to the next option.
  - "About this exercise" stays collapsed and loads the full picture only when opened. Its legend dots match the red/orange highlights.
  - `/exercises/*` is cached for a week, with background refresh.
- **No data changes:** exercise names, IDs, `illustration` values, lifts and rankings are untouched.
- **Tests:**
  - `exercise-art.spec.ts`: thumbnails load in search and across the full list; the panel is collapsed by default; the 800 px image loads square only on open; no sideways scroll; and the fallback chain works with the WebP files blocked.
  - `exercise-art-ios.spec.ts`: the same at 320 px in WebKit.
  - All 12 hosted flows and 6 iPhone checks pass.
- **Review notes:** all 50 images show the right exercise. The muscle highlights are stylized rather than clinical. Images worth a second look:
  - `chin-up` and `weighted-chin-up`: the underhand grip isn't clearly shown.
  - `front-squat`: obliques are highlighted, which is unusual for this lift.
  - `deadlift`: the bar reads as slightly behind the shins from this rear view.
- **Production data:** `tristanpham` verifying `tptest`'s proof in the live app (2026-10-16 06:19 UTC) changed that lift's status and added 2 notifications. That was real use, not the tests.

## 2026-10-15 polish pass (UI only, no migration)

- **Add Lift / Edit Lift on short phones:**
  - Only Submit floats now, on an opaque, fade-edged backdrop above the tab bar. The visibility row moved back into the normal flow, just above Submit, so it can no longer cover the machine fields.
  - Focused fields scroll clear of Submit (scroll margin), and opening "Change" scrolls the options into view.
  - While a text field has focus the tab bar hides. Submit deliberately stays put, because moving it on blur made taps miss: the iPhone SE audit caught this.
  - New WebKit test `tests/e2e/mobile-forms.spec.ts` (opt-in with `E2E_IOS_AUDIT=1`) checks 320×568 and 375×667 with a machine exercise, for Add and Edit, including taps with a field focused.
- **Leaderboards, more compact:**
  - Filters sit in one horizontally scrolling row.
  - The ranking explanation is one row of chips: "Ranked by est. 1RM ⓘ", the machine picker, and "Same machine" or "Mixed machines · informal". The ⓘ opens the formula, what the logged weight means, and the machine note.
  - Your-rank card is shorter. The "Of N ranked lifters…" line is gone (#N of N shows it), and "Est. 1RM 262 lb" no longer wraps.
- **Proof upload copy:** "Film the full set, showing the weight and every claimed rep. Record at 1080p, not 4K, so it fits."
  - The over-length message now says "Trim it to 30 seconds: just the set."
  - The limits are unchanged; see the evaluation below.
- **Consistency:**
  - Muted text is brighter (`--color-fg-2` #b4bac6, `--color-fg-3` #9ca3b3).
  - Verification wording now says verify and confirm everywhere. The button reads "Verify lift". The stale "A reviewer will check it" lines now refer to friends (moderators haven't verified since `…1200`). The verified-only empty state was updated to match.
- **Exercise history from Profile:** on your own profile, tapping a record opens that exercise's history, with a one-line hint. Home is unchanged.

**Video limit evaluation (no change made):** the current limits are 30 s, 25 MB, 3 uploads a day, a 750 MB storage budget and 3 GB of views a month.
- **Ranked sets:** at most 12 reps, about 2–3 s each, so 25–35 s with the unrack. 30 s covers most ranked sets. The longest 10–12-rep sets and bodyweight max-rep sets (e.g. 30+ push-ups) can run over.
- **Size is the tighter limit:**
  - iPhone 1080p30 HEVC is about 1 MB/s, so 30 s is about 30 MB, already over 25 MB; 4K is about 3 MB/s.
  - Verified videos are kept, so 750 MB holds about 30 full-size videos in total.
  - Raising the length to 60 s would need about 60 MB per file, above the Free plan's 50 MB per-file cap.
- **Recommendation:** keep the limits, and ask for 1080p (done in the copy). If longer sets matter, add in-browser compression to 720p (about 0.3 MB/s, so 60 s ≈ 18 MB) before raising `max_seconds`. Or move to Pro storage (100 GB) and raise the budget. Either is a product and cost decision.
- **Checks:** typecheck, lint, 28/28 unit tests; Playwright 10/10 against hosted Supabase; iPhone audit 3/3; small-phone forms 2/2. Production data was identical to the baseline before and after, and no test accounts remain.

## 2026-10-15 improvement pass (applied and pushed)

**Migration `…1400` was applied on 2026-10-15 with the owner's approval.**
- **Before applying:** I checked it for destructive statements (none outside the function bodies). The function grants before and after only add the 5 new functions. The dry run listed only `…1400`.
- **After applying:** row counts and a fingerprint of every lift were identical to the baseline.
- **Tests after applying:**
  - live checks 61/61 (8 new for editing and invites);
  - Playwright 10/10, adding **Flow I**: edit → rescored → visibility-only edit → exercise history → invite link → friend goes through signup, login and onboarding → deliberate add → ⋯ menu → private lift stays hidden.
- **Cleanup:** no test data is left. `cleanup-test-users.mjs` now also matches the `edna_` accounts and the numbered `lr-verify` tags.

- **Edit lifts:** an Edit lift button opens the Add Lift form prefilled (`/lifts/[id]/edit`), and `edit_lift` handles the save on the server, owner only, with the same validation as `submit_lift`, limited to 30 edits an hour.
  - Changing the exercise, weight, reps, date or machine clears the video and verification, withdraws open proof requests, and removes the feed items and passed / first place / gym record notifications that described the old numbers. Editing only notes or visibility clears nothing.
  - Group champions and gym records are recalculated; PRs and boards are computed live.
  - `lift_edits` keeps an audit row, readable by the owner. Nothing is re-notified or re-awarded on an edit.
- **Competitive targets:** `rivalComparison` (in `lib/rival.ts`) replaces the "lift X to pass" targets.
  - Within 10%, it gives the gap in estimated 1RM; further away, the rival's lift; between different machines, it says the comparison is informal and gives no exact gap.
  - With no rival, Home shows an invite card, and "on top" appears only when the board has more than one person.
- **Friend invites:** a personal link (`/f/[token]`: hashed, 30 days, 50 uses) with native share and a copy fallback. The link survives signup and login (`lr_friend` cookie), and accepting always needs a tap. Remove and Block moved into a ⋯ menu; Groups are linked from Friends.
- **Machine boards:** a context line shows "Same machine · model" or "Mixed machines · informal" with the machine filter, plus "Ranked by estimated 1RM ⓘ" (formula explained) and what the logged weight means.
- **Visibility:** "Visible to Public · Change" sits next to Submit. The wording in `lib/visibility.ts` matches RLS.
- **Exercise history:** `/lifts/exercise/[slug]` shows your best, a trend line once there are three or more days, and every set with its estimated 1RM, plus a Log again button (prefills from the last set). It's linked from your lift page.
- **Home:** Your rankings → Your next rival → Recent activity → Check a friend's lift (moved last).
- **Mobile:** muted text is brighter (`--color-fg-3` #8f97a8); Add Lift is compact and Submit stays above the tab bar.
- **Verification wording:** the states are now Self-reported / Video attached / Verified / Disputed. The check says "this weight and every rep", the lift page names who confirmed it, and the copy says "a friend's check, not an official judgment". Self-verification and second confirmations were already blocked in `…1200`.
- **Date bug (Oct 16 vs Oct 15):** stored times were right. Pages rendered on the server in UTC, so evening lifts in Pacific time showed the next day.
  - Fix: the browser sets a `tz` cookie, and every date goes through `formatDate(iso, tz)`; the fallback is `America/Los_Angeles`.
  - Add Lift computes "today" in the browser. No data changed.
- **Tests:**
  - typecheck, lint and 28/28 unit tests;
  - `tests/sql/1400_edit_lifts_friend_invites.test.sql` passes in a rolled-back transaction against the hosted schema (9 scenarios);
  - Playwright against hosted Supabase: all 9 flows pass (D, E and F were updated for the new visibility control and wording), plus the iPhone audit 3/3 (320, 393 and 430 px). Flow I covers the edit and invite screens.

## Status

Phases 1–7 are built and **verified against the hosted Supabase project** (`yfrwcjvrtcxzifhnppdj`) as of 2026-10-13. All 11 migrations (`…0100` to `…1100`) are applied, and the remote is up to date. Results: 53/53 live checks, 9/9 Playwright flows against real Supabase (plus the opt-in iPhone audit, 3/3 in WebKit), 28/28 unit tests, plus typecheck, lint and production build. **Nothing is deployed.** The folder is a local git repository (branch `main`) and isn't pushed anywhere yet.

Re-verify any time with `npm run verify:supabase` and `bash scripts/e2e-supabase.sh`. Neither ever resets anything; both delete their own test users, reports, groups, gyms, machine models, videos and pictures. `node --env-file=.env.local scripts/cleanup-test-users.mjs --delete` sweeps leftovers.

**Test port:** the e2e scripts use **3210**. Port 3100 is taken by another local project (AutoCommerce's `next dev`).

**Dev machine note:** the owner's Mac has no Homebrew or local Postgres, so `npm run test:db` and `npm run test:e2e:local` can't run there. Verify SQL changes with live checks in `scripts/verify-supabase.mjs` instead: add one per new behavior, using throwaway users, and clean up anything that outlives its user (Storage files do). Before pushing a migration, dry-run it against the live schema inside `begin; … rollback;` with `npx supabase db query --linked -f <file>`. That caught a real PL/pgSQL error in `…0800` before it was applied.

## Test results

| Suite | Result | Notes |
|---|---|---|
| `tsc --noEmit` | ✅ pass | strict |
| `eslint` | ✅ 0 errors, 0 warnings | |
| `next build` | ✅ pass | built by `e2e-supabase.sh` |
| Unit (`npm test`) | ✅ 28 / 28 | Phase 5: badge states (Unverified / Proof uploaded / Disputed / Not accepted / Verified), wording never implies cheating, file type/size/length checks, a friendly message for every error code in `…0800` |
| Database (`npm run test:db`) | ⚪ not run (no local Postgres) | 41 / 41 when last run, before Phase 5. `tests/db/shim.sql` now has a minimal `storage` schema so `…0800` applies there |
| Live check vs. hosted (`npm run verify:supabase`) | ✅ 53 / 53 | Phases 1–3: 19 · Phase 4: 10 · Phase 5: 13 · appeals: 1 · Phase 6: 5 · **Phase 7: 5** (pictures, reports, moderation, rate limits) |
| Playwright vs. hosted (`bash scripts/e2e-supabase.sh`) | ✅ 9 / 9 | adds **H (profile picture → report → moderator removes it → account deletion removes account, profile and files)**. |
| iPhone audit (`E2E_IOS_AUDIT=1 … playwright test ios-audit`) | ✅ 3 / 3 | WebKit at iPhone SE (320 px), iPhone 15 and iPhone 15 Pro Max, over 13 screens. No horizontal overflow, no form control under 16 px. Small tap targets are listed as notes. |
| Playwright, earlier flows | ✅ | A, PR in ≤5 taps, validation, B, D, E (gyms), F (request proof → upload → requester watches → review → verified), **G (title → achievements, profile, cards, record history → rejected: title lost → appeal to a different moderator → title back)** |
| Security | ✅ | Git secret scan of all 186 tracked files: no keys, tokens or DB URLs (`.env.local` ignored). Security headers are served. Secret key and secret env names absent from the client bundle. `supabase db advisors --type security`: no RLS gaps, and no anon-callable function besides the invite preview. The remaining warnings predate Phase 5 (see Known limitations). `/api/cron/daily` returns 404 without `CRON_SECRET`, and card routes return 404 when signed out |

**Phase 5 live checks:**
- The bucket is private, its size cap equals `proof_settings.max_bytes`, and it accepts only MP4/MOV/WebM. Budgets are within the Free plan.
- Signed-out users can't upload, nobody can upload without a reserved slot or into someone else's folder, and nobody can list another user's folder.
- Only friends can request proof, once per lift; the owner is notified.
- Upload validation: only the owner may reserve a slot, and type, size and length limits are enforced.
- An upload marks the lift "proof uploaded", never verified. The requester is notified. Stored files can't be overwritten, and the bucket rejects non-video types.
- Only the owner and moderators can watch, through a 2-minute grant. A friend can't sign a URL, and the public URL is refused.
- A file under review can't be deleted, even by its owner.
- Only moderators review, never their own lifts; the queue works.
- Verification shows on the verified-only board (no champion there) and notifies both people. A verified lift accepts no new proof.
- "Insufficient" and "rejected" remove the video. Others see "disputed", never "rejected", and never the reviewer's note. The upload limit is 3 a day.
- Declining changes nothing about the lift, can't be asked again, and notifies the requester.
- Proof requests are limited per day, and deleting a lift withdraws its open request.
- A deleted lift's video and abandoned uploads can be removed by their owner. The cleanup job is service-role only.

### Phase 4 verification tooling (earlier session, Oct 11)
- `scripts/verify-supabase.mjs`: added the 10 Phase 4 live checks. It adds a fourth test user, made a moderator through the secret key. Test gyms are placed at Point Nemo (-48.88, -123.39) so they can't appear on any real user's nearby board, and test gyms and models are deleted by id at the end.
- `tests/e2e/flow-e-gyms.spec.ts`: runs against hosted Supabase as well. The test gym uses a made-up city ("Testville") and Point Nemo coordinates.
- `scripts/cleanup-test-users.mjs`: also matches the `lr-verify-…-m` moderator, and deletes orphaned test gyms (`E2E Iron ……`, `LR verify …`) and machine models (`Iso Press ……`, `LR verify … Press`). It now runs cleanup even when no test users remain.

## Built

**Phase 1, foundation:** Next.js 16 + strict TS + Tailwind 4 design tokens (brief palette, Geist, tabular heavy numerals); hand-rolled shadcn-style primitives; Supabase SSR clients and `proxy.ts` session refresh and route guard; email signup/login, password reset, sign-out, Google sign-in behind a flag; protected routes; onboarding (username → first lift → invite); bottom tab bar on mobile and sidebar on desktop; landing page with a labeled example board; full schema with RLS on every table, including Phase 4–5 tables.

**Phase 2, core lifting:** 50-exercise catalog with 152 aliases; instant typo-tolerant search with recent and favorite exercises; Add Lift with remembered exercise, weight, reps and unit, per-exercise weight-convention hint, live e1RM preview, the >12-rep warning, date, visibility, group sharing and notes; `submit_lift` RPC (validation, dedupe, scoring, PRs, ranks before/after); result screen (PR celebration, rank moves, people passed, new titles); lift history; lift detail with sharing/notes edits and delete; Friends and Group leaderboards (all time / this month, pagination, sticky "your rank" card with next rival and gap text, champion banner).

**Phase 3, social:** friends (search, request, accept/decline/cancel, remove), blocks; private groups (create, edit, delete, roles, transfer ownership, remove members, leave); hashed, expiring, revocable, use-limited invite links that survive signup; group boards with automatic champions and record history; rivals on Home; activity feed with reactions; notifications (friend request/accepted, passed, first place, member joined) with unread badge, per-type settings, and read-time visibility checks; profiles (PRs, featured lifts, ranking highlights, activity, privacy levels); settings (units, default visibility, notifications, account deletion); server-side analytics events; PWA manifest, icons, offline banner that disables Submit.

## Incomplete or deferred within Phases 1–3

- **Avatar and group image upload.** Initials avatars only. Needs a Storage bucket and policies.
- **Email templates and SMTP.** Defaults work for development; custom SMTP is required before launch (SUPABASE_SETUP.md §4).
- **Gym step in onboarding.** Shown as a "coming soon" note (Phase 4).
- **Local dev seed (`seed.sql`).** Intentionally skipped for a hosted-only setup (PLAN.md).
- **Service worker.** None yet. The app installs from the manifest, and the offline banner is driven by `navigator.onLine`. No data is cached offline, by design.

## Known limitations

- `get_home` computes ranks per exercise × board in a loop. It's fine for MVP-size data; move to materialized per-board ranks once groups grow past a few hundred members or users log dozens of exercises.
- Exercise search runs client-side over the full catalog. Revisit past a few hundred exercises.
- The local E2E stand-in implements only what the app calls. If you add PostgREST features (embedded selects, `or=` filters), extend it or test against Supabase.
- Monthly boards use `public.app_timezone()` (America/Los_Angeles). Change it with a migration.
- Free Supabase projects pause after about a week of inactivity.
- Supabase security advisor warnings that predate Phase 5:
  - `app_timezone`, `compute_score` and `is_reserved_username` have no fixed `search_path`. They're immutable, not SECURITY DEFINER, so the risk is low; set it in a future migration.
  - Leaked-password protection is off. It's an Auth dashboard setting.
  - "Authenticated can execute SECURITY DEFINER" warnings are by design: the explicit RPC grant list.
- Proof video length is checked in the browser, and only the declared length is re-checked on the server; there's no server-side video processing. Supported playback depends on the reviewer's browser (iPhone HEVC `.mov` may not play in desktop Chrome); reviewers can choose "Not enough to tell".

## Required configuration

See `.env.example` and SUPABASE_SETUP.md: Supabase URL, publishable key, secret key (server only), site URL. Auth URL configuration. Confirm-email off for development and tests, on with SMTP for launch.

## Deployment status (Oct 15, 2026)

- **GitHub:** private repo `tristanpham03-jpg/liftrank`; `main` pushed. A secret scan of the full history before the push found nothing.
- **Vercel:** project `liftrank` (Hobby) at **https://liftrank-roan.vercel.app**. Production on Hobby is reachable by URL; Deployment Protection covers previews only. Env vars are set; `NEXT_PUBLIC_SITE_URL` was corrected to the real URL and the app redeployed.
- **Verified from outside, no sign-in:**
  - public pages load, and app pages redirect signed-out visitors to login;
  - `/api/cron/daily` and the card routes return 404 without auth;
  - security headers and HSTS are served;
  - no secrets are in the live JS;
  - the invite cookie is `Secure`, so the site URL is https.
- **Email:** custom SMTP through Gmail (app password) works.
- **Found and fixed (Oct 15):** `NEXT_PUBLIC_SUPABASE_URL` in Vercel was wrong, so the live site couldn't reach Supabase. Public pages hid it because they don't call Supabase, and the reset page shows the same message either way. The owner corrected it and redeployed; a reset email from the site then arrived.
- **Still open:** reset links land on `/?code=…` instead of `/auth/confirm`, meaning `https://liftrank-roan.vercel.app/**` isn't yet in Supabase → Authentication → URL Configuration → Redirect URLs, so Supabase falls back to the Site URL. Add it and retest.
- **Added:** server-side logging of auth failures (`logAuthError` in `src/app/(auth)/actions.ts`): reset-request errors always, and sign-up, sign-in or Google errors the app doesn't recognize. It logs step, status, code and message, never the email; the user-facing messages are unchanged. Look for these lines in Vercel → Logs.
- **Smoke test in progress:** `tptest` (second account) exists, with a pending gym "Equinox" and a proof video waiting for a friend to check it. Delete `tptest` from its Settings when done.
- **Pending (owner):**
  - turn on Confirm email;
  - Supabase URL Configuration (Site URL, plus redirect `https://liftrank-roan.vercel.app/**`), if not done;
  - make `tristanpham` a moderator;
  - run the cron once from Vercel;
  - smoke test with a second account.
- **Testing note:** `scripts/e2e-supabase.sh` signs up through the UI, so it needs Confirm email **off**. Switch it off briefly to run it, or use a separate test project.

## Friend verification and UI changes (Oct 15, 2026; owner's request during the smoke test)

- **Migration `…1200_friend_verification`** (dry-run, then applied):
  - **Who verifies:** any friend or groupmate who can see the lift (`_can_verify`: visibility and blocks apply, never the owner) can watch its proof video and confirm it with `verify_proof`. One confirmation → Verified. They must have opened the video first (`watch_first`).
  - **"Not enough to tell":** → Disputed, the lift still counts, the video is removed, and the owner may add a clearer one. The first decision settles it.
  - **No rejections:** nobody can mark a lift "Not accepted" any more. Moderators no longer review videos (`mod_review_proof`, `mod_proof_queue` and `appeal_proof` are no longer granted). They keep reports, gyms and machine models. The invalid-lift and appeal tables stay, unused, so history is kept.
  - **Notifications:** the owner hears who checked their lift; the person who asked for proof hears the outcome.
  - **Home:** `get_proofs_to_check` feeds a "Check a friend's lift" section that appears only when videos are waiting.
- **Lift page:**
  - New order: the lift card, then Share and the leaderboard link, then a titled "Proof video" section with "Verified by …" and the verify box (watch first, then "Looks legit: verify" or "Not enough to tell").
  - "Sharing and notes" became **"Who can see this lift"**, a separate panel where each option has a one-line description, an optional note with a hint, and "Save changes".
  - **Delete lift** is its own section at the bottom.
- **Navigation:** Friends is a tab in the desktop sidebar and in the phone bar (Home · Boards · + · Friends · Profile). It fits at 320 px (iPhone audit passes).
- **Tests:**
  - Live checks rewritten for the friend rules: 53/53.
  - Browser flows F and G now verify through a friend or groupmate: 9/9.
  - **E2E accounts:** created pre-confirmed with the secret key and signed in through the login page, so tests run with Confirm email on and send no emails. Set `E2E_UI_SIGNUP=1` (with Confirm email off) to exercise the signup form itself.
  - One earlier run, before that change, triggered about 9 confirmation emails to fake `@example.com` addresses. Expect a few harmless bounce notices in the Gmail inbox.

## Exercise illustrations: first five (Oct 15, 2026; awaiting the owner's review before expanding)

- **Migration `…1300_exercise_illustrations`** (applied): optional `exercises.illustration`, `primary_muscles` and `secondary_muscles`, filled for Barbell Bench Press, Lat Pulldown, Barbell Back Squat, Deadlift and Incline Smith Press. Catalog data only.
- **Art:** original SVGs generated by `scripts/exercise-art.py` (owned by the project; the owner's reference image was not used as an asset) into `public/exercises/<slug>.svg` (scene, ~2–3 KB) and `<slug>-thumb.svg` (square crop). Style: side view, silver figure, muted equipment, primary muscles in peach and secondary in lavender, transparent background. Muscles follow standard descriptions; highlights were checked against the anatomy (e.g. triceps toward the feet when pressing lying down, lats on the back).
- **UI:**
  - Thumbnails (lazy-loaded) in every exercise-picker row and on the picker button, with a dumbbell fallback.
  - On Add Lift, a collapsed "About this exercise" panel shows the large illustration (loaded only when opened) and the primary and secondary muscles.
  - Nothing added to Home, Profile or leaderboard rows.
- **To add more:** add a pose to `scripts/exercise-art.py` and run `python3 scripts/exercise-art.py`, then set the exercise's `illustration` and muscles in a new migration.
- **Tests:** typecheck, lint, unit 28/28, Playwright 9/9 against hosted Supabase.

## Launch checklist (private beta)

Done and verified:
- [x] Profile pictures with own-folder Storage writes, size and type caps, moderation removal, and deletion with the account
- [x] Reports (profile, lift, group) with categories, limits, and a moderation queue with content-removal actions
- [x] Rate limits: lifts (60/h), reports (10/day), proof requests (3/day), uploads (3/day), video views (20/day), picture changes (10/day), friend requests, invites
- [x] Privacy and access verified live: lift visibility, blocks, video grants, group-only titles, record history, reports
- [x] Account deletion removes the auth user, the profile, lifts, proof videos and pictures (Flow H)
- [x] iPhone layouts (WebKit, 320–430 px) for signup, onboarding, Add Lift, result, leaderboards, lift, profile, settings, notifications, friends, groups, home
- [x] Security headers (`nosniff`, `X-Frame-Options: DENY`, referrer policy, permissions policy)
- [x] Local git repository with secrets excluded; deploy guide (SUPABASE_SETUP.md §7); `vercel.json` daily cron

**For the owner** (needs your accounts; see SUPABASE_SETUP.md §7):
1. [x] Create a **private** GitHub repo and push.
2. [x] Import into Vercel and add the env vars (`NEXT_PUBLIC_SITE_URL` = https://liftrank-roan.vercel.app, `CRON_SECRET`). Production is reachable by URL on Hobby.
3. [~] Supabase Auth: custom **SMTP** done (Gmail). Still to do: **Confirm email on**, and confirm the Site URL and redirect URLs; optionally leaked-password protection.
4. [ ] Make yourself (and ideally a second person, for appeals) a moderator.
5. [ ] Smoke test on the deployed URL with a real email (SUPABASE_SETUP.md §7f).
6. [ ] Optional: a privacy note and terms page, and a support email, before inviting people outside your circle.

## Remaining issues and limitations (none block a private beta)

- **Verify the cron after the first deploy.** On Vercel, cron jobs only run in production; check **Cron Jobs** after deploying.
- **Free-tier limits.** Supabase Free pauses after about a week idle, and the Vercel Hobby plan is for non-commercial use. Upgrade both before monetizing.
- **No Content-Security-Policy.** It would need per-request nonces; the other headers are set.
- **Inline text-link tap targets.** Key links now have a 44 px hit area; a few small secondary text links remain (the iPhone audit lists them).
- **Database advisor warnings that predate this phase.** 3 immutable helpers without `search_path`, and "authenticated can execute" on the intended RPC list.
- **Offline DB suite not run on this Mac.** `npm run test:db` needs a local Postgres; live checks cover the same behavior against the real project.
- **Avatar format support.** HEIC photos work where the browser can decode them (Safari); elsewhere the iOS photo picker hands over JPEG.

## Ambient glass redesign (Oct 11, 2026)
- Neon lime removed. Midnight slate base, pearl as the only solid accent; lavender, peach, pink and ice only as low-opacity ambient light.
- Shared system: `AmbientBackground`, `GlassCard`/`GlassPanel` (src/components/ui/glass.tsx), `glass`, `glass-flat`, `pearl`, `pearl-text` utilities in globals.css.
- Frosted 4-tab navigation (Home, Leaderboards, Add Lift, Profile); Groups via Leaderboards, notifications via the bell.
- Home: three sections (Your rankings, Next target, Recent activity); full feed at /activity.
- Restyled: landing, sign-in/sign-up/password reset, onboarding, leaderboards, Add Lift + result, groups, invite page, profile (featured record card), notifications (New / Earlier), friends, history, settings.
- No database, auth, scoring or privacy changes. Rank-change arrows on boards were not added: the data has no previous-rank field, so it would need new data.
- Tests: unit 21, db 32, Playwright 5/5 (stand-in).

## UX refinement pass (Oct 11, 2026)
- Tab bar: measured at 320×568, 375×667 and 390×844 on 12 screens; every page's last content clears the floating bar by 30px or more. The overlap in earlier screenshots was a full-page-screenshot artifact.
- Groups: the group page leads with each board's current leader, then members and a one-tap "Invite friends" (7-day link). Invite limits, active links, member roles, edit, delete and leave moved to /groups/[id]/manage.
- PR sharing: /lifts/[id]/share-image renders a 1080×1920 card (owner only, read through RLS; anyone else gets 404, covered in flow D). "Share PR" is the primary action after a PR (Web Share with the image, or a download where files can't be shared). Also on your own lift pages.
- Profile: header (share + settings icons, friends count links to Friends), then Records (featured card + rows, "All lifts" link), Rankings, and 3 recent activities.
- Rival messages now name the smallest lift at your own rep count that outranks the person above, checked with the board's own score (ties go to whoever lifted first). Solo boards say "Just you so far" instead of "#1 of 1".
- Landing: three steps, quieter notes, and the example board plays one overtake when it scrolls into view (skipped with reduced motion).
- Tests: unit 21, db 32, Playwright 5/5.

## Phase 4: gyms and machines (Oct 11, 2026)
- Migration `20261011000700_gyms_and_machines.sql` (additive). **Applied to the hosted project and verified live on 2026-10-11** (see Status). Its one data change: open group champion records on machine exercises are closed (history kept), because machine exercises have no champion on the combined board.
- Gyms: user-submitted (name, address, city, region, country), usable by the submitter right away, hidden from search and boards until a moderator approves it with coordinates. Onboarding has a skippable gym step; Settings has the same picker. Self-reported only.
- Gym and nearby boards (5/10/25 mi from your primary gym's coordinates): opt-in only, Public lifts only, rows never show a gym, distance or coordinates. "Top X%" from 20 lifters, otherwise "#3 of 12". Gym boards have a record holder at 3+ lifters.
- Machines: seeded manufacturers only; models are user-submitted and moderated (shown on boards only once approved). Add Lift has an optional maker/model field for machine exercises, remembered per exercise. Boards show the machine on each row with a "machines differ" note and an exact-model filter. Champions on machine exercises only for an exact model.
- Moderation at /moderation for `profiles.is_moderator` (set manually in SQL). Coordinates are pasted by the moderator after checking the gym on OpenStreetMap; no automatic geocoding.
- Profiles show your gym (name and city) behind profile visibility; a pending gym only to you.
- Tests: unit 23, db 41, Playwright 6 (Flow E covers the whole gym and machine flow; it now runs against hosted Supabase too).

## Phase 5: proof videos and verification (Oct 11, 2026)
- Migration `20261011000800_verification.sql`. It's additive: no existing rows were changed. Before pushing, I dry-ran it against the live schema in a rolled-back transaction, then applied it with `supabase db push`.
- **Flow:** a friend taps "Request proof" on a lift (optional note), and the owner gets a notification. The owner can add a video from the lift page (progress bar, automatic retries, "Try again") or decline with an optional reply. A moderator then reviews it at `/moderation`, choosing Verify, Not enough to tell, or Reject; the decision buttons unlock only after the video is loaded. The owner and requester are notified. Uploading alone never verifies anything.
- **Badges:**
  - The lift page shows Unverified / Proof uploaded / Disputed / Verified.
  - Board rows show an icon for the last three only.
  - "Rejected" appears as "Disputed" to everyone except the owner, who also sees the reviewer's note.
  - Declining never changes the badge.
- **Verified only:** a single chip on Leaderboards (`verified=1`) that filters any board to moderator-verified lifts. Those boards have no champion.
- **Storage and cost (Supabase Free: 1 GB storage, 50 MB per file, 5 GB egress a month):**
  - Private bucket `lift-proofs`, MP4/MOV/WebM only.
  - Every limit lives in the one-row `public.proof_settings` table, editable in the SQL editor: 25 MB and 30 s per video, a 750 MB storage budget (uploads pause beyond it), a 3 GB monthly playback budget, 3 uploads a day, 20 views a day (moderators 300), and 3 proof requests a day. The bucket's size cap follows `max_bytes` automatically.
  - Video length is checked in the browser, and the declared length is checked again on the server.
- **Access control:**
  - Uploads go straight from the browser to Storage. A policy allows only the exact path of a slot reserved by `begin_proof_upload` within the last hour. Files are never overwritten.
  - Playback goes through `request_proof_view`: owner or moderator only, rate-limited, opening a 2-minute grant. Storage signs a 10-minute URL only while that grant is live. Friends never download videos.
  - A file in use can't be deleted.
  - User flows never use the secret key.
- **Cleanup:**
  - Rejected and insufficient videos, deleted lifts' videos, superseded uploads, and a deleting account's files are removed immediately through the Storage API (SQL can't delete files).
  - The daily `/api/cron/daily` (Vercel Cron, guarded by `CRON_SECRET`) and `npm run cleanup:proofs` sweep anything left behind, using `proof_orphans()` (service role only).
- **Not done:** reports, and playback for the requester (both intentionally left out of this version).

## Proof refinements + Phase 6: achievements, champions, cards (Oct 11–12, 2026)

**Migrations** (applied after rolled-back dry runs against the live schema):
- `…0900_proof_refinements`:
  - The person who asked for proof may watch the video (same 2-minute grant and limits).
  - Two outcomes now differ:
    - **insufficient evidence** → "Disputed"; the lift still competes;
    - **rejected (confirmed invalid)** → `lifts.invalidated_at` is set, and the lift is shown as "Not accepted".
  - A confirmed-invalid lift leaves every board, champion title, PR and feed item, and "passed" comparisons. It stays in its owner's history.
  - One appeal per lift, with a note and a new video. The appeal is hidden from, and refused to, the moderator who rejected it. Overturning it restores the lift and its titles.
- `…1000_achievements_and_champions`:
  - **Achievements:** awarded once each, server-side: First Lift, First PR, Top Three, Group Champion, Gym Champion, Rival Overtaken, Verified Lifter, Five Records, and Monthly Champion. Each sends a notification, except First Lift.
  - **Gym record holders:** kept in `record_history` with history. The dethroned holder is notified.
  - **Monthly champions:** `close_monthly_records()` freezes a month once its 3-day late window closes (needs ≥3 lifters) and notifies the winner.
  - **New read functions:** `get_record_history`, `get_champion_card`, and `get_profile` with titles and achievements.
  - **Backfill:** existing data was backfilled without notifications. Your account got First Lift.

**App:**
- **Lift page:** the "Not accepted" badge and explainer. An Appeal button and form appear when eligible, with the appeal status, then the uploader for the new video.
- **Moderation:** the queue shows the appeal note. The challenger gets "Watch video" (the existing tap-to-load player).
- **Result screen:** new gym records and new achievements, as quiet chips; First Lift is skipped because it's already celebrated.
- **Profile:** "Titles" (only when held; group titles only to fellow members; a share icon on your own) and an "Achievements" chip row (earned only, no locked badges, no XP or levels).
- **Leaderboards:** a "Record history" text link under group and gym boards, a share icon in the champion banner when it's you, and one share icon in the "your rank" card. No verification controls on boards.
- **Record history page:** `/leaderboards/records` shows the current holder, past holders, and monthly champions. A lift's numbers appear only while the viewer can still see that lift; reigns of confirmed-invalid lifts are hidden.
- **Cards** (shared shell in `src/lib/cards.tsx`, the existing ambient-glass look, rendered only on tap, never cached):
  - PR card (`/lifts/[id]/share-image`): adds the public profile link (`<site>/u/<username>`), a "Verified" pill, and the title the lift holds.
  - Champion card (`/cards/champion?board=`): only for the current holder.
  - Leaderboard card (`/cards/leaderboard?…same params as /leaderboards`): your view of the top 5 plus you. Other people's non-public lifts are drawn anonymously ("Lifter —").
  - `ShareImageButton` replaces the old preloading PR button. If Safari needs a fresh tap after the image renders, the button says "Tap again to share".
- **Cron:** `/api/cron/daily` (`vercel.json`) runs `close_monthly_records`, then the proof-video sweep. It replaced `/api/cron/proof-cleanup`. Running it against production already marked July–September 2026 closed (no champions; nothing was logged then).

**New live checks:**
- requester can watch, a non-requester can't;
- insufficient lifts still compete, invalid lifts leave boards and PRs but stay in history;
- the full appeal cycle, including "different moderator" and "once only";
- achievements earned once and announced, with no client writes;
- group titles hidden from non-members, champion card holder-only;
- record history members-only;
- gym record taken by a new lift, with the result payload and the dethroned holder notified;
- monthly close is service-role only and idempotent.

**Notes:**
- Cards show the host from `NEXT_PUBLIC_SITE_URL`. Set it to the production domain before launch, otherwise cards say `localhost`.
- Leaderboard card privacy rule: anything not public is anonymized, even when the viewer can see it, because an image can travel further than the lift's audience.

## Phase 7: launch readiness (Oct 13, 2026)
- **Migration `…1100_avatars_reports`** (dry-run first, additive):
  - Public-read `avatars` bucket: own-folder writes, images only, 512 KB cap, at most 3 files per person.
  - `set_avatar` checks the file is yours and limits changes (10/day); `avatar_orphans` feeds the daily sweep.
  - `submit_report` checks the target is visible to you, allows one open report per target and 10 a day. Direct inserts are revoked.
  - Moderation: `mod_reports` and `mod_resolve_reports` (remove picture, clear name and bio, clear lift note, clear group description, or dismiss).
  - A trigger caps lift submissions at 60 per hour.
- **App:**
  - Profile picture in Settings: cropped to 256 px WebP in the browser, which also strips location and camera metadata.
  - `Avatar` shows pictures everywhere names appear.
  - Quiet "Report" links on others' profiles and lifts, and on groups for non-owners.
  - A "Reports" section in `/moderation`.
  - Account deletion also removes pictures; the daily cron also sweeps orphaned pictures.
- **iPhone audit** (`tests/e2e/ios-audit.spec.ts`, WebKit) fixes:
  - landing header overflow at 320 px (the button says "Join" below 360 px);
  - 44 px hit areas for small inline links (`.tap` utility);
  - the Settings picture row on narrow screens;
  - the rank card's padding when there's no share icon.
- **Security headers** in `next.config.ts`. Test port moved to 3210.
- **Test-data incident:** a live-check run filed a test report against the owner's real public lift. Found in the leftover check and deleted, along with 21 other test reports. The live check now reports only its own test users' lifts and deletes its reports, and the cleanup script removes test reports.
- **Git:** initialized on `main`; `.gitignore` covers `.env*` (except `.env.example`), builds, test output, logs and `supabase/.temp`.
- **README:** added the live link, beta status and a feature summary at the top, ahead of making the repository public.
- **Repo cleanup:** removed the agent instruction files and the original build brief from the repository; they are now ignored by git.
