import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,color,transform,opacity,box-shadow,filter] duration-150 active:scale-[0.98] active:opacity-100 disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        // Pearlescent white with near-black text: the only "loud" control in the app.
        primary: "pearl hover:brightness-[1.03] active:brightness-95",
        // Translucent charcoal.
        secondary: "bg-white/[0.06] text-fg border border-white/10 hover:bg-white/[0.1]",
        ghost: "text-fg-2 hover:text-fg hover:bg-white/[0.06]",
        danger: "bg-transparent text-danger border border-danger/35 hover:bg-danger/10",
      },
      size: {
        sm: "h-9 px-3.5 text-sm rounded-[11px]",
        md: "h-11 px-4 text-[15px] rounded-[var(--radius-control)]",
        lg: "h-12 px-5 text-base rounded-[var(--radius-control)]",
        xl: "h-14 px-6 text-[17px] rounded-[18px] tracking-tight",
        icon: "h-10 w-10 rounded-full",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, block, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
}

/** Primary pearl action. Same as <Button variant="primary">. */
export function PearlButton(props: Omit<ButtonProps, "variant">) {
  return <Button {...props} variant="primary" />;
}
