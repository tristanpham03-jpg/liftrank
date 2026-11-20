import type { Draft, DraftBlock, RoutineItem } from "@/lib/session";
import type { TrainingSet } from "@/lib/training";
import type { Previous } from "@/lib/training-previous";
import type { Exercise } from "@/lib/types";
import type { MyExercise } from "@/app/(app)/training/exercises/my-exercises";

/**
 * break-ui fixtures (dev only): the session logger and My Exercises with demo
 * data, the realistic worst case, empty, one, and huge. Every value is at a
 * real limit: day name 30 chars (DB check), split name 40, note 500, 30 sets
 * per exercise (parseDraft), weight 7 typed chars, reps 3, RIR 2, the longest
 * catalog names, per-dumbbell / added / bodyweight / left-right formats.
 */
export type State = "demo" | "worst" | "empty" | "one" | "huge";
export const STATES: State[] = ["demo", "worst", "empty", "one", "huge"];

let n = 0;
const set = (exerciseId: string, w: number | null, reps: number, side: TrainingSet["side"] = null, date = "2026-11-12"): TrainingSet => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  exercise_id: exerciseId,
  day_id: null,
  set_number: 1,
  entered_weight: w,
  entered_unit: w == null ? null : "lb",
  weight_kg: w == null ? null : w * 0.4536,
  reps,
  score: 1,
  is_ranked: true,
  local_date: date,
  performed_at: `${date}T12:00:00Z`,
  pr_dismissed: false,
  side,
});
const prev = (sets: TrainingSet[], best?: Partial<Previous["best"]>): Previous => ({
  both: sets.filter((s) => !s.side),
  left: sets.filter((s) => s.side === "left"),
  right: sets.filter((s) => s.side === "right"),
  date: sets[0]?.local_date ?? null,
  best: { both: null, left: null, right: null, ...best },
});
const block = (key: string, ex: Exercise, setCount: number, values: DraftBlock["values"] = {}, extra: Partial<DraftBlock> = {}): DraftBlock => ({
  key,
  exerciseId: ex.id,
  unilateral: false,
  setCount,
  values,
  note: "",
  ...extra,
});

export type SessionFixture = {
  dayName: string;
  routine: { dayId: string; name: string; exercises: RoutineItem[] } | null;
  draft: Draft;
  previous: Record<string, Previous>;
  notes: Record<string, string>;
};

const LONG_NOTE =
  "Seat 4, back pad 2 holes from the top. Pause 1s at the bottom, no bounce. Elbows tucked ~45°, wrists stacked. If the left shoulder pinches, switch to neutral grip and drop 10%. Last set: rest-pause to failure (2 mini-sets, 15s). Use the blue straps on the far cable stack; the near one has a sticky pulley around plate 9. Film set 3 for form check. Superset with face pulls if the gym is busy and the stack is free.";

