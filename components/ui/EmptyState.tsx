"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Empty states are moments, not errors — a quiet illustration, a warm line,
 * and exactly one thing to do next.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-8 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-5 grid size-16 place-items-center rounded-[22px] bg-fill text-ink-2"
        >
          {icon}
        </div>
      ) : null}

      <h2 className="text-balance text-[22px] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>

      {description ? (
        <p className="mt-2 max-w-[34ch] text-balance text-[15px] leading-relaxed text-ink-2">
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
