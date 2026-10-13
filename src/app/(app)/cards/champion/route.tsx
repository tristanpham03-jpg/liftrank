import type { NextRequest } from "next/server";
import { CARD, glassPanel, notFound, pearlPill, pearlText, publicLink, renderCard } from "@/lib/cards";
import { getMyProfile, rpc } from "@/lib/data";
import { displayWeight, formatEstimatedMax, formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { Title } from "@/lib/types";

/**
 * Share card for a title you hold right now (group champion or gym record).
 * get_champion_card only answers for the current holder, so anyone else, or a
 * title you've since lost, gets a 404.  /cards/champion?board=group:<id>:<exercise>
 */
export async function GET(req: NextRequest) {
  const board = req.nextUrl.searchParams.get("board") ?? "";
  if (!/^(group|gym):[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(board)) return notFound();
  const me = await getMyProfile().catch(() => null);
  if (!me?.username) return notFound();
  const supabase = await createClient();
  const title = await rpc<Title | null>(supabase, "get_champion_card", { p_board_key: board }).catch(() => null);
  if (!title) return notFound();

  const unit = me.preferred_unit;
  const method = title.exercise.ranking_method;
  const lift = title.lift;
  const text = lift ? formatLift(lift, method, unit) : null;
  const [weight, reps] = text?.split(" × ") ?? [];
  const weighted = lift && method !== "max_reps" && displayWeight(lift, unit) != null;
  const e1rm = lift && lift.reps !== 1 ? formatEstimatedMax(lift.score, method, unit) : null;
  const where = title.kind === "group" ? title.group?.name : title.gym?.name;
  const since = new Date(title.since).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return renderCard({
    name: me.display_name || me.username,
    detail: `Since ${since}`,
    link: publicLink(me.username),
    body: (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={pearlPill}>{title.kind === "group" ? "Group champion" : "Gym record"}</div>
        <div style={{ marginTop: 72, fontSize: 62, fontWeight: 500, color: CARD.muted }}>{title.exercise.name}</div>
        {text ? (
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 10, fontWeight: 700, letterSpacing: -12, lineHeight: 1 }}>
            {weighted && reps
              ? [
                  <span key="w" style={{ fontSize: 250, ...pearlText }}>{weight}</span>,
                  <span key="u" style={{ fontSize: 70, fontWeight: 500, letterSpacing: 0, color: CARD.faint, marginLeft: 14, marginBottom: 28 }}>{unit}</span>,
                  <span key="x" style={{ fontSize: 130, fontWeight: 500, letterSpacing: 0, color: CARD.faint, margin: "0 26px 34px" }}>×</span>,
                  <span key="r" style={{ fontSize: 250, ...pearlText }}>{reps}</span>,
                ]
              : <span style={{ fontSize: 230, ...pearlText }}>{text}</span>}
          </div>
        ) : null}
        {e1rm ? <div style={{ display: "flex", marginTop: 34, fontSize: 48, fontWeight: 500, color: CARD.silver }}>{`Estimated 1RM ${e1rm}`}</div> : null}
        <div style={{ ...glassPanel, flexDirection: "column", marginTop: 72, padding: "34px 40px" }}>
          <span style={{ fontSize: 40, fontWeight: 700 }}>{`#1 on ${title.exercise.name}`}</span>
          <span style={{ fontSize: 36, fontWeight: 500, color: CARD.muted, marginTop: 4 }}>{where ?? ""}</span>
        </div>
      </div>
    ),
  });
}
