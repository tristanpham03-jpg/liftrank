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
};

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
};

export type RowError = { blockKey: string; rowKey: string; message: string };

export const MAX_RIR = 10;
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
      sets.push({ exercise_id: block.exerciseId, side: row.side, weight, unit: bodyweight ? null : unit, reps, rir });
    }
  }
  return { sets, errors };
}

/** True when the session's exercise list (order and set counts) differs from the saved routine. */
export function differsFromRoutine(draft: Draft, routine: { exerciseId: string; setCount: number }[]): boolean {
  if (draft.blocks.length !== routine.length) return true;
  return draft.blocks.some((b, i) => b.exerciseId !== routine[i].exerciseId || b.setCount !== routine[i].setCount);
}
