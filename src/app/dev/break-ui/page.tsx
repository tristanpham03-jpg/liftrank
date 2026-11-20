import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/data";
import { ActiveSession } from "@/app/(app)/training/active-session";
import { MyExercisesList } from "@/app/(app)/training/exercises/my-exercises";
import { STATES, exercisesFixture, sessionFixture, type State } from "./fixtures";

// Decided per request (the dev flag is read at runtime, never baked in at build).
export const dynamic = "force-dynamic";

/**
 * Dev-only: the session logger and My Exercises with demo vs worst-case data
 * (`/dev/break-ui?data=worst&view=session`). Not available in production builds
 * unless LR_DEV_ROUTES=1 is set (local test runs only).
 */
export default async function BreakUiPage({ searchParams }: { searchParams: Promise<{ data?: string; view?: string; dir?: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.LR_DEV_ROUTES !== "1") notFound();
  const { data, view, dir } = await searchParams;
  const state: State = STATES.includes(data as State) ? (data as State) : "demo";
  const screen = view === "exercises" ? "exercises" : "session";
  const catalog = await getCatalog();
  const byId = new Map(catalog.map((e) => [e.slug, e]));
  const label: Record<State, string> = { demo: "Demo data", worst: "Worst case", empty: "Empty", one: "One", huge: "Huge" };
  const href = (d: State, v = screen) => `/dev/break-ui?data=${d}&view=${v}`;

  let body: React.ReactNode;
  if (screen === "session") {
    const f = sessionFixture(state, byId);
    body = (
      <ActiveSession
        key={state}
        session={{ id: `00000000-0000-4000-8000-0000000000b${STATES.indexOf(state)}`, dayName: f.dayName, startedAt: "2026-11-20T17:05:00Z", draft: f.draft, version: 1 }}
        routine={f.routine}
        catalog={catalog}
        unit="lb"
        recentIds={[]}
        favoriteIds={[]}
        previous={f.previous}
        notes={f.notes}
      />
    );
  } else {
    body = <MyExercisesList key={state} mine={exercisesFixture(state, catalog)} catalog={catalog} recentIds={[]} favoriteIds={[]} hasActiveSession={state !== "empty"} />;
  }

  const seg = "rounded-full px-3 py-1.5 text-[12px] font-medium";
  return (
    <div className="min-h-dvh pb-40" dir={dir === "rtl" ? "rtl" : undefined}>
      <main className="mx-auto w-full max-w-[600px] px-4 pt-4">{body}</main>
      {/* Dev chrome: plain on purpose, not part of the design under test. */}
      <div className="fixed inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-1.5" style={{ fontFamily: "system-ui" }} data-testid="break-ui-toggle">
        <div className="flex rounded-full bg-[#e5e5e5] p-0.5 text-black shadow">
          {(["session", "exercises"] as const).map((v) => (
            <Link key={v} href={href(state, v)} className={`${seg} ${v === screen ? "bg-white" : "text-black/60"}`}>
              {v === "session" ? "Session" : "My Exercises"}
            </Link>
          ))}
        </div>
        <div className="flex rounded-full bg-[#e5e5e5] p-0.5 text-black shadow">
          {STATES.map((s) => (
            <Link key={s} href={href(s)} className={`${seg} ${s === state ? "bg-white" : "text-black/60"}`}>
              {label[s]}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
