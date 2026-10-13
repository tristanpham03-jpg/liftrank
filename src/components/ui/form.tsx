import { cn } from "@/lib/cn";

const control =
  "w-full bg-white/[0.045] border border-white/10 text-fg placeholder:text-fg-3 rounded-[var(--radius-control)] px-4 outline-none transition-colors hover:border-white/15 focus:border-white/40 focus:bg-white/[0.07] focus-visible:outline-none aria-[invalid=true]:border-danger/70 disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, "h-12 text-base", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-3 text-base resize-none", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(control, "h-12 text-base appearance-none", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-fg-2 mb-1.5", className)} {...props} />;
}

export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger">
      {children}
    </p>
  );
}

export function FormMessage({ tone = "error", children }: { tone?: "error" | "success" | "info"; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius-control)] px-3.5 py-3 text-sm",
        tone === "error" && "bg-danger/10 text-danger",
        tone === "success" && "bg-success/10 text-success",
        tone === "info" && "bg-white/[0.05] text-fg-2",
      )}
    >
      {children}
    </p>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-sm text-fg-3">{children}</p>;
}
