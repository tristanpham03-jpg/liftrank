import type { Exercise, WeightUnit } from "./types";
import type { Side } from "./training";

/**
 * A training session's draft: everything typed since Start. It lives in the
 * session row on the server (autosaved) and in localStorage on the device, so
 * nothing depends on React memory. Values are kept as typed (strings).
 */
export type RowValues = { w: string; r: string; rir: string };

export type DraftBlock = {
  /** Stable within the session (a routine exercise id, or a fresh id for added ones). */
  key: string;
  exerciseId: string;
  unilateral: boolean;
  setCount: number;
  /** Row key ("1", "2", … or "1L", "1R", …) → values. */
  values: Record<string, RowValues>;
  /** A note for this session only (routine notes are saved separately). */
  note: string;
  /**
   * Alternative slot: the routine's options for this place in the day ("do one
   * of these"), in routine order, each with its own set count. Absent for an
   * ordinary exercise. `slot` ties together blocks of the same slot (doing more
   * than one option); only the first is written back to the routine.
   */
  slot?: number;
  alts?: AltOption[];
};

export type AltOption = { exerciseId: string; setCount: number; unilateral?: boolean };

/** One saved routine entry. Entries sharing an altGroup form one slot. */
export type RoutineItem = { exerciseId: string; setCount: number; altGroup: number | null };

export type Draft = {
  v: 1;
  blocks: DraftBlock[];
  /** Set on the first End attempt and reused on retries, so End is idempotent. */
  finishKey?: string;
};

export type SessionSet = {
  exercise_id: string;
  side: Side | null;
  weight: number | null;
  unit: WeightUnit | null;
  reps: number;
  rir: number | null;
  /** "<block key>/<row key>": lets End attach a recording made during the workout to this saved set. */
  ref?: string;
};

export type RowError = { blockKey: string; rowKey: string; message: string };

export const MAX_RIR = 10;

/** How a recording made during a workout points at a draft row until End saves it as a set. */
export const draftRowRef = (blockKey: string, rowKey: string) => `${blockKey}/${rowKey}`.slice(0, 120);
export const EMPTY_ROW: RowValues = { w: "", r: "", rir: "" };

export function rowKey(n: number, side: Side | null): string {
  return `${n}${side ? side[0].toUpperCase() : ""}`;
}

/** The rows a block shows, in order: 1, 2, … or 1L, 1R, 2L, 2R, … */
export function blockRows(block: Pick<DraftBlock, "setCount" | "unilateral">): { key: string; n: number; side: Side | null }[] {
  const out: { key: string; n: number; side: Side | null }[] = [];
  for (let n = 1; n <= block.setCount; n++) {
    for (const side of block.unilateral ? (["left", "right"] as const) : [null]) out.push({ key: rowKey(n, side), n, side });
  }
  return out;
}

const blank = (v: RowValues | undefined) => !v || (!v.w.trim() && !v.r.trim() && !v.rir.trim());
export const rowHasInput = (v: RowValues | undefined) => !blank(v);
export const blockHasInput = (b: DraftBlock) => blockRows(b).some((r) => rowHasInput(b.values[r.key]));

/** A new block: empty rows (previous values are shown as hints, never as entries). */
export function newBlock(key: string, exerciseId: string, setCount: number, unilateral: boolean, note = ""): DraftBlock {
  return { key, exerciseId, unilateral, setCount: Math.max(1, Math.min(30, setCount)), values: {}, note };
}

export function newDraft(blocks: DraftBlock[]): Draft {
  return { v: 1, blocks };
}

