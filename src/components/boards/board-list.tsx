import Link from "next/link";
import { VerificationIcon } from "@/components/lifts/verification-badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { formatEstimatedMax, formatLift } from "@/lib/scoring";
import type { BoardRow, RankingMethod, WeightUnit } from "@/lib/types";

export function RankNumber({ rank, highlight, className }: { rank: number; highlight?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "num inline-block text-right tabular",
        rank === 1 ? "pearl-text text-[26px]" : rank <= 3 ? "text-[22px] text-fg" : "text-lg text-fg-3",
        highlight && rank !== 1 && "text-fg",
        className,
      )}
    >
      {rank}
    </span>
  );
}

export function BoardRowItem({ row, method, unit }: { row: BoardRow; method: RankingMethod; unit: WeightUnit }) {
  const e1rm = formatEstimatedMax(row.score, method, unit);
  const name = row.display_name || row.username || "Lifter";
  return (
    <li>
      <Link
        href={row.username ? `/u/${row.username}` : "#"}
        className={cn(
          "grid grid-cols-[36px_36px_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]",
          row.is_me && "bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] rounded-[16px]",
        )}
      >
        <RankNumber rank={row.rank} highlight={row.is_me} />
        <Avatar name={name} seed={row.user_id} path={row.avatar_path} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate font-medium text-fg")}>{row.is_me ? "You" : name}</span>
            <VerificationIcon status={row.verification_status} />
          </span>
          {row.machine ? (
            <span className="block truncate text-sm text-fg-3">
              {row.machine.manufacturer}
              {row.machine.model ? ` ${row.machine.model}` : ""}
            </span>
          ) : row.username ? (
            <span className="block truncate text-sm text-fg-3">@{row.username}</span>
          ) : null}
        </span>
        <span className="text-right">
          <span className={cn("num block text-lg", !row.is_me && row.rank > 3 && "text-fg-2")}>{formatLift(row, method, unit)}</span>
          {e1rm && row.reps !== 1 ? <span className="block text-xs text-fg-3 tabular">≈ {e1rm}</span> : null}
        </span>
      </Link>
    </li>
  );
}

export function BoardList({ rows, method, unit }: { rows: BoardRow[]; method: RankingMethod; unit: WeightUnit }) {
  return (
    <ol className="glass rounded-[var(--radius-panel)] p-1.5 overflow-hidden [&>li+li]:border-t [&>li+li]:border-white/[0.05]">
      {rows.map((r) => (
        <BoardRowItem key={r.user_id} row={r} method={method} unit={unit} />
      ))}
    </ol>
  );
}
