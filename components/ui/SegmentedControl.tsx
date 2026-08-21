"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

import { cn } from "@/lib/utils/cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
};

/**
 * An iOS segmented control: a single track, a sliding thumb, and labels that
 * are always legible — never a row of buttons that only reveal state on hover.
 *
 * For picking one value out of a small set. Navigation is a tab bar and lives
 * in `AppTabBar`, which is a different thing wearing a similar shape.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const groupId = useId();

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative flex items-center gap-1 rounded-pill p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative isolate flex min-h-11 flex-1 items-center justify-center gap-1.5",
              "rounded-pill px-4 text-[15px] font-semibold transition-colors duration-200",
              active ? "text-ink" : "text-ink-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${groupId}-thumb`}
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-pill bg-surface-2 shadow-soft"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
                }
              />
            )}
            {option.icon ? (
              <span aria-hidden="true" className="shrink-0">
                {option.icon}
              </span>
            ) : null}
            {/*
              Never truncated. A segment reading "Cou…" tells nobody anything;
              if the labels do not fit, the control is too narrow and that is
              what needs fixing.
            */}
            <span className="whitespace-nowrap">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
