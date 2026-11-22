import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-4">
      <p className="num text-[72px] leading-none text-fg-3">404</p>
      <h1 className="mt-4 text-[28px] font-bold tracking-[-0.025em]">This page doesn’t exist, or you can’t see it.</h1>
      <p className="mt-2 text-fg-2">Private lifts and groups only show up for the people they’re shared with.</p>
      <Button asChild size="lg" className="mt-8 self-start">
        <Link href="/training">Go to Training</Link>
      </Button>
    </main>
  );
}
