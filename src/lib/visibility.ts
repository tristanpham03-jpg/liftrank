import type { LiftVisibility } from "./types";

/**
 * One description per visibility, matching the database rules
 * (public._can_view_lift and the board functions):
 *  public  → any signed-in user; friends board, your groups' boards, your profile;
 *            gym / nearby boards only if you opted in.
 *  friends → your accepted friends; the friends board.
 *  groups  → members of the groups you pick; those groups' boards.
 *  private → only you; still counts toward your own records.
 */
export const VISIBILITY: { value: LiftVisibility; label: string; help: string }[] = [
  { value: "public", label: "Public", help: "Anyone on LiftRank. Counts on friends and group boards." },
  { value: "friends", label: "Friends", help: "Only your friends. Counts on the friends board." },
  { value: "groups", label: "Selected groups", help: "Only the groups you pick, on their boards." },
  { value: "private", label: "Private", help: "Only you. Still counts toward your own records." },
];

export function visibilityLabel(v: LiftVisibility) {
  return VISIBILITY.find((o) => o.value === v)?.label ?? v;
}
