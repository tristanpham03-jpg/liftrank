# Missing exercise illustrations

Generated 2026-11-17 from the hosted database (68 exercises), migration 0019 (15 exercises, not yet applied), the files in `public/exercises/img/` and the approval list in `src/lib/exercise-images.ts`. Machine-readable copy: [`missing-exercise-images.json`](missing-exercise-images.json).

**Catalog after 0019: 83 exercises · illustrated: 63 · missing: 20.** Until an image is approved the app shows its icon fallback; nothing breaks.

## Visual standard

Match the existing set: a translucent blue wireframe / point-cloud figure performing the movement at its most recognisable position, **primary muscles in red, secondary muscles in orange**, dark transparent background, no text or logos. Export through `scripts/optimize-exercise-images.py` to `<slug>.webp` (800 px) and `<slug>-thumb.webp` (112 px), then add the slug to `EXERCISE_IMAGES` once approved.

## Exercises

| # | Exercise | Slug | Primary (red) | Secondary (orange) | Equipment | Image | Approved | Catalog |
|---|---|---|---|---|---|---|---|---|
| 1 | Keenan Flaps | `keenan-flaps` | Lats (latissimus dorsi) | Teres major, Rear shoulders (posterior deltoids) | cable | missing | no | live |
| 2 | Recline Curl | `recline-curl` | Biceps | Forearms (brachialis, brachioradialis) | dumbbell | missing | no | live |
| 3 | Kelso Shrug | `kelso-shrug` | Middle traps, Rhomboids | Rear shoulders (posterior deltoids) | dumbbell | missing | no | live |
| 4 | Bicep Supination | `bicep-supination` | Biceps (supination), Supinator | Forearms (brachioradialis) | dumbbell | missing | no | live |
| 5 | Face Pull | `face-pull` | Rear shoulders (posterior deltoids), Upper back (rhomboids, middle traps) | Rotator cuff (external rotators), Traps | cable | missing | no | live |
| 6 | Reverse Cable Curl | `reverse-cable-curl` | Forearms (brachioradialis), Brachialis | Biceps | cable | missing | no | pending 0019 |
| 7 | Machine Lateral Raise | `machine-lateral-raise` | Side shoulders (lateral deltoids) | Traps | selectorized | missing | no | pending 0019 |
| 8 | Dumbbell Front Raise | `dumbbell-front-raise` | Front shoulders (anterior deltoids) | Side shoulders (lateral deltoids), Upper chest | dumbbell | missing | no | pending 0019 |
| 9 | Behind-the-Back Cable Lateral Raise | `behind-the-back-cable-lateral-raise` | Side shoulders (lateral deltoids) | Rear shoulders (posterior deltoids), Traps | cable | missing | no | pending 0019 |
| 10 | Smith Machine Decline Press | `smith-decline-press` | Chest (lower pectoralis major) | Triceps, Front shoulders (anterior deltoids) | smith machine | missing | no | pending 0019 |
| 11 | Low-to-High Cable Fly | `low-to-high-cable-fly` | Upper chest (clavicular pectoralis) | Front shoulders (anterior deltoids) | cable | missing | no | pending 0019 |
| 12 | High-to-Low Cable Fly | `high-to-low-cable-fly` | Chest (lower pectoralis major) | Front shoulders (anterior deltoids) | cable | missing | no | pending 0019 |
| 13 | Chest-Supported Wide-Grip Row | `chest-supported-wide-grip-row` | Upper back (rhomboids, middle traps), Rear shoulders (posterior deltoids) | Lats (latissimus dorsi), Biceps | plate loaded | missing | no | pending 0019 |
| 14 | Chest-Supported Close-Grip Row | `chest-supported-close-grip-row` | Lats (latissimus dorsi), Upper back (rhomboids, middle traps) | Biceps, Rear shoulders (posterior deltoids) | plate loaded | missing | no | pending 0019 |
| 15 | Close-Grip Lat Row | `close-grip-lat-row` | Lats (latissimus dorsi) | Upper back (rhomboids, middle traps), Biceps | cable | missing | no | pending 0019 |
| 16 | Back Extension | `back-extension` | Lower back (spinal erectors), Glutes | Hamstrings | bodyweight | missing | no | pending 0019 |
| 17 | Smith Machine Romanian Deadlift | `smith-romanian-deadlift` | Hamstrings, Glutes | Lower back (spinal erectors), Forearms (grip) | smith machine | missing | no | pending 0019 |
| 18 | Smith Machine Shoulder Press | `smith-shoulder-press` | Front shoulders (anterior deltoids), Side shoulders (lateral deltoids) | Triceps | smith machine | missing | no | pending 0019 |
| 19 | Smith Machine Hip Thrust | `smith-hip-thrust` | Glutes | Hamstrings, Quads | smith machine | missing | no | pending 0019 |
| 20 | Smith Machine Split Squat | `smith-split-squat` | Quads, Glutes | Hamstrings, Inner thighs (adductors) | smith machine | missing | no | pending 0019 |

