# Training quality review: proposals for the owner (2026-11-22)

Nothing in this document is live. It proposes replacements for the default templates (Part 2),
corrections to exercise metadata and Similar Exercises (Part 6), and an import design (Part 7).
Each needs the owner's review before it changes the app.

---

## Part 2: default templates

### What exists today (`src/lib/training.ts`)
| Template | Days | Exercises per day | Notes |
|---|---|---|---|
| Upper / Lower | 2 (rotated) | Upper 7, Lower 5 | No rear delts, no overhead triceps, no adductors |
| Push / Pull / Legs | 3 | 5 / 6 / 6 | Push has no fly; Legs and Lower reuse the same list |
| Anterior / Posterior | 2 | 6 / 6 | Biceps on Posterior (conventionally Anterior); no calves |
| Arnold | 3 | 5 / 6 / 6 | |
| Full Body | 1 | 5 | No calves, arms, or rear delts |
| Full Body Every Other Day | 1 | 5 | Same day as Full Body; only the rotation text differs ("→ rest → repeat") |

Every exercise gets 3 sets if it's first in the day, else 2 (`defaultSetCount`).

### Research reference: @trstnn.lifts
- The only verifiable source found is a Boostcamp community listing, "S Tier Upper / Lower Split". It says "Program outline by trstnn.lifts on tiktok", was uploaded by "Roshen T." (Nov 2025), and shows Week 1 of 18. It is a third-party transcription, not stated to be the creator's own document.
- The creator's TikTok videos could not be retrieved or verified: TikTok content isn't indexed by search, and the listing doesn't link to the account. **Nothing below is presented as this creator's programming.**
- What the listing shows:
  - **Structure:** 4 days, Upper/Lower ×2, with frequency suggested as patterns like U/L/R/U/L/R/R.
  - **Volume:** 1–3 working sets per exercise at 4–8 reps; 9–10 exercises per day.
  - **Exercise choice:** machine- and cable-heavy (Smith incline, pec deck, machine lateral raise, machine shoulder press, seated dip, single-arm cable extension, chest-supported row, wide-grip pulldown, high row, preacher curl); legs with leg extension, leg press, lying curl, RDL, adductor, abductor, leg-press calf raise, ab crunch, wrist curls.
  - **Order:** the order of the second upper day is rearranged to prioritise shoulders.
- Inspiration taken (general, not copied): low sets per exercise with more exercises; stable machines; adductors and calves included; two different orders across the week so a different muscle gets the fresh slot.

### Principles for the proposals
- **Not "optimal", and adjustable:** these are reasonable, editable starting points. Every set count and exercise can be changed, and alternatives are offered as swaps in the same slot (the routine already supports alternative slots).
- **Volume by frequency:** with each muscle trained about twice a week, roughly 4–8 hard sets per muscle per session lands in the commonly used 8–16 weekly range for trained lifters. That's a broad, contested range, not a target the app enforces.
- **Order:** compound or most-demanding lifts first, then isolation; the muscle you want to prioritise early.
- **Sets:** default 2 working sets (3 on the first lift), matching the current `defaultSetCount` and the low-volume, high-effort style above.
- **Scope:** no weights are suggested. SBLift never invents numbers.

### Proposed templates (exercise slugs exist in the catalog unless marked *new*)
Alternatives in brackets go in the same slot (choose one per session).

**Upper / Lower** (2 days; 2× or rotate)
- Upper: Incline Smith Press 3 [Incline DB Press] · Chest-Supported Row 2 [Machine Row] · Machine Shoulder Press 2 [DB Shoulder Press] · Lat Pulldown (wide) 2 [Pull-Up] · Pec Deck 2 [Cable Fly] · Cable Lateral Raise 2 [Machine Lateral Raise] · Rear-Delt Fly 1 · Overhead Triceps Extension 2 · Preacher Curl 2
- Lower: Seated Leg Curl 3 [Lying Leg Curl] · Hack Squat 2 [Leg Press / Back Squat] · Romanian Deadlift 2 [Smith RDL] · Leg Extension 2 · Hip Adduction 1 (*new*) · Standing Calf Raise 3 · Cable Crunch 2

