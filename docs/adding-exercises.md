# Adding exercises

SBLift's catalog grows with the SBL community. Adding an exercise is a small, repeatable change; no admin dashboard is needed.

## 1. Check it's new
Search the catalog and aliases first (`supabase/migrations/*catalog*`, `*more_exercises*`, `*training_sessions*`, or the app's exercise search). If it's a variation of an existing movement, prefer an alias.

## 2. Migration (catalog rows + aliases)
Add a new migration file (never edit a pushed one) that:
- `insert into public.exercises (name, slug, category, muscle_group, equipment_type, ranking_method, weight_convention, supports_machine_selection, max_weight_kg, flag_threshold_kg, popular_rank, primary_muscles, secondary_muscles) values (…)` using the same tuple format as `20261011001600_more_exercises.sql` (the unit tests parse it).
  - `ranking_method`: `e1rm` (weight × reps), `added_load_e1rm` (weighted bodyweight; held/added load only), `max_reps` (bodyweight reps), or `none` (training-only when an estimated 1RM wouldn't be fair, e.g. Bicep Supination).
  - `weight_convention`: `total`, `per_dumbbell`, `stack`, `plates_total`, `added`, `bodyweight`.
  - `popular_rank`: next number after the current highest.
- `update public.exercises set supports_unilateral = true where slug in (…)` if it's genuinely done one side at a time.
- `insert into public.exercise_aliases` for common names and abbreviations (lowercase, 2–40 chars). Don't reuse an alias that belongs to another exercise; move it explicitly if needed.
- Test it in a rolled-back transaction (see `tests/sql/*.test.sql`), then apply with approval.

## 3. Search tags
Add the slug to `EXERCISE_MUSCLES` in `src/lib/exercise-muscles.ts` (primary/secondary muscles). Add any new words people type to `MUSCLE_WORDS`. The unit tests fail if a catalog slug has no tags.

## 4. Illustration
Until approved art exists, nothing to do: the app shows the fallback icon. When it's approved, run `python3 -I scripts/optimize-exercise-images.py <folder>` (file names = slugs), copy only the new `<slug>.webp` / `<slug>-thumb.webp` pairs into `public/exercises/img/`, keep `src/lib/exercise-images.ts` listing every illustrated slug, and remove the slug from the `pending` list in `src/lib/lib.test.ts`.

## 5. Tests
Update the expected catalog count in `src/lib/lib.test.ts`, run `npm test`, and add a search case for the new name/alias.
