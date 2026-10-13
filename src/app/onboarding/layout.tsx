import { redirect } from "next/navigation";
import { Logo } from "@/components/nav/logo";
import { AmbientBackground } from "@/components/ui/glass";
import { OfflineBanner } from "@/components/nav/offline-banner";
import { getUserId } from "@/lib/data";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  if (!(await getUserId())) redirect("/login?next=/onboarding");
  return (
    <div className="relative isolate min-h-dvh px-4 pt-safe">
      <AmbientBackground />
      <OfflineBanner />
      <header className="mx-auto w-full max-w-[480px] py-6">
        <Logo />
      </header>
      <main className="mx-auto w-full max-w-[480px] pb-16">{children}</main>
    </div>
  );
}