**Push / Pull / Legs** (3 days; 1× or 2×)
- Push: Incline Smith Press 3 · Machine Chest Press 2 [DB Bench] · Pec Deck 1 · Machine Shoulder Press 2 · Cable Lateral Raise 3 · Overhead Triceps Extension 2 · Triceps Pushdown 1
- Pull: Lat Pulldown (wide) 3 [Pull-Up] · Chest-Supported Row 2 · Close-Grip Lat Row 2 [Close-Grip Pulldown] · Rear-Delt Fly 2 [Face Pull] · Preacher Curl 2 · Hammer Curl 1
- Legs: Seated Leg Curl 3 · Hack Squat 2 [Back Squat / Leg Press] · Romanian Deadlift 2 · Leg Extension 2 · Hip Adduction 1 (*new*) · Standing Calf Raise 3

**Anterior / Posterior** (2 days; 2× or rotate)
- Placement note: conventionally, chest, front and side delts, quads, biceps and abs go on Anterior; back, rear delts, hamstrings, glutes, triceps and calves on Posterior. Splits differ (some put side delts or triceps on the other day), so the template follows the common convention and says so.
- Anterior: Incline Smith Press 3 · Machine Chest Press 2 · Machine Shoulder Press 2 · Cable Lateral Raise 2 · Hack Squat 2 [Leg Press] · Leg Extension 2 · Preacher Curl 2 · Cable Crunch 2
- Posterior: Lat Pulldown (wide) 3 · Chest-Supported Row 2 · Rear-Delt Fly 2 · Overhead Triceps Extension 2 · Romanian Deadlift 2 · Seated Leg Curl 2 · Standing Calf Raise 3

**Full Body** (merged; 2 alternating days A/B)
- Frequency: 2× or 3× a week, or every other day. The app has no fixed weekdays, so "every other day" is guidance shown with the rotation, not a different routine.
- A: Hack Squat 2 [Back Squat] · Incline Smith Press 2 · Chest-Supported Row 2 · Romanian Deadlift 2 · Cable Lateral Raise 2 · Overhead Triceps Extension 1 · Preacher Curl 1
- B: Leg Press 2 · Seated Leg Curl 2 · Machine Chest Press 2 · Lat Pulldown 2 · Machine Shoulder Press 1 · Rear-Delt Fly 1 · Standing Calf Raise 2
- **Merge mechanics:**
  - Full Body Every Other Day leaves the chooser. Existing users' FBEOD splits keep working unchanged (the `fbeod` template id stays valid), and nobody's saved split is renamed or removed.
  - No database migration is needed for the merge itself.

**Arnold** (3 days): Chest/Back (Incline Smith 3 · Lat Pulldown 2 · Machine Chest Press 2 · Chest-Supported Row 2 · Pec Deck 1 · Close-Grip Lat Row 1) · Shoulders/Arms (Machine Shoulder Press 2 · Cable Lateral Raise 3 · Rear-Delt Fly 2 · Overhead Triceps Extension 2 · Preacher Curl 2 · Pushdown 1 · Hammer Curl 1) · Legs (as PPL Legs).

### Applying them (after approval)
- Only the template data changes, plus per-slot set counts and alternatives (both already supported).
- Existing saved splits are never modified; the new defaults apply to new imports only.
- Adding hip adduction or a seated calf raise needs catalog rows (a migration). It's listed under Part 6.

---

## Part 6: exercise function and similarity audit

### Inventory
- **Muscle tags:** `src/lib/exercise-muscles.ts` holds the primary and secondary muscles for every catalog exercise. They're used for search, the My Exercises groups, and Training Buddy's split observations.
- **Relationships:** `src/lib/exercise-relations.ts` holds 65 curated pairs (close or related), each with a short public reason. Seven reasons are reused generic phrases ("Same movement, different grip/equipment/angle", "Same muscle emphasis, different movement pattern").

