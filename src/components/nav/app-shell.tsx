"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Home, Plus, Trophy, User, Users } from "lucide-react";
import { AmbientBackground } from "@/components/ui/glass";
import { cn } from "@/lib/cn";
import { Logo } from "./logo";
import { OfflineBanner } from "./offline-banner";

type Props = { username: string; unread: number; children: React.ReactNode };

// Five destinations, Add Lift in the middle. Groups live under Leaderboards;
// notifications behind the bell. The phone bar uses a shorter label where needed.
const TABS = [
  { href: "/home", label: "Home", icon: Home, match: ["/home", "/notifications", "/activity"] },
  { href: "/leaderboards", label: "Leaderboards", short: "Boards", icon: Trophy, match: ["/leaderboards", "/groups"] },
  { href: "/lift/new", label: "Add Lift", icon: Plus, match: ["/lift"] },
  { href: "/friends", label: "Friends", icon: Users, match: ["/friends"] },
  { href: "/profile", label: "Profile", icon: User, match: ["/profile", "/u/", "/settings", "/lifts"] },
];

function isActive(pathname: string, match: string[]) {
  return match.some((m) => pathname === m || pathname.startsWith(m.endsWith("/") ? m : `${m}/`));
}

export function AppShell({ username, unread, children }: Props) {
  const pathname = usePathname();

  return (
    <div className="relative isolate min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <AmbientBackground />

      {/* Desktop: compact frosted sidebar */}
      <aside className="hidden md:flex sticky top-0 h-dvh flex-col border-r border-white/[0.06] bg-white/[0.015] px-3.5 py-6">
        <div className="mb-8 flex items-center justify-between pl-2">
          <Link href="/home" aria-label="LiftRank home">
            <Logo />
          </Link>
          <BellLink unread={unread} />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {TABS.map((t) => {
            const active = isActive(pathname, t.match);
            const isAdd = t.href === "/lift/new";
            if (isAdd) {
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className="pearl my-2 flex items-center gap-3 rounded-[14px] px-3 py-2.5 font-semibold transition-[filter] hover:brightness-[1.03]"
                >
                  <t.icon size={18} strokeWidth={2.6} />
                  {t.label}
                </Link>
              );
            }
            return (
              <Link
                key={t.href}
                href={t.href}
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
        <main className="mx-auto w-full max-w-[600px] px-4 pt-safe pb-nav md:pb-16 md:pt-10">{children}</main>
      </div>

      {/* Mobile: floating frosted tab bar */}
      <nav
        aria-label="Main"
        className="mobile-tabs md:hidden fixed inset-x-3 z-40"
        style={{ bottom: "calc(10px + var(--safe-bottom))" }}
      >
        <ul className="glass grid h-[var(--nav-height)] grid-cols-5 rounded-[26px] px-1">
          {TABS.map((t) => {
            const active = isActive(pathname, t.match);
            const isAdd = t.href === "/lift/new";
            return (
              <li key={t.href} className="flex">
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={t.label}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                    active ? "text-fg" : "text-fg-3",
                  )}
                >
                  {isAdd ? (
                    <span className="pearl flex h-11 w-11 items-center justify-center rounded-full">
                      <t.icon size={22} strokeWidth={2.6} />
                    </span>
                  ) : (
                    <>
                      <t.icon size={21} strokeWidth={active ? 2.2 : 1.8} />
                      <span className="flex items-center gap-1">
                        {t.short ?? t.label}
                      </span>
                      <span aria-hidden className={cn("h-1 w-1 rounded-full", active ? "bg-pearl" : "bg-transparent")} />
                    </>
                  )}
                  {isAdd ? <span className="sr-only">{t.label}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function BellLink({ unread }: { unread: number }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg"
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