## What each image should show

- **Keenan Flaps** (`keenan-flaps.webp`, `keenan-flaps-thumb.webp`): Single-arm cuffed cable pulldown pulling the elbow down and back to the hip, kneeling or seated, isolating the lats.
- **Recline Curl** (`recline-curl.webp`, `recline-curl-thumb.webp`): Standing beside an incline bench with the upper arm braced against the back pad, curling a dumbbell one arm at a time.
- **Kelso Shrug** (`kelso-shrug.webp`, `kelso-shrug-thumb.webp`): Chest-supported shrug on an incline bench, squeezing the shoulder blades together (retraction) rather than up.
- **Bicep Supination** (`bicep-supination.webp`, `bicep-supination-thumb.webp`): Light dumbbell held at the elbow-bent position, rotating the forearm palm-down to palm-up to train supination.
- **Face Pull** (`face-pull.webp`, `face-pull-thumb.webp`): Rope cable pull to face height with elbows high and outward rotation at the end.
- **Reverse Cable Curl** (`reverse-cable-curl.webp`, `reverse-cable-curl-thumb.webp`): Overhand (pronated) grip curl on a low cable with a straight bar, emphasising brachioradialis and brachialis.
- **Machine Lateral Raise** (`machine-lateral-raise.webp`, `machine-lateral-raise-thumb.webp`): Seated lateral raise machine with pads on the outer arms, raising the elbows out to shoulder height.
- **Dumbbell Front Raise** (`dumbbell-front-raise.webp`, `dumbbell-front-raise-thumb.webp`): Standing, raising dumbbells straight in front to shoulder height with a near-straight arm.
- **Behind-the-Back Cable Lateral Raise** (`behind-the-back-cable-lateral-raise.webp`, `behind-the-back-cable-lateral-raise-thumb.webp`): One-arm lateral raise from a low cable running behind the body, starting the arm across the back.
- **Smith Machine Decline Press** (`smith-decline-press.webp`, `smith-decline-press-thumb.webp`): Smith machine press on a decline bench, bar lowered to the lower chest.
- **Low-to-High Cable Fly** (`low-to-high-cable-fly.webp`, `low-to-high-cable-fly-thumb.webp`): Cables set low, hands sweep up and together to upper-chest height (upper-chest fly).
- **High-to-Low Cable Fly** (`high-to-low-cable-fly.webp`, `high-to-low-cable-fly-thumb.webp`): Cables set high, hands sweep down and together in front of the hips (lower-chest fly).
- **Chest-Supported Wide-Grip Row** (`chest-supported-wide-grip-row.webp`, `chest-supported-wide-grip-row-thumb.webp`): Chest on the pad of a supported row, wide overhand grip, elbows flared to pull toward the upper back.
- **Chest-Supported Close-Grip Row** (`chest-supported-close-grip-row.webp`, `chest-supported-close-grip-row-thumb.webp`): Chest on the pad of a supported row, close or neutral grip, elbows tucked toward the hips.
- **Close-Grip Lat Row** (`close-grip-lat-row.webp`, `close-grip-lat-row-thumb.webp`): Seated cable row with a close grip, elbows tucked, pulling toward the hips to bias the lats. (Mechanics flagged for confirmation.)
- **Back Extension** (`back-extension.webp`, `back-extension-thumb.webp`): 45-degree or horizontal back extension bench, hinging at the hips and extending back to a straight line.
- **Smith Machine Romanian Deadlift** (`smith-romanian-deadlift.webp`, `smith-romanian-deadlift-thumb.webp`): Romanian deadlift in the Smith machine: soft knees, hips push back, bar travels along the thighs.
- **Smith Machine Shoulder Press** (`smith-shoulder-press.webp`, `smith-shoulder-press-thumb.webp`): Seated Smith machine press from upper chest to overhead.
- **Smith Machine Hip Thrust** (`smith-hip-thrust.webp`, `smith-hip-thrust-thumb.webp`): Upper back on a bench, Smith bar across the hips, driving the hips up to full extension.
- **Smith Machine Split Squat** (`smith-split-squat.webp`, `smith-split-squat-thumb.webp`): Split stance under a Smith bar, front leg working, back knee lowering toward the floor.