### Evidence levels used below
- **A (established anatomy or biomechanics):** what a joint action is, which muscles cross which joints, and the plane of motion.
- **B (training studies, small or few):** hypertrophy comparisons from one or two longitudinal studies.
- **C (acute or EMG data only):** activation differences that may or may not mean different growth.

Public text should state A plainly, word B as "studies suggest", and keep C out of user-facing claims.

### Findings

| # | Current | Problem | Evidence | Proposed |
|---|---|---|---|---|
| 1 | Lat Pulldown ↔ Close-Grip Lat Pulldown: close, "Same movement, different grip" | Wide grip moves the arm mostly out to the side (shoulder **adduction**, frontal plane); a close/neutral grip moves it in front of the body (shoulder **extension**, sagittal plane). The lats do both; the path and the upper-back contribution differ. | A | Keep **close** (same vertical pull, same main target) and rewrite: "Vertical pull; the close grip pulls the arms down in front (extension) rather than out to the side (adduction)." |
| 2 | Pull-Up ↔ Chin-Up: close, "different grip" | Supinated, shoulder-width chin-ups are more sagittal and load the biceps more | A | Close; "Vertical pull; the underhand chin-up brings the elbows down in front and uses more biceps." |
| 3 | Chest-Supported Row ↔ Wide-Grip variant: close, "different grip" | Flared elbows (horizontal abduction) shift emphasis toward the upper back and rear delts; tucked elbows (extension) toward the lats | A | **Related**: "Row with elbows flared out: more upper back and rear delts, less lats." |
| 4 | Chest-Supported Row ↔ Close-Grip variant: close, "different grip" | Tucked elbows = shoulder extension, lat-biased | A | Close; "Same row with elbows tucked: more lats." |
| 5 | Incline Smith Press ↔ Smith Bench Press: close, "different angle" | Incline adds shoulder flexion, shifting work toward the clavicular (upper) pec and front delts | A (mechanics); C for the activation shift; long-term growth evidence thin | **Related**: "Incline press: more shoulder flexion, aimed at the upper chest and front delts." |
| 6 | Triceps Pushdown ↔ Cable Triceps Extension: "pushdown moves the upper arm, the extension keeps the elbow fixed" | Factually wrong: in a pushdown the upper arm stays still and the elbow extends | A | Rewrite; and if "Cable Triceps Extension" is overhead: "Overhead: the long head works at a longer length." |
| 7 | Overhead Triceps Extension ↔ Skull Crusher: related, "different movement pattern" | Both are elbow extension; the shoulder angle differs (overhead ≈ full flexion; skull crusher ≈ 90°) | A; B for overhead → more long-head growth (one study, Maeo et al.; an earlier study found no difference) | "Both straighten the elbow; overhead puts the long head on more stretch." |
| 8 | Seated Leg Curl ↔ Lying Leg Curl: close, "Similar setup" | Seated = hips flexed, so the hamstrings work at longer lengths | A; B (one 12-week study: ≈14% vs 9% volume) | Close; "Same knee bend; seated trains the hamstrings at a longer length (studies suggest more growth)." |
| 9 | Hack Squat ↔ Leg Press: related, "different movement pattern" | Both are knee- and hip-extension squat patterns on a sled | A | **Close**: "Squat pattern on a machine; the leg press gives more control over foot placement and depth." |
| 10 | RDL ↔ Stiff-Leg Deadlift: close, "Similar setup" | Vague. The SLDL keeps the knees straighter (more hamstring stretch at the knee); the RDL keeps a soft knee and starts from the top | A | Close; "Hip hinge for the hamstrings and glutes; straighter knees in the SLDL." |
| 11 | Bench Press ↔ Cable Fly: related, "Same muscle emphasis, different movement pattern" | The fly is horizontal adduction without elbow extension (no triceps); "same muscle emphasis" overstates it | A | "Chest without the triceps: the arms sweep in (horizontal adduction)." |
| 12 | Rear-Delt Fly ↔ Face Pull: related, generic | The face pull adds external rotation and scapular retraction | A | "Both pull the arms back; the face pull adds rotation and works more upper back." |
| 13 | Hammer Curl ↔ Reverse Cable Curl: related | Neutral and pronated grips both shift work toward the brachioradialis; the brachialis flexes the elbow regardless of grip | A | "Grip-turned curls: more forearm (brachioradialis), less biceps." |
| 14 | Lat Pulldown ↔ Pull-Up: related | Same vertical pull; differences are stability and loading | A | **Close**: "Same vertical pull, your bodyweight instead of a stack." |
| 15 | Calf Raise: one entry | Straight-knee (standing, leg-press) work trains the gastrocnemius; bent-knee (seated) mostly the soleus | A; B (standing grew the gastrocnemius far more; seated barely) | Treat "Calf Raise" as straight-knee and add "Seated Calf Raise" (*new*); related: "Bent knee: mostly soleus." |
| 16 | Leg Extension ↔ squats | Correctly **not** paired as close. Knee extension only vs knee and hip extension. | A | Keep; optionally related: "Quads only, no hips." |

