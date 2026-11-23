import Link from "next/link";
import { cn } from "@/lib/cn";
import { BackButton } from "@/components/nav/back-button";

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("glass rounded-[var(--radius-panel)]", className)} {...props} />;
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 mb-3 px-1", className)}>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{children}</h2>
      {action}
    </div>
  );
}

/** `back`: where Back goes when there's no app page behind this one (nested pages only). */
export function PageHeader({ title, subtitle, action, back }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; back?: string }) {
  return (
    <>
    {back ? <BackButton fallback={back} /> : null}
    <header className={cn("flex items-start justify-between gap-4 mb-7", back ? "pt-0" : "pt-2")}>
      <div className="min-w-0">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em]">{title}</h1>
        {subtitle ? <p className="mt-1 text-fg-2">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
    </>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass-flat rounded-[var(--radius-panel)] px-5 py-9 text-center", className)}>
      <p className="font-semibold text-fg">{title}</p>
      {body ? <p className="mt-1 text-sm text-fg-2 max-w-sm mx-auto">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function TabLinks({
  items,
  className,
}: {
  items: { href: string; label: string; active: boolean; disabled?: boolean }[];
  className?: string;
}) {
  return (
    <nav className={cn("glass-flat flex gap-1 rounded-full p-1", className)}>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          scroll={false}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "flex-1 text-center rounded-full px-3 py-2 text-sm font-semibold transition-colors",
            item.active ? "pearl" : "text-fg-2 hover:text-fg",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "success" | "warning"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "neutral" && "bg-white/[0.07] text-fg-2 border border-white/10",
        tone === "accent" && "pearl",
        tone === "success" && "bg-success/15 text-success",
        tone === "warning" && "bg-warning/15 text-warning",
      )}
    >
      {children}
    </span>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mb-5 rounded-[var(--radius-control)] bg-success/10 px-3.5 py-3 text-sm text-success">
      {children}
    </p>
  );
}
