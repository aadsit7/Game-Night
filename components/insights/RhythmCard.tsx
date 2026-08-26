"use client";

import { MONTH_NAMES } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { MonthTally } from "@/lib/insights/dashboard";
import type { InsightMetric } from "@/lib/insights/insights";

/**
 * When in the year you go.
 *
 * Twelve bars, one screen-width, no scrolling — the one chart in the app that
 * fits a phone exactly, because the x-axis is a fixed twelve however long you
 * have been travelling. It answers a question the leaderboards can't get near:
 * am I a summer traveller or a February-escape traveller, and is there a month
 * I have never once been away in.
 *
 * The peak is drawn solid and everything else is faded back, so the shape
 * reads before any number does.
 */
export function RhythmCard({
  months,
  metric,
}: {
  months: MonthTally[];
  metric: InsightMetric;
}) {
  const valueOf = (month: MonthTally) => (metric === "days" ? month.days : month.trips);
  const most = Math.max(...months.map(valueOf), 0);
  if (most === 0) return null;

  const unit = metric === "days" ? "days away" : "trips";
  const peak = months.reduce((best, month) =>
    valueOf(month) > valueOf(best) ? month : best,
  );

  return (
    <div className="rounded-[18px] bg-fill/60 p-3.5">
      <div
        role="img"
        aria-label={`${
          metric === "days" ? "Days away" : "Trips"
        } by month: ${months
          .map((month) => `${MONTH_NAMES[month.month]} ${valueOf(month)}`)
          .join(", ")}`}
        className="flex h-[92px] items-end gap-[3px]"
      >
        {months.map((month) => {
          const value = valueOf(month);
          const share = value / most;
          return (
            <span
              key={month.month}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "w-full rounded-[5px] transition-[height]",
                  value === 0
                    ? "bg-fill-strong"
                    : month.month === peak.month
                      ? "bg-accent"
                      : "bg-accent/45",
                )}
                /* A month with nothing in it still gets a sliver, so twelve
                   months always read as twelve columns rather than as a gap. */
                style={{ height: value === 0 ? 3 : `${Math.max(8, share * 100)}%` }}
              />
            </span>
          );
        })}
      </div>

      <div aria-hidden="true" className="mt-1.5 flex gap-[3px]">
        {months.map((month) => (
          <span
            key={month.month}
            className={cn(
              "min-w-0 flex-1 text-center text-[10px] leading-none",
              month.month === peak.month ? "font-semibold text-ink-2" : "text-ink-3",
            )}
          >
            {MONTH_NAMES[month.month].charAt(0)}
          </span>
        ))}
      </div>

      <p className="mt-2.5 text-[13px] leading-snug text-ink-2">
        You travel most in{" "}
        <span className="font-semibold text-ink">{MONTH_NAMES[peak.month]}</span> —{" "}
        <span className="tabular-nums">{valueOf(peak)}</span> {unit}.
      </p>
    </div>
  );
}
