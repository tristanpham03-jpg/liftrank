-- LiftRank 0016 — 13 more exercises (50 → 63).
--
-- Adds abs/core work, Stiff-Leg Deadlift, Smith Machine JM Press, Close-Grip
-- Lat Pulldown, Incline Dumbbell Curl, Machine Preacher Curl, hip abduction,
-- hip adduction and Cable Wrist Curl, each a separate exercise with its own
-- boards. Scoring reuses existing conventions only:
--   • hanging leg / knee raise: bodyweight, ranked by reps (like Pull-Up)
--   • weighted decline sit-up: the held weight only, est. 1RM on that added
--     load (like Weighted Pull-Up); bodyweight is never added in
--   • cable / machine exercises: the stack number, est. 1RM (like Cable Curl);
--     machine model selectable, mixed-machine boards stay labelled informal
-- Also moves the aliases "sldl" and "stiff leg deadlift" from Romanian Deadlift
-- to the new Stiff-Leg Deadlift so the two aren't merged in search.
--
-- No existing exercise row, lift, score or ranking changes. No function or
-- permission changes. Illustrations: none yet (the app shows its icon fallback).

insert into public.exercises
  (name, slug, category, muscle_group, equipment_type, ranking_method, weight_convention,
   supports_machine_selection, max_weight_kg, flag_threshold_kg, popular_rank, primary_muscles, secondary_muscles)
values
  ('Cable Crunch', 'cable-crunch', 'core', 'Abs', 'cable', 'e1rm', 'stack', true, 200, 110, 51,
    array['Abs (rectus abdominis)'], array['Obliques']),
  ('Machine Ab Crunch', 'machine-ab-crunch', 'core', 'Abs', 'selectorized', 'e1rm', 'stack', true, 250, 130, 52,
    array['Abs (rectus abdominis)'], array['Obliques']),
  ('Hanging Leg Raise', 'hanging-leg-raise', 'core', 'Abs', 'bodyweight', 'max_reps', 'bodyweight', false, null, null, 53,
    array['Abs (rectus abdominis)', 'Hip flexors'], array['Obliques', 'Forearms (grip)']),
  ('Hanging Knee Raise', 'hanging-knee-raise', 'core', 'Abs', 'bodyweight', 'max_reps', 'bodyweight', false, null, null, 54,
    array['Abs (rectus abdominis)', 'Hip flexors'], array['Obliques', 'Forearms (grip)']),
  ('Weighted Decline Sit-Up', 'weighted-decline-sit-up', 'core', 'Abs', 'bodyweight', 'added_load_e1rm', 'added', false, 100, 50, 55,
    array['Abs (rectus abdominis)', 'Hip flexors'], array['Obliques']),
  ('Stiff-Leg Deadlift', 'stiff-leg-deadlift', 'legs', 'Hamstrings', 'barbell', 'e1rm', 'total', false, 500, 270, 56,
    array['Hamstrings', 'Glutes'], array['Lower back (spinal erectors)', 'Forearms (grip)']),
  ('Smith Machine JM Press', 'jm-smith-press', 'arms', 'Triceps', 'smith_machine', 'e1rm', 'total', true, 250, 130, 57,
    array['Triceps'], array['Chest (pectoralis major)', 'Front shoulders (anterior deltoids)']),
  ('Close-Grip Lat Pulldown', 'close-grip-lat-pulldown', 'back', 'Lats', 'cable', 'e1rm', 'stack', true, 300, 170, 58,
    array['Lats (latissimus dorsi)', 'Biceps'], array['Upper back (rhomboids, middle traps)', 'Rear shoulders (posterior deltoids)']),
  ('Incline Dumbbell Curl', 'incline-dumbbell-curl', 'arms', 'Biceps', 'dumbbell', 'e1rm', 'per_dumbbell', false, 60, 35, 59,
    array['Biceps'], array['Forearms']),
  ('Machine Preacher Curl', 'machine-preacher-curl', 'arms', 'Biceps', 'selectorized', 'e1rm', 'stack', true, 200, 100, 60,
    array['Biceps'], array['Forearms']),
  ('Hip Abduction', 'hip-abduction', 'legs', 'Outer hips (abductors)', 'selectorized', 'e1rm', 'stack', true, 400, 200, 61,
    array['Hip abductors (gluteus medius)'], array['Glutes']),
  ('Hip Adduction', 'hip-adduction', 'legs', 'Inner thighs (adductors)', 'selectorized', 'e1rm', 'stack', true, 400, 200, 62,
    array['Inner thighs (adductors)'], array[]::text[]),
  ('Cable Wrist Curl', 'cable-wrist-curl', 'arms', 'Forearms', 'cable', 'e1rm', 'stack', true, 150, 70, 63,
    array['Forearms (wrist flexors)'], array[]::text[]);

-- Stiff-Leg Deadlift is its own exercise now.
delete from public.exercise_aliases
where alias in ('sldl', 'stiff leg deadlift')
  and exercise_id = (select id from public.exercises where slug = 'romanian-deadlift');

insert into public.exercise_aliases (exercise_id, alias)
select e.id, a.alias
from (values
  ('cable-crunch', 'cable crunches'), ('cable-crunch', 'kneeling cable crunch'), ('cable-crunch', 'rope crunch'),
  ('machine-ab-crunch', 'ab machine'), ('machine-ab-crunch', 'ab crunch machine'), ('machine-ab-crunch', 'crunch machine'),
  ('hanging-leg-raise', 'leg raise'), ('hanging-leg-raise', 'hanging leg raises'), ('hanging-leg-raise', 'hlr'),
  ('hanging-knee-raise', 'knee raise'), ('hanging-knee-raise', 'hanging knee raises'), ('hanging-knee-raise', 'knee raises'),
  ('weighted-decline-sit-up', 'decline sit up'), ('weighted-decline-sit-up', 'weighted sit up'), ('weighted-decline-sit-up', 'sit up'),
  ('weighted-decline-sit-up', 'situp'), ('weighted-decline-sit-up', 'decline situp'),
  ('stiff-leg-deadlift', 'sldl'), ('stiff-leg-deadlift', 'stiff leg deadlift'), ('stiff-leg-deadlift', 'stiff legged deadlift'),
  ('stiff-leg-deadlift', 'stiff leg dl'),
  ('jm-smith-press', 'jm press'), ('jm-smith-press', 'smith jm press'), ('jm-smith-press', 'jm smith press'),
  ('close-grip-lat-pulldown', 'close grip pulldown'), ('close-grip-lat-pulldown', 'cg pulldown'),
  ('close-grip-lat-pulldown', 'v bar pulldown'), ('close-grip-lat-pulldown', 'neutral grip pulldown'),
  ('incline-dumbbell-curl', 'incline curl'), ('incline-dumbbell-curl', 'incline db curl'),
  ('machine-preacher-curl', 'preacher machine'), ('machine-preacher-curl', 'machine curl'),
  ('hip-abduction', 'abductor'), ('hip-abduction', 'abductors'), ('hip-abduction', 'abductor machine'),
  ('hip-abduction', 'hip abductor'), ('hip-abduction', 'outer thigh'),
  ('hip-adduction', 'adductor'), ('hip-adduction', 'adductors'), ('hip-adduction', 'adductor machine'),
  ('hip-adduction', 'hip adductor'), ('hip-adduction', 'inner thigh'),
  ('cable-wrist-curl', 'wrist curl'), ('cable-wrist-curl', 'wrist curls'), ('cable-wrist-curl', 'forearm curl')
) as a(slug, alias)
join public.exercises e on e.slug = a.slug;
