import type { Exercise } from "./types";

/** Short, text-only exercise labels (no pictures): equipment, and "Primary muscle · Equipment". */
export const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  smith_machine: "Smith machine",
  cable: "Cable",
  plate_loaded: "Plate-loaded",
  selectorized: "Machine",
  bodyweight: "Bodyweight",
  assisted_bodyweight: "Assisted",
  other: "Other",
};

export function equipmentLabel(e: Pick<Exercise, "equipment_type" | "ranking_method">) {
  if (e.ranking_method === "added_load_e1rm") return "Weighted";
  return EQUIPMENT_LABEL[e.equipment_type] ?? "Other";
}

/** "Side delts · Cable": the primary muscle group and the equipment, for lists and headers. */
export function exerciseMeta(e: Pick<Exercise, "muscle_group" | "equipment_type" | "ranking_method">) {
  return [e.muscle_group, equipmentLabel(e)].filter(Boolean).join(" · ");
}
