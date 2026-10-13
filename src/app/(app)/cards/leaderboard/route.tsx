import type { NextRequest } from "next/server";
import { CARD, glassPanel, notFound, pearlPill, pearlText, publicLink, renderCard } from "@/lib/cards";
import { getCatalog, getMyProfile, rpc } from "@/lib/data";
import { formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { Board, BoardRow, GroupSummary } from "@/lib/types";

const SCOPES = ["friends", "groups", "gym", "nearby"] as const;

/**
 * Share card of a leaderboard as you see it: the top five and your own row.
 * The board comes from get_leaderboard as you, so nothing you can't see is
 * used. Because a shared image can travel further than a lift's audience,
 * other people's rows whose lift isn't public are drawn without a name or a
 * number. Same query string as /leaderboards.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const me = await getMyProfile().catch(() => null);
  if (!me?.username) return notFound();
  const exercise = (await getCatalog()).find((e) => e.slug === sp.get("exercise"));
  const scope = SCOPES.find((s) => s === sp.get("scope")) ?? "friends";
  if (!exercise) return notFound();
  const period = sp.get("period") === "month" ? "month" : "all";
  const radius = scope === "nearby" ? ([5, 10, 25].find((r) => String(r) === sp.get("radius")) ?? 10) : null;
  const supabase = await createClient();

  let groupName: string | null = null;
  if (scope === "groups") {
    const groups = await rpc<GroupSummary[]>(supabase, "get_my_groups");
    const group = groups.find((g) => g.id === sp.get("group"));
    if (!group) return notFound();
    groupName = group.name;
  }
  const board = await rpc<Board>(supabase, "get_leaderboard", {
    p_exercise_id: exercise.id,
    p_kind: scope === "groups" ? "group" : scope,
    p_group_id: scope === "groups" ? sp.get("group") : null,
    p_period: period,
    p_limit: 5,
    p_offset: 0,
    p_radius_mi: radius,
    p_verified: sp.get("verified") === "1",
    p_machine_model_id: /^[0-9a-f-]{36}$/i.test(sp.get("model") ?? "") ? sp.get("model") : null,
  }).catch(() => null);
  if (!board || board.reason || !board.rows.length) return notFound();

  const rows: BoardRow[] = [...board.rows];
  if (board.me && !rows.some((r) => r.is_me)) rows.push(board.me);
  // Which of these lifts are public? (Read through RLS, as the viewer.)
  const { data: lifts } = await supabase.from("lifts").select("id, visibility").in("id", rows.map((r) => r.lift_id));
  const isPublic = new Set((lifts ?? []).filter((l) => l.visibility === "public").map((l) => l.id));

  const unit = me.preferred_unit;
  const where =
    scope === "friends" ? "Friends" : scope === "groups" ? groupName : scope === "gym" ? board.gym?.name : `Within ${radius} mi`;
  const subtitle = [where, period === "month" ? "This month" : "All time", sp.get("verified") === "1" ? "Verified" : null]
    .filter(Boolean)
    .join(" · ");

  return renderCard({
    name: me.display_name || me.username,
    detail: `${board.total} ranked`,
    link: publicLink(me.username),
    body: (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={pearlPill}>Leaderboard</div>
        <div style={{ marginTop: 56, fontSize: 92, fontWeight: 700, letterSpacing: -3, ...pearlText }}>{exercise.name}</div>
        <div style={{ marginTop: 8, fontSize: 44, fontWeight: 500, color: CARD.muted }}>{subtitle}</div>
        <div style={{ ...glassPanel, flexDirection: "column", marginTop: 56, padding: "18px 40px" }}>
          {rows.map((r, i) => {
            const shown = r.is_me || isPublic.has(r.lift_id);
            return (
              <div
                key={r.lift_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "26px 0",
                  borderTop: i === 0 ? "none" : "2px solid rgba(255,255,255,0.06)",
                  fontSize: 46,
                }}
              >
                <span style={{ width: 110, fontWeight: 700, ...(r.rank === 1 ? pearlText : { color: CARD.faint }) }}>{`${r.rank}`}</span>
                <span style={{ flex: 1, fontWeight: r.is_me ? 700 : 500, color: shown ? CARD.text : CARD.faint }}>
                  {r.is_me ? "You" : shown ? r.display_name || r.username || "Lifter" : "Lifter"}
                </span>
                <span style={{ fontWeight: 700, color: shown ? CARD.text : CARD.faint }}>
                  {shown ? formatLift(r, exercise.ranking_method, unit) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    ),
  });
}
