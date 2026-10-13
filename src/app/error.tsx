"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notConfigured = error.message.includes("NEXT_PUBLIC_SUPABASE_URL");
  return (
    <main className="mx-auto flex min-h-dvh max-w-[460px] flex-col justify-center px-4">
      <h1 className="text-[28px] font-bold tracking-[-0.025em]">
        {notConfigured ? "LiftRank isn’t connected to a database yet" : "This page didn’t load"}
      </h1>
      <p className="mt-2 text-fg-2">
        {notConfigured
          ? "Add your Supabase URL and publishable key to .env.local, then restart the dev server. SUPABASE_SETUP.md walks through it."
          : "Check your connection and try again. If it keeps happening, sign out and back in."}
      </p>
      {!notConfigured ? (
        <Button size="lg" className="mt-8 self-start" onClick={reset}>
          Try again
        </Button>
      ) : null}
    </main>
  );
}