Muscle-tag findings (search and grouping tags, not public claims):
- `chest-supported-wide-grip-row` already leads with upper back and rear delts, which is correct. `lat-pulldown` lists rear delts as secondary; fine.
- `back-extension` leads with lower back. For hip-dominant ("glute-biased") setups, glutes and hamstrings would lead. Mark it as a variation note rather than changing the default.
- `hammer-curl` is primary biceps and forearms. Brachioradialis and brachialis are more accurate but finer than the tag vocabulary; see the proposed model.

### Proposed metadata model (code-reviewed data, like today's tags)
```ts
type ExerciseFunction = {
  primary: Muscle[]; secondary: Muscle[];
  region?: string;              // "clavicular pec", "triceps long head": anatomy only, no growth claim
  jointActions: string[];       // "shoulder adduction", "shoulder extension", "elbow flexion", "knee extension", "hip extension"
  plane?: "frontal" | "sagittal" | "transverse";   // only where it distinguishes variations
  pattern: "vertical pull" | "horizontal pull" | "horizontal press" | "incline press" | "vertical press" | "fly" | "squat" | "hinge" | "knee flexion" | "knee extension" | "curl" | "extension" | "raise" | "calf" | "core";
  variation?: string;           // "wide grip, elbows flared", "knee bent"
  review: "draft" | "reviewed"; // public explanations show only reviewed entries
};
```
- **Close alternative:** the same pattern and primary target, and usually the same main joint action.
- **Related:** overlapping muscles but a different main joint action, plane or length emphasis.
- **Guardrails:** relationship text is written per pair (no generic phrases), at most about 90 characters, and no "identical stimulus" language. Buddy tips and any muscle-coverage statements use only `reviewed` entries.

### Sources checked
- Maeo et al. 2021, *Med Sci Sports Exerc* 53(4):825–837: seated vs prone leg curl.
- Maeo et al. 2023, *Eur J Sport Sci*: overhead vs neutral-arm triceps extension. Stasinaki et al. 2018 found no difference.
- Kinoshita et al. 2023, *Front Physiol*: standing vs seated calf raise.
- Bench-angle work is EMG and acute data (e.g. PubMed 25799093, 34644424). Long-term incline-vs-flat growth evidence is limited, so no growth claim is made.

---

## Part 7: importing an existing split (planning only)

### Goal
An experienced lifter moves their routine from Hevy, Strong, Notes or Sheets in a few minutes. Nothing is created until they confirm it.

### Recommended architecture (two lanes, one review screen)
1. **Structured lane (build first, no AI):**
   - **Inputs:** CSV/XLSX (Sheets export) and pasted text, plus Hevy/Strong exports where available (both offer CSV workout exports).
   - **Parsing:** done on the server with a column-mapping step ("this column is Exercise, this is Sets…").
   - **Extracted:** days, exercise names in order, sets, rep ranges, RIR and weights, each value only when present.
