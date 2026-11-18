export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="pt-6 space-y-4 animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-white/[0.04]" />
      <div className="h-14 rounded-[var(--radius-control)] bg-white/[0.04]" />
      <div className="h-64 rounded-[var(--radius-panel)] bg-white/[0.04]" />
    </div>
  );
}
