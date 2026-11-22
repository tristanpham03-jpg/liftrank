import { Logo } from "@/components/nav/logo";

/**
 * Startup only: shown while a fresh page load waits for the signed-in shell
 * (profile, notifications) and the page's data. Streams immediately, no timer
 * or minimum duration; tab-to-tab navigation inside the app uses the smaller
 * in-page skeletons instead, and cached pages never show it.
 */
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Loading SBLift" className="fixed inset-0 flex flex-col items-center justify-center gap-5 bg-bg">
      <Logo size={30} />
      <span aria-hidden className="relative h-[3px] w-16 overflow-hidden rounded-full bg-white/[0.08]">
        <span className="absolute inset-y-0 left-0 w-1/3 animate-[sblift-load_1.1s_ease-in-out_infinite] rounded-full bg-white/50" />
      </span>
    </div>
  );
}