/** Reads a stored draft defensively (old or partial shapes become empty, never crash). */
export function parseDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Draft).blocks)) return null;
  const blocks = (raw as Draft).blocks
    .filter((b) => b && typeof b.key === "string" && typeof b.exerciseId === "string")
    .map((b) => ({
      key: b.key,
      exerciseId: b.exerciseId,
      unilateral: Boolean(b.unilateral),
      setCount: Math.max(1, Math.min(30, Number(b.setCount) || 1)),
      values: Object.fromEntries(
        Object.entries(b.values && typeof b.values === "object" ? b.values : {}).map(([k, v]) => [
          k,
          { w: String((v as RowValues)?.w ?? ""), r: String((v as RowValues)?.r ?? ""), rir: String((v as RowValues)?.rir ?? "") },
        ]),
      ),
      note: typeof b.note === "string" ? b.note : "",
      ...(Number.isInteger(b.slot) && Array.isArray(b.alts) && b.alts.length > 1
        ? {
            slot: b.slot,
            alts: b.alts
              .filter((a) => a && typeof a.exerciseId === "string")
              .map((a) => ({ exerciseId: a.exerciseId, setCount: Math.max(1, Math.min(10, Number(a.setCount) || 2)), unilateral: Boolean(a.unilateral) })),
          }
        : {}),
    }));
  const finishKey = typeof (raw as Draft).finishKey === "string" ? (raw as Draft).finishKey : undefined;
  return { v: 1, blocks, ...(finishKey ? { finishKey } : {}) };
}

/**
 * Turns the draft into the sets End saves. Rows nobody touched are skipped (a
 * previous value shown as a hint is not an entry). A row with some input must be
 * complete: reps, plus weight for weighted exercises; RIR is optional (blank =
 * not recorded, which is different from 0). Rows hidden by the current mode
 * (both-sides vs left/right) are not saved.
 */
export function draftToSets(
  draft: Draft,
  exerciseById: Map<string, Pick<Exercise, "id" | "ranking_method">>,
  unit: WeightUnit,
): { sets: SessionSet[]; errors: RowError[] } {
  const sets: SessionSet[] = [];
  const errors: RowError[] = [];
  for (const block of draft.blocks) {
    const ex = exerciseById.get(block.exerciseId);
    if (!ex) continue;
    const bodyweight = ex.ranking_method === "max_reps";
    for (const row of blockRows(block)) {
      const v = block.values[row.key];
      if (!rowHasInput(v)) continue;
      const err = (message: string) => errors.push({ blockKey: block.key, rowKey: row.key, message });
      const reps = Number(v!.r);
      const weight = bodyweight ? null : Number(v!.w);
      const rir = v!.rir.trim() === "" ? null : Number(v!.rir);
      if (!bodyweight && !(weight! > 0)) {
        err("Add the weight, or clear this row.");
        continue;
      }
      if (!Number.isInteger(reps) || reps < 1 || reps > 200) {
        err("Add the reps, or clear this row.");
        continue;
      }
      if (rir !== null && (!Number.isInteger(rir) || rir < 0 || rir > MAX_RIR)) {
        err(`RIR is a whole number from 0 to ${MAX_RIR}.`);
        continue;
      }
      sets.push({ exercise_id: block.exerciseId, side: row.side, weight, unit: bodyweight ? null : unit, reps, rir, ref: draftRowRef(block.key, row.key) });
    }
  }
  return { sets, errors };
}

/**
 * Puts each slot's entries together (at its first entry's place) and numbers
 * the slots 1, 2, … in order; a "slot" of one exercise is just an exercise.
 * Two routines are the same when their normalized forms are equal.
 */
export function normalizeRoutine(items: RoutineItem[]): RoutineItem[] {
  const out: RoutineItem[] = [];
  const done = new Set<number>();
  let next = 1;
  for (const it of items) {
    if (it.altGroup == null) {
      out.push({ ...it, altGroup: null });
      continue;
    }
    if (done.has(it.altGroup)) continue;
    done.add(it.altGroup);
    const members = items.filter((x) => x.altGroup === it.altGroup).filter((x, i, all) => all.findIndex((y) => y.exerciseId === x.exerciseId) === i);
    if (members.length < 2) out.push({ ...members[0], altGroup: null });
    else {
      const g = next++;
      for (const m of members) out.push({ ...m, altGroup: g });
    }
  }
  return out;
}

