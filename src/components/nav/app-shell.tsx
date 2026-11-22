"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChartLine, Dumbbell, Trophy, User, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { AmbientBackground } from "@/components/ui/glass";
import { cn } from "@/lib/cn";
import { Logo } from "./logo";
import { KeyboardFix } from "./keyboard-fix";
import { NavSpeed } from "./nav-speed";
import { OfflineBanner } from "./offline-banner";

type Props = { username: string; userId: string; displayName: string | null; avatarPath: string | null; unread: number; stamp: string; children: React.ReactNode };

// Training-first: Training | Progress | Boards | Friends. Training (the default
// landing page) is the emphasized tab. Competition is one tab, Boards, which
// also holds Groups and the competitive Submit Lift flow (/lift). Profile is the
// header avatar on phones (sidebar on desktop); notifications and friends'
// activity sit behind the bell.
const TABS = [
  { href: "/training", label: "Training", icon: Dumbbell, match: ["/training"], primary: true },
  { href: "/progress", label: "Progress", icon: ChartLine, match: ["/progress", "/home"] },
  { href: "/leaderboards", label: "Leaderboards", short: "Boards", icon: Trophy, match: ["/leaderboards", "/groups", "/lift"] },
  { href: "/friends", label: "Friends", icon: Users, match: ["/friends"] },
];
const PROFILE = { href: "/profile", label: "Profile", icon: User, match: ["/profile", "/u/", "/settings", "/lifts"] };
const SIDEBAR_TABS = TABS;

function isActive(pathname: string, match: string[]) {
  return match.some((m) => pathname === m || pathname.startsWith(m.endsWith("/") ? m : `${m}/`));
}

export function AppShell({ username, userId, displayName, avatarPath, unread, stamp, children }: Props) {
  const pathname = usePathname();
  // Straight to your profile page (/profile would redirect there: one extra round trip on every visit).
  const profileHref = `/u/${encodeURIComponent(username)}`;

  return (
    <div className="relative isolate min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <AmbientBackground />
      <KeyboardFix />
      <NavSpeed userId={userId} stamp={stamp} tabs={["/training", "/progress", "/leaderboards", "/friends", profileHref]} />

      {/* Desktop: compact frosted sidebar */}
      <aside className="hidden md:flex sticky top-0 h-dvh flex-col border-r border-white/[0.06] bg-white/[0.015] px-3.5 py-6">
        <div className="mb-8 flex items-center justify-between pl-2">
          <Link href="/training" aria-label="SBLift home">
            <Logo />
          </Link>
          <BellLink unread={unread} active={isActive(pathname, ["/notifications", "/activity"])} />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {[...SIDEBAR_TABS, PROFILE].map((t) => {
            const active = isActive(pathname, t.match);
            return (
              <Link
                key={t.href}
                href={t === PROFILE ? profileHref : t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[15px] font-medium transition-colors",
                  active ? "bg-white/[0.07] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-fg-2 hover:bg-white/[0.04] hover:text-fg",
                )}
              >
                <t.icon size={18} strokeWidth={active ? 2.2 : 1.9} />
                {t.label}
                {active ? <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-pearl" /> : null}
              </Link>
            );
          })}
        </nav>
        <p className="mt-auto px-3 text-sm text-fg-3 truncate">@{username}</p>
      </aside>

      <div className="min-w-0">
        <OfflineBanner />
        {/* Phones: logo, notifications and your profile, on every page. */}
        <header className="mx-auto flex w-full max-w-[600px] items-center justify-between px-4 pt-safe md:hidden">
          <Link href="/training" aria-label="SBLift home" className="py-3">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <BellLink unread={unread} active={isActive(pathname, ["/notifications", "/activity"])} />
            <Link
              href={profileHref}
              aria-label="Your profile"
              aria-current={isActive(pathname, PROFILE.match) ? "page" : undefined}
              className={cn("rounded-full p-0.5 ring-2", isActive(pathname, PROFILE.match) ? "ring-pearl/80" : "ring-transparent")}
            >
              <Avatar name={displayName || username} seed={userId} path={avatarPath} size={34} />
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[600px] px-4 pb-nav md:pb-16 md:pt-10">{children}</main>
      </div>

      {/* Mobile: floating frosted tab bar */}
      <nav
        aria-label="Main"
        className="mobile-tabs md:hidden fixed inset-x-3 z-40"
        style={{ bottom: "calc(10px + var(--safe-bottom))" }}
      >
        <ul className="glass grid h-[var(--nav-height)] grid-cols-4 rounded-[26px] px-1">
          {TABS.map((t) => {
            const active = isActive(pathname, t.match);
            return (
              <li key={t.href} className="flex">
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={t.label}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                    active ? "text-fg" : "text-fg-3",
                  )}
                >
                  {t.primary ? (
                    // Training stands out with a soft pill behind its icon (bright when active), not an oversized button.
                    <span
                      className={cn(
                        "flex h-8 w-12 items-center justify-center rounded-full transition-colors",
                        active ? "pearl text-accent-ink" : "bg-white/[0.09] text-fg",
                      )}
                    >
                      <t.icon size={20} strokeWidth={active ? 2.3 : 2} />
                    </span>
                  ) : (
                    // Same height as Training's pill, so every label sits on one line.
                    <span className="flex h-8 items-center">
                      <t.icon size={21} strokeWidth={active ? 2.2 : 1.8} />
                    </span>
                  )}
                  <span className={cn("flex items-center gap-1", t.primary && "font-semibold text-fg")}>{t.short ?? t.label}</span>
                  <span aria-hidden className={cn("h-1 w-1 rounded-full", active && !t.primary ? "bg-pearl" : "bg-transparent")} />

                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function BellLink({ unread, active = false }: { unread: number; active?: boolean }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/[0.06] hover:text-fg",
        active ? "bg-white/[0.07] text-fg" : "text-fg-2",
      )}
    >
      <Bell size={20} strokeWidth={1.9} />
      {unread > 0 ? (
        <span className="pearl absolute -top-0.5 -right-0.5 h-[18px] min-w-[18px] rounded-full px-1 text-center text-[11px] font-bold leading-[18px] tabular">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
