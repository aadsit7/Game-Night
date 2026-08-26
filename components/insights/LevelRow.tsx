"use client";

import { ChevronRight } from "lucide-react";

import { FlagChip } from "@/components/ui/FlagChip";
import type { InsightMetric, LevelTally } from "@/lib/insights/insights";

/** Continents wear initials where countries wear flags. */
export const CONTINENT_INITIALS: Record<string, string> = {
  Africa: "AF",
  Antarctica: "AN",
  Asia: "AS",
  Europe: "EU",
  "North America": "NA",
  Oceania: "OC",
  "South America": "SA",
  Elsewhere: "…",
};

/**
 * One country or continent on the rollup, with a bar for how much of your
 * travelling it holds.
 *
 * The bar is the change that matters on a phone: a column of "4 places · 9
 * visits · 21 days" is a table you have to read to compare, and a row of bars
 * is a shape you compare without reading. The numbers stay — they are the
 * exact answer — but they are no longer the only one.
 */
export function LevelRow({
  row,
  level,
  lead,
  share,
  onPress,
}: {
  row: LevelTally;
  level: "country" | "continent";
  /** Which number the caption leads with — the one the ranking used. */
  lead: InsightMetric;
  /** This row's weight against the biggest row, 0–1. */
  share: number;
  onPress: () => void;
}) {
  const visitsPart = row.stays === 1 ? "1 visit" : `${row.stays} visits`;
  const daysPart = row.days > 0 ? `${row.days} ${row.days === 1 ? "day" : "days"}` : null;
  const caption = [
    row.places === 1 ? "1 place" : `${row.places} places`,
    ...(lead === "days" ? [daysPart, visitsPart] : [visitsPart, daysPart]),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onPress}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-fill-strong"
    >
      {level === "country" ? (
        <FlagChip countryCode={row.code} />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent"
        >
          {CONTINENT_INITIALS[row.label] ?? "…"}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {row.label}
          </span>
          <span className="shrink-0 text-[13px] font-semibold leading-tight tabular-nums text-ink-2">
            {lead === "days" ? row.days : row.stays}
          </span>
        </span>
        <span className="mt-[3px] block truncate text-[13px] leading-tight text-ink-3">
          {caption}
        </span>
        <span
          aria-hidden="true"
          className="mt-2 block h-[5px] w-full overflow-hidden rounded-pill bg-fill-strong"
        >
          <span
            className="block h-full rounded-pill bg-accent"
            style={{ width: `${Math.max(3, share * 100)}%` }}
          />
        </span>
      </span>

      <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-ink-3" />
    </button>
  );
}