2. **Vision lane (later):**
   - **Inputs:** screenshots, photos or PDFs (up to 10 images or 1 PDF).
   - **Processing:** a server action uploads them to a private, short-lived staging area, which is deleted after extraction or within 24 h. It calls the Claude API (default model `claude-opus-5-5`) with structured output: a JSON schema of days → exercises → {name as written, sets?, reps?, rir?, weight?, unit?, kind: "target" | "logged"}.
   - **Instruction:** copy only what is visible and leave unknowns null.
3. **Shared steps for both lanes:**
   - **Matching:** names are matched to the catalog deterministically: exact match, alias table (`exercise_aliases`), then fuzzy score.
   - **Uncertain matches:** below a confidence threshold, an exercise is flagged "Review"; there's no silent substitution. A variant missing from the catalog ("Seated Dip Machine") stays unmatched until the user picks or skips it.
4. **Preview:** an editable table per day. Exercise order is preserved. Targets and logged history are shown separately: only targets go into the routine, and historical weights are offered as an optional "previous" note, never as logged sets.
5. **Confirm:** one call to the existing `import_training_split`. It carries an idempotency key (migration 0023) plus a content hash, so a second identical import is recognised and offered as "Switch to it". It never overwrites a routine or touches history.

### Privacy and safety
- **Storage:** uploads stay private (owner only), with no public URLs.
- **Retention:** originals are deleted after extraction or within 24 h; only the extracted text is kept, until the user confirms or cancels.
- **Keys:** the API key lives only on the server (Vercel env); requests are proxied by a server action.
- **Limits:** per user, 5 vision imports a day and 20 a month, with a monthly spend cap in code plus the Console spend limit.
- **Untrusted input:** extracted text is treated as data, never as instructions; the schema and matcher are the only path into the database.

### Expected cost (list prices as of Nov 2026)
- **Assumptions:**
  - A phone screenshot is roughly 1,500–1,800 input tokens; 4 screenshots plus instructions and the catalog name list come to about 9–10K input tokens.
  - Output is about 2–4K tokens, including thinking.
- **Default model (Claude Opus 5.5, $4 / $20 per MTok):**
  - about **$0.10–0.15 per import**;
  - 1,000 imports ≈ $100–150.
- Cheaper models (Sonnet 5.5 at $2 / $10, or Haiku 5.5 at $0.10 / $0.50) would cut that substantially. Choosing one is the owner's call, after measuring extraction accuracy on real screenshots. The structured lane costs nothing per import.

### Onboarding
- **Entry point:** "Import your current split" sits beside "Pick a split" on first Training visit and in Change split.
- **Flow:** upload → preview → fix the flagged items → Create.
- **Abandoning:** leaving mid-way stores nothing permanent.

### Sample import preview
```
Import from 3 screenshots · Hevy                                   [Cancel]
Day 1 · "Upper A" (from screenshot 1)
  1  Incline Bench Press (Smith Machine)   →  Incline Smith Press       ✓ match
     2 sets · 4–6 reps · target
  2  Pec Deck (Machine)                    →  Pec Deck                  ✓ match
     2 sets · 4–8 reps · target
  3  Seated Dip (Machine)                  →  ⚠ Review: no exact match
     2 sets · 4–8 reps                        [Choose: Dip · Weighted Dip · Machine Chest Press · Skip]
  4  Wide Grip Lat Pulldown                →  Lat Pulldown              ✓ match (wide grip is the default)
     2 sets · 4–6 reps · last logged 160 lb × 6 (kept as a note, not a set)
Day 2 · "Lower A"
  1  Calf Raise (Leg Press)                →  ⚠ Review: Calf Raise? (straight-knee)  [Confirm · Choose…]
     3 sets · reps not visible (left blank)
Nothing is created until you tap Create split. Your current splits and history stay as they are.
                                                              [Create split]
```

### Recommendation
- **First:** build the structured lane (CSV/XLSX/paste with column mapping) and the review screen. It's deterministic, free per use, and covers Sheets, Hevy and Strong exports.
- **Then:** add the vision lane behind the same review screen, starting with a small labelled set of real screenshots to measure extraction accuracy before release.
