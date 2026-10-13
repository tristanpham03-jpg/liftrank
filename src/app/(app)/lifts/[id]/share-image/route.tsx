import type { NextRequest } from "next/server";
import { CARD, glassPanel, notFound, pearlPill, pearlText, publicLink, renderCard } from "@/lib/cards";
import { getCatalog, getMyProfile, rpc } from "@/lib/data";
import { displayWeight, formatEstimatedMax, formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { HomeData, Lift, PersonalRecord, PublicProfile } from "@/lib/types";

/**
 * A 1080×1920 (9:16) share card for one of your own lifts.
 * Only the lift's owner can render it; everyone else gets a 404. The lift is
 * read through RLS like the lift page, so nothing outside your own data is used.
 * Shows the verified pill and any title this lift holds right now, and links to
 * your public LiftRank profile. Rendered only when you tap Share.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const me = await getMyProfile().catch(() => null);
  if (!me) return notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("lifts")
    .select("id, user_id, exercise_id, entered_weight, entered_unit, weight_kg, reps, score, is_ranked, performed_at, verification_status")
    .eq("id", id)
    .maybeSingle();
  const lift = data as Pick<Lift, "id" | "user_id" | "exercise_id" | "entered_weight" | "entered_unit" | "weight_kg" | "reps" | "score" | "is_ranked" | "performed_at" | "verification_status"> | null;
  if (!lift || lift.user_id !== me.id) return notFound();
  const exercise = (await getCatalog()).find((e) => e.id === lift.exercise_id);
  if (!exercise) return notFound();

  const [prs, home, profile] = await Promise.all([
    rpc<PersonalRecord[]>(supabase, "get_prs", { p_user_id: null }),
    rpc<HomeData>(supabase, "get_home"),
    rpc<PublicProfile | null>(supabase, "get_profile", { p_username: me.username }),
  ]);
  // Titles this exact lift holds right now ("Iron Crew champion", "Record at Iron Temple").
  const titles = (profile?.titles ?? [])
    .filter((t) => t.lift?.id === lift.id)
    .map((t) => (t.kind === "group" ? `${t.group?.name} champion` : `Record at ${t.gym?.name}`));
  const isPr = prs.some((p) => p.lift_id === lift.id);
  // Your standing on this exercise, only when this lift is the one that put you there.
  const board = isPr
    ? home.boards
        .filter((b) => b.exercise_id === exercise.id && b.me.lift_id === lift.id && b.total >= 2)
        .sort((a, b) => a.rank - b.rank || b.total - a.total)[0]
    : undefined;

  const unit = me.preferred_unit;
  const method = exercise.ranking_method;
  const weighted = method !== "max_reps" && displayWeight(lift, unit) != null;
  const text = formatLift(lift, method, unit);
  const [weight, reps] = text.split(" × ");
  const e1rm = lift.is_ranked && lift.reps !== 1 ? formatEstimatedMax(lift.score, method, unit) : null;
  const date = new Date(lift.performed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const name = me.display_name || me.username || "LiftRank lifter";

  return renderCard({
    name,
    detail: date,
    link: publicLink(me.username),
    body: (
      <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 18 }}>
            <div style={pearlPill}>{isPr ? "New personal record" : "Logged on LiftRank"}</div>
            {lift.verification_status === "verified" ? (
              <div style={{ ...pearlPill, color: CARD.silver, backgroundImage: "none", border: "2px solid rgba(214,220,232,0.45)" }}>Verified</div>
            ) : null}
          </div>
          <div style={{ marginTop: 72, fontSize: 62, fontWeight: 500, color: "#aab0bd" }}>{exercise.name}</div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 10, fontWeight: 700, letterSpacing: -12, lineHeight: 1 }}>
            {weighted && reps
              ? [
                  <span key="w" style={{ fontSize: 250, ...pearlText }}>{weight}</span>,
                  <span key="u" style={{ fontSize: 70, fontWeight: 500, letterSpacing: 0, color: "#7d8598", marginLeft: 14, marginBottom: 28 }}>{unit}</span>,
                  <span key="x" style={{ fontSize: 130, fontWeight: 500, letterSpacing: 0, color: "#7d8598", margin: "0 26px 34px" }}>×</span>,
                  <span key="r" style={{ fontSize: 250, ...pearlText }}>{reps}</span>,
                ]
              : <span style={{ fontSize: 230, ...pearlText }}>{text}</span>}
          </div>
          {e1rm ? <div style={{ display: "flex", marginTop: 34, fontSize: 48, fontWeight: 500, color: "#d6dce8" }}>{`Estimated 1RM ${e1rm}`}</div> : null}
          {board ? (
            <div style={{ ...glassPanel, alignItems: "center", gap: 26, marginTop: 72, padding: "34px 40px" }}>
              <span style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, ...pearlText }}>{`#${board.rank}`}</span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 40, fontWeight: 700 }}>{`of ${board.total} on ${exercise.name}`}</span>
                <span style={{ fontSize: 36, fontWeight: 500, color: "#aab0bd", marginTop: 4 }}>
                  {board.kind === "friends" ? "Friends" : (board.group_name ?? "Group")}
                </span>
              </span>
            </div>
          ) : null}
          {titles.length ? (
            <div style={{ display: "flex", marginTop: 40, fontSize: 44, fontWeight: 700, color: CARD.silver }}>{`${titles.join(" · ")}`}</div>
          ) : null}
      </div>
    ),
  });
}
