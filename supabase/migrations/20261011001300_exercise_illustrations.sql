-- LiftRank 0013 — Exercise illustrations and muscles.
--
-- Optional per exercise: an illustration (public/exercises/<illustration>.svg,
-- plus a square <illustration>-thumb.svg) and the primary and secondary
-- muscles worked. Exercises without them show a plain icon. Catalog data
-- only; no user data changes.

alter table public.exercises
  add column illustration text check (illustration is null or illustration ~ '^[a-z0-9-]+$'),
  add column primary_muscles text[] not null default '{}',
  add column secondary_muscles text[] not null default '{}';

-- First five, illustrated as original artwork (scripts/exercise-art.py).
-- Muscles follow standard exercise-science descriptions of each lift.
update public.exercises set
  illustration = 'barbell-bench-press',
  primary_muscles = array['Chest (pectoralis major)'],
  secondary_muscles = array['Front shoulders (anterior deltoids)', 'Triceps']
where slug = 'barbell-bench-press';

update public.exercises set
  illustration = 'lat-pulldown',
  primary_muscles = array['Lats (latissimus dorsi)'],
  secondary_muscles = array['Upper back (rhomboids, middle traps)', 'Biceps', 'Rear shoulders (posterior deltoids)']
where slug = 'lat-pulldown';

update public.exercises set
  illustration = 'barbell-back-squat',
  primary_muscles = array['Quadriceps', 'Glutes'],
  secondary_muscles = array['Inner thighs (adductors)', 'Hamstrings', 'Lower back (spinal erectors)']
where slug = 'barbell-back-squat';

update public.exercises set
  illustration = 'deadlift',
  primary_muscles = array['Glutes', 'Hamstrings', 'Lower back (spinal erectors)'],
  secondary_muscles = array['Quadriceps', 'Upper back and traps', 'Forearms (grip)']
where slug = 'deadlift';

update public.exercises set
  illustration = 'incline-smith-press',
  primary_muscles = array['Upper chest (clavicular pectoralis major)'],
  secondary_muscles = array['Front shoulders (anterior deltoids)', 'Triceps']
where slug = 'incline-smith-press';