/**
 * What "Save to routine" writes: the session's exercises in order, with each
 * slot's options kept (the one done this session gets this session's set count).
 * Extra blocks of a slot (doing more than one option) aren't written twice.
 */
export function draftToRoutine(draft: Draft): RoutineItem[] {
  const items: RoutineItem[] = [];
  const seen = new Set<number>();
  for (const b of draft.blocks) {
    if (b.slot == null || !b.alts?.length) {
      items.push({ exerciseId: b.exerciseId, setCount: b.setCount, altGroup: null });
      continue;
    }
    if (seen.has(b.slot)) continue;
    seen.add(b.slot);
    const alts = b.alts.some((a) => a.exerciseId === b.exerciseId) ? b.alts : [...b.alts, { exerciseId: b.exerciseId, setCount: b.setCount }];
    for (const a of alts) items.push({ exerciseId: a.exerciseId, setCount: a.exerciseId === b.exerciseId ? b.setCount : a.setCount, altGroup: b.slot });
  }
  return normalizeRoutine(items);
}

const sameRoutine = (a: RoutineItem[], b: RoutineItem[]) =>
  a.length === b.length && a.every((x, i) => x.exerciseId === b[i].exerciseId && x.setCount === b[i].setCount && x.altGroup === b[i].altGroup);

/** True when the session's exercise list (order, set counts, slots) differs from the saved routine. */
export function differsFromRoutine(draft: Draft, routine: RoutineItem[]): boolean {
  return !sameRoutine(draftToRoutine(draft), normalizeRoutine(routine));
}

/**
 * The draft a new session starts with, built from the routine as saved right
 * now (on the server, so a stale page can't start an old routine). A slot
 * becomes one block showing the option you did most recently (else the first).
 */
export function routineToDraft(
  routine: (RoutineItem & { key: string })[],
  opts: { unilateral: (exerciseId: string) => boolean; lastDone: string[] },
): Draft {
  const blocks: DraftBlock[] = [];
  const norm = normalizeRoutine(routine);
  const keyOf = new Map(routine.map((r) => [r.exerciseId, r.key]));
  const done = new Set<number>();
  for (const it of norm) {
    if (it.altGroup == null) {
      blocks.push(newBlock(keyOf.get(it.exerciseId) ?? it.exerciseId, it.exerciseId, it.setCount, opts.unilateral(it.exerciseId)));
      continue;
    }
    if (done.has(it.altGroup)) continue;
    done.add(it.altGroup);
    const alts = norm.filter((x) => x.altGroup === it.altGroup).map((x) => ({ exerciseId: x.exerciseId, setCount: x.setCount, unilateral: opts.unilateral(x.exerciseId) }));
    const pick = opts.lastDone.find((id) => alts.some((a) => a.exerciseId === id)) ?? alts[0].exerciseId;
    const chosen = alts.find((a) => a.exerciseId === pick)!;
    blocks.push({ ...newBlock(`slot${it.altGroup}-${keyOf.get(pick) ?? pick}`, pick, chosen.setCount, opts.unilateral(pick)), slot: it.altGroup, alts });
  }
  return newDraft(blocks);
}

/** Switches a slot block to another option: its set count comes along, entries are cleared. */
export function switchOption(block: DraftBlock, exerciseId: string): DraftBlock {
  const alts = (block.alts ?? []).map((a) => (a.exerciseId === block.exerciseId ? { ...a, setCount: block.setCount, unilateral: block.unilateral } : a));
  const target = alts.find((a) => a.exerciseId === exerciseId);
  return { ...block, alts, exerciseId, setCount: target?.setCount ?? block.setCount, values: {}, unilateral: Boolean(target?.unilateral) };
}

/** Another option of the same slot, done in this session as well (its own block, its own history). */
export function alsoOption(block: DraftBlock, exerciseId: string, key: string): DraftBlock {
  const target = block.alts?.find((a) => a.exerciseId === exerciseId);
  return { ...newBlock(key, exerciseId, target?.setCount ?? block.setCount, Boolean(target?.unilateral)), slot: block.slot, alts: block.alts };
}
