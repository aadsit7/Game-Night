"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
};

/** Every tappable control is at least 44px tall — the iOS minimum. */
const SIZES: Record<Size, string> = {
  md: "min-h-11 px-4 text-[15px] rounded-sm",
  lg: "min-h-[52px] px-5 text-[17px] rounded-md",
};

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent font-semibold",
  secondary: "bg-fill text-ink font-medium",
  ghost: "text-accent font-medium",
  destructive: "bg-danger-soft text-danger font-semibold",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "pressable inline-flex items-center justify-center gap-2 whitespace-nowrap",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        SIZES[size],
        VARIANTS[variant],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden="true" size={18} className="animate-spin" />
      ) : icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </button>
  );
});
