import Link from "next/link";
import { Logo } from "@/components/nav/logo";
import { Button } from "@/components/ui/button";
import { LandingBoard } from "@/components/landing/landing-board";
import { AmbientBackground } from "@/components/ui/glass";

const TAGLINE = "Built by lifters. Driven by science.";

const STEPS = [
  { title: "Log your lift", body: "Pick the exercise, enter weight and reps. No workout to start, no routine to build." },
  { title: "See your rank", body: "You land on the board right away: your friends and each of your groups." },
  { title: "Compete with friends", body: "Start a group, share one link, and every lift becomes a contest." },
];

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return (
    <div className="relative isolate min-h-dvh pt-safe">
      <AmbientBackground />
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">
              {/* The original iPhone SE is 320 px wide: the full label doesn't fit beside the logo there. */}
              <span className="min-[360px]:hidden">Join</span>
              <span className="hidden min-[360px]:inline">Start competing</span>
            </Link>
          </Button>
        </nav>
      </header>

      {deleted ? (
        <p role="status" className="mx-auto max-w-[1080px] px-4 text-fg-2">
          Your account has been deleted.
        </p>
      ) : null}

      <main>
        <section className="mx-auto grid max-w-[1080px] gap-14 px-4 pt-10 pb-24 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-20">
          <div className="animate-rise">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-fg-3">{TAGLINE}</p>
            <h1 className="pearl-text font-bold leading-[0.95] tracking-[-0.045em] text-[clamp(3rem,9vw,5.5rem)]">
              Every lift is a leaderboard.
            </h1>
            <p className="mt-6 max-w-[34ch] text-xl leading-relaxed text-fg-2">
              Compete with friends. Claim gym records. See how strong you really are.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="xl">
                <Link href="/signup">Start competing</Link>
              </Button>
              <Button asChild size="xl" variant="secondary">
                <a href="#how">See how it works</a>
              </Button>
            </div>
          </div>

          <LandingBoard />
        </section>

        <section id="how">
          <div className="mx-auto max-w-[1080px] px-4 pb-14 pt-16">
            <h2 className="text-[clamp(2rem,5vw,3rem)] font-bold tracking-[-0.035em] leading-[1.02] max-w-[16ch]">
              Five seconds to log. A reason to come back.
            </h2>
            <ol className="mt-12 grid gap-3 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="glass rounded-[var(--radius-panel)] p-6">
                  <span className="num pearl-text text-[32px] leading-none">{i + 1}</span>
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-fg-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-[1080px] gap-6 px-4 py-6 md:grid-cols-3 md:gap-10">
            {[
              {
                t: "Honest about machines",
                b: "Every exercise has one way to count weight, shown right under the field, so a leg press isn’t compared per side against total.",
              },
              {
                t: "Private by choice",
                b: "Share a lift with everyone, your friends, one group, or nobody. Private lifts still count toward your own PRs.",
              },
              {
                t: "Real lifters only",
                b: "Every ranking comes from people who actually logged a lift. Small boards show ranks, not made-up percentages.",
              },
            ].map((f) => (
              <div key={f.t} className="border-l border-white/10 pl-4">
                <h3 className="font-semibold">{f.t}</h3>
                <p className="mt-1 text-sm text-fg-2">{f.b}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-[1080px] px-4 py-24 text-center">
            <p className="pearl-text font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(2.5rem,7vw,4.25rem)]">Where do you rank?</p>
            <p className="mx-auto mt-5 max-w-[46ch] text-fg-2">
              SBLift is made for the SBL community: log your sessions, follow your own progress, and compete on SBLift boards when you want to.
            </p>
            <Button asChild size="xl" className="mt-9">
              <Link href="/signup">Start competing</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-8 text-sm text-fg-3">
          <Logo size={18} />
          <span>Built for people who lift.</span>
        </div>
      </footer>
    </div>
  );
}
