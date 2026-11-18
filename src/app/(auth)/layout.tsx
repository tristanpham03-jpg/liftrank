import Link from "next/link";
import { Logo } from "@/components/nav/logo";
import { AmbientBackground } from "@/components/ui/glass";
import { DropClientCache } from "@/components/nav/drop-client-cache";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh flex flex-col px-4 pt-safe">
      <AmbientBackground />
      <DropClientCache />
      <header className="mx-auto w-full max-w-[420px] py-6">
        <Link href="/" aria-label="SBLift home" className="tap inline-block">
          <Logo />
        </Link>
        <p className="mt-2 text-sm text-fg-3">Built by lifters. Driven by science.</p>
      </header>
      <main className="mx-auto w-full max-w-[420px] flex-1 pb-16 pt-2 md:pt-10">
        <div className="glass animate-rise rounded-[26px] p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
