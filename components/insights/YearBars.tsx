"use client";

import { cn } from "@/lib/utils/cn";
import type { YearTally } from "@/lib/insights/dashboard";
import type { InsightMetric } from "@/lib/insights/insights";

/**
 * The shape of a travelling life, one column per year.
 *
 * The grid below this says *where* each year went; this says *how much*, which
 * is the question a phone can answer in one glance and a matrix of numbers
 * cannot. Each column is also the year filter — tapping 2024 puts the whole
 * tab in 2024 and tapping it again comes back out — so the chart is a way
 * through the journal rather than a picture of it.
 *
 * Columns hold a minimum width and the row scrolls, so a twenty-year history
 * stays touchable instead of collapsing into hairlines.
 */
export function YearBars({
  years,
  metric,
  selected,
  onSelect,
}: {
  years: YearTally[];
  metric: InsightMetric;
  selected: number | null;
  onSelect: (year: number | null) => void;
}) {
  const valueOf = (row: YearTally) => (metric === "days" ? row.days : row.trips);
  const most = Math.max(...years.map(valueOf), 1);
  const unit = metric === "days" ? "days" : "trips";

  return (
    <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
      {years.map((row) => {
        const value = valueOf(row);
        const active = selected === row.year;
        return (
          <button
            key={row.year}
            type="button"
            onClick={() => onSelect(active ? null : row.year)}
            aria-pressed={active}
            aria-label={`${row.year}: ${value} ${unit}, ${row.countries} ${
              row.countries === 1 ? "country" : "countries"
            }${row.newCountries > 0 ? `, ${row.newCountries} new` : ""}`}
            className="pressable flex min-w-[42px] flex-1 flex-col items-center gap-1 rounded-[12px] pb-1 pt-1.5 transition-colors"
          >
            <span
              className={cn(
                "text-[11px] font-semibold leading-none tabular-nums",
                active ? "text-accent" : "text-ink-3",
              )}
            >
              {value}
            </span>

            <span aria-hidden="true" className="flex h-[76px] w-full items-end">
              <span
                className={cn(
                  "relative w-full rounded-[6px]",
                  active ? "bg-accent" : "bg-accent/40",
                )}
                style={{ height: `${Math.max(6, (value / most) * 100)}%` }}
              >
                {/* A year that added a country wears a dot: the one thing about
                    a year that a bar's height can never say. */}
                {row.newCountries > 0 ? (
                  <span
                    className={cn(
                      "absolute -top-[5px] left-1/2 size-[5px] -translate-x-1/2 rounded-full",
                      active ? "bg-accent" : "bg-accent/70",
                    )}
                  />
                ) : null}
              </span>
            </span>

            <span
              className={cn(
                "text-[11px] leading-none tabular-nums",
                active ? "font-semibold text-accent" : "text-ink-3",
              )}
            >
              ’{String(row.year).slice(2)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
