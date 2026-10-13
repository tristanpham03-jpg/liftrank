"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { SharePrButton } from "./share-pr-button";
import { cn } from "@/lib/cn";
import { formatEstimatedMax, formatLift, toKg } from "@/lib/scoring";
import type { Exercise, SubmitResult, WeightUnit } from "@/lib/types";

type Props = {
  result: SubmitResult;
  exercise: Exercise;
  unit: WeightUnit;
  weight: number | null;
  reps: number;
  onLogAnother: () => void;
  actions?: React.ReactNode;
};

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.length - 1 > 2 ? `${names.length - 1} others` : names.at(-1)}`;
}

export function LiftResult({
  result,
  exercise,
  unit,
  weight,
  reps,
  onLogAnother,
  actions,
}: Props) {
  const reduce = useReducedMotion();
  const load = {
    entered_weight: weight,
    entered_unit: weight == null ? null : unit,
    weight_kg: weight == null ? null : toKg(weight, unit),
    reps,
  };
  const liftText = formatLift(load, exercise.ranking_method, unit);
  const e1rm = result.is_ranked
    ? formatEstimatedMax(result.score, exercise.ranking_method, unit)
    : null;

  const before = new Map(
    result.boards_before.map((b) => [`${b.kind}:${b.group_id ?? ""}`, b]),
  );
  const moves = result.boards
    .filter((b) => b.rank != null)
    .map((b) => ({
      ...b,
      before: before.get(`${b.kind}:${b.group_id ?? ""}`)?.rank ?? null,
    }));

  const headline = result.duplicate
    ? "Already logged"
    : result.is_pr
      ? "New personal record"
      : result.is_first
        ? "First lift logged"
        : "Lift saved";

  // The first lift is already celebrated above; other achievements get a quiet chip.
  const newAchievements = (result.achievements ?? []).filter((a) => a.id !== "first_lift");
  const passedNames = result.passed.map((p) => `@${p.username}`);
  const firstBoard = result.boards.find((b) => b.rank != null);
  const boardHref = `/leaderboards?exercise=${exercise.slug}${firstBoard?.kind === "group" ? `&scope=groups&group=${firstBoard.group_id}` : ""}`;

  return (
    <div className="pt-2" aria-live="polite">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        className="glass relative overflow-hidden rounded-[26px] p-6"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: result.is_pr
              ? "radial-gradient(80% 90% at 100% 0%, rgba(181,160,255,0.38), rgba(181,160,255,0) 65%), radial-gradient(70% 90% at 0% 110%, rgba(255,170,140,0.30), rgba(245,166,200,0.10) 50%, rgba(245,166,200,0) 75%)"
              : "radial-gradient(75% 110% at 95% 0%, rgba(169,215,255,0.22), rgba(169,215,255,0) 65%)",
          }}
        />
        <div className="relative">
          {result.is_pr ? (
            <p className="pearl inline-flex rounded-full px-3 py-1 text-sm font-semibold">
              {headline}
            </p>
          ) : (
            <p className="text-lg font-semibold text-fg-2">{headline}</p>
          )}
          <p className="mt-5 font-medium text-fg-2">{exercise.name}</p>
          <motion.p
            initial={reduce || !result.is_pr ? false : { scale: 0.92 }}
            animate={{ scale: 1 }}
            transition={{
              type: "spring",
              stiffness: 380,
              damping: 18,
              delay: 0.08,
            }}
            className={cn(
              "num text-[64px] leading-none mt-1",
              result.is_pr && "pearl-text",
            )}
          >
            {liftText}
          </motion.p>
          {e1rm ? (
            <p
              className={
                result.is_pr ? "mt-3 font-medium text-fg" : "mt-3 text-fg-2"
              }
            >
              Estimated 1RM {e1rm}
            </p>
          ) : null}
          {!result.is_ranked && exercise.ranking_method !== "max_reps" ? (
            <p className="mt-3 text-fg-2">
              Saved to your history. Sets over 12 reps don’t count for rankings.
            </p>
          ) : null}
          {result.duplicate ? (
            <p className="mt-3 text-fg-2">
              You logged this exact lift in the last few minutes, so it wasn’t
              added twice.
            </p>
          ) : null}
        </div>
      </motion.div>

      {moves.length > 0 ? (
        <ul className="mt-4 glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06]">
          {moves.map((m) => {
            const improved =
              m.before != null && m.rank != null && m.rank < m.before;
            return (
              <li
                key={`${m.kind}${m.group_id}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5"
              >
                <span className="min-w-0 truncate text-fg-2">
                  {m.kind === "friends" ? "Friends" : m.group_name}
                </span>
                {m.total != null && m.total <= 1 ? (
                  <span className="shrink-0 text-sm font-medium text-fg-3">
                    Just you so far
                  </span>
                ) : (
                  <span className="num text-xl shrink-0">
                    {improved ? (
                      <>
                        <span className="text-fg-3">#{m.before}</span>
                        <span
                          className="mx-1.5 text-fg-3 font-medium"
                          aria-label="to"
                        >
                          ›
                        </span>
                        <motion.span
                          className="text-fg inline-block"
                          initial={reduce ? false : { y: 8, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ delay: 0.2, duration: 0.25 }}
                        >
                          #{m.rank}
                        </motion.span>
                      </>
                    ) : (
                      <span>#{m.rank}</span>
                    )}
                    <span className="ml-1.5 text-sm font-medium text-fg-3">
                      of {m.total}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : result.is_ranked && !result.duplicate ? (
        <p className="mt-4 text-fg-2">
          This lift is private, so it only counts toward your PRs.
        </p>
      ) : null}

      {passedNames.length > 0 ? (
        <p className="mt-4 text-lg font-semibold">
          You passed {joinNames(passedNames)}.
        </p>
      ) : null}
      {result.champion_of.length > 0 ? (
        <p className="mt-2 text-lg font-semibold text-fg">
          You’re now #1 in{" "}
          {result.champion_of.map((c) => c.group_name).join(", ")}.
        </p>
      ) : null}
      {result.gym_records?.length ? (
        <p className="mt-2 text-lg font-semibold text-fg">
          You hold the {exercise.name} record at {result.gym_records.map((g) => g.gym_name).join(", ")}.
        </p>
      ) : null}
      {newAchievements.length ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="New achievements">
          {newAchievements.map((a) => (
            <li key={a.id} className="glass-flat rounded-full px-3 py-1.5 text-sm" title={a.description}>
              <span className="font-semibold text-fg">{a.name}</span>
              <span className="text-fg-3"> · new achievement</span>
            </li>
          ))}
        </ul>
      ) : null}

      {actions ? (
        <div className="mt-6 grid grid-cols-2 gap-3">{actions}</div>
      ) : result.is_pr && !result.duplicate ? (
        <div className="mt-6 space-y-3">
          <SharePrButton liftId={result.lift_id} exerciseName={exercise.name} />
          <Button asChild variant="secondary" size="lg" block>
            <Link href={boardHref}>View leaderboard</Link>
          </Button>
          <button
            type="button"
            onClick={onLogAnother}
            className="mx-auto block py-2 text-sm font-medium text-fg-2 hover:text-fg"
          >
            Log another
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button asChild variant="secondary" size="lg">
            <Link href={boardHref}>View leaderboard</Link>
          </Button>
          <Button size="lg" onClick={onLogAnother}>
            Log another
          </Button>
        </div>
      )}
    </div>
  );
}