export function sessionFixture(state: State, c: Map<string, Exercise>): SessionFixture {
  const ex = (slug: string) => c.get(slug)!;
  if (state === "empty") return { dayName: "Workout", routine: null, draft: { v: 1, blocks: [] }, previous: {}, notes: {} };
  if (state === "one") {
    const b = ex("barbell-bench-press");
    return {
      dayName: "Push",
      routine: { dayId: "00000000-0000-4000-8000-0000000000d1", name: "Push", exercises: [{ exerciseId: b.id, setCount: 1, altGroup: null }] },
      draft: { v: 1, blocks: [block("one", b, 1)] },
      previous: { [b.id]: prev([set(b.id, 225, 1)], { both: set(b.id, 225, 1) }) },
      notes: {},
    };
  }
  if (state === "demo") {
    const [b, l, r] = [ex("barbell-bench-press"), ex("lat-pulldown"), ex("lateral-raise")];
    return {
      dayName: "Upper",
      routine: {
        dayId: "00000000-0000-4000-8000-0000000000d2",
        name: "Upper",
        exercises: [b, l, r].map((e) => ({ exerciseId: e.id, setCount: 3, altGroup: null })),
      },
      draft: { v: 1, blocks: [block("b", b, 3, { "1": { w: "185", r: "8", rir: "2" } }), block("l", l, 3), block("r", r, 3)] },
      previous: {
        [b.id]: prev([set(b.id, 185, 8), set(b.id, 185, 7)], { both: set(b.id, 205, 5) }),
        [l.id]: prev([set(l.id, 140, 10)], { both: set(l.id, 150, 8) }),
        [r.id]: prev([set(r.id, 25, 12)], { both: set(r.id, 30, 10) }),
      },
      notes: { [b.id]: "Seat 3" },
    };
  }
  if (state === "huge") {
    const pool = [...c.values()].filter((e) => e.ranking_method !== "none").slice(0, 30);
    return {
      dayName: "Full Body (Everything) Day 7",
      routine: null,
      draft: { v: 1, blocks: pool.map((e, i) => block(`h${i}`, e, 10)) },
      previous: Object.fromEntries(pool.map((e) => [e.id, prev([set(e.id, 135, 10)], { both: set(e.id, 315, 3) })])),
      notes: {},
    };
  }
  // Worst case: every row of the catalog that applies, spread across the first blocks.
  const btb = ex("behind-the-back-cable-lateral-raise"); // longest name, left/right
  const rdl = ex("smith-romanian-deadlift"); // alt slot with long options
  const pull = ex("pull-up"); // bodyweight: reps only
  const wbe = ex("weighted-back-extension"); // added load ("+45")
  const dpc = ex("dumbbell-preacher-curl"); // per dumbbell ("each")
  const legPress = ex("leg-press"); // 4-digit weights
  const slot = [rdl, ex("romanian-deadlift"), ex("stiff-leg-deadlift")].map((e) => ({ exerciseId: e.id, setCount: 4 }));
  const dayName = "Upper Heavy (Week 12 of Block)"; // 30 chars, the DB limit
  return {
    dayName,
    routine: {
      dayId: "00000000-0000-4000-8000-0000000000d3",
      name: dayName,
      exercises: [{ exerciseId: legPress.id, setCount: 4, altGroup: null }],
    },
    draft: {
      v: 1,
      blocks: [
        block(
          "btb",
          btb,
          4,
          { "1L": { w: "17.5", r: "100", rir: "10" }, "1R": { w: "17.5", r: "99", rir: "" }, "2L": { w: "1234.75", r: "", rir: "" } },
          { unilateral: true, note: "Felt the left side more today" },
        ),
        block("rdl", rdl, 4, { "1": { w: "1234.75", r: "200", rir: "10" } }, { slot: 1, alts: slot }),
        block("pull", pull, 30, { "1": { w: "", r: "200", rir: "0" } }),
        block("wbe", wbe, 2, { "1": { w: "45", r: "1", rir: "" } }),
        block("dpc", dpc, 3),
        block("lp", legPress, 4, { "1": { w: "1405", r: "12", rir: "1" } }),
      ],
    },
    previous: {
      [btb.id]: prev([set(btb.id, 17.5, 15, "left"), set(btb.id, 15, 15, "right")], { left: set(btb.id, 22.5, 12, "left"), right: set(btb.id, 20, 14, "right") }),
      [rdl.id]: prev([set(rdl.id, 1102.5, 8)], { both: set(rdl.id, 1234.75, 6) }),
      [pull.id]: prev([set(pull.id, null, 1)], { both: set(pull.id, null, 1) }),
      [wbe.id]: prev([set(wbe.id, 45, 20)], { both: set(wbe.id, 90, 12) }),
      [dpc.id]: prev([], {}),
      [legPress.id]: prev([set(legPress.id, 1405, 12, null, "2025-01-03")], { both: set(legPress.id, 1495, 10) }),
    },
    notes: { [btb.id]: LONG_NOTE },
  };
}

export function exercisesFixture(state: State, c: Exercise[]): MyExercise[] {
  const by = new Map(c.map((e) => [e.slug, e]));
  const row = (slug: string, sets: number, last: string | null, favorite = false): MyExercise => ({ exercise: by.get(slug)!, sets, last, favorite });
  if (state === "empty") return [];
  if (state === "one") return [row("barbell-bench-press", 1, "2026-11-19", true)];
  if (state === "demo") return [row("barbell-bench-press", 42, "2026-11-19"), row("lat-pulldown", 30, "2026-11-17"), row("lateral-raise", 24, "2026-11-17", true)];
  if (state === "huge") return c.map((e, i) => ({ exercise: e, sets: 5000 - i, last: "2026-11-19", favorite: i % 3 === 0 }));
  return [
    row("behind-the-back-cable-lateral-raise", 4999, "2026-11-19", true),
    row("smith-romanian-deadlift", 1, "2024-02-29"),
    row("chest-supported-close-grip-row", 0, null, true),
    row("weighted-back-extension", 1284, "2026-01-01"),
    row("pull-up", 2, "2026-11-20", true),
  ];
}
