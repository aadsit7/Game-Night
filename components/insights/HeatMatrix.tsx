"use client";

import { FlagChip } from "@/components/ui/FlagChip";
import { cn } from "@/lib/utils/cn";
import type { InsightMetric, TravelMatrix } from "@/lib/insights/insights";

/**
 * The busiest countries against the years — a contribution graph for travel.
 *
 * Cell colour is how much; the number says it exactly. Two things make it
 * work on a phone: the flag column is pinned, so a country's row never
 * scrolls away from the numbers in it, and the cells are 38px, which is a
 * touch target rather than a pixel to be aimed at. Wide history scrolls
 * inside the card rather than stretching the page.
 */
export function HeatMatrix({
  matrix,
  metric,
  onCell,
}: {
  matrix: TravelMatrix;
  /** What a cell's colour and number mean: visits there, or days there. */
  metric: InsightMetric;
  onCell: (row: TravelMatrix["rows"][number], year: number) => void;
}) {
  const valueOf = (cell: { stays: number; days: number }) =>
    metric === "days" ? cell.days : cell.stays;
  const most = Math.max(1, ...Array.from(matrix.cells.values()).map(valueOf));
  const unit = metric === "days" ? "day" : "visit";

  return (
    /* A solid surface rather than the translucent fill its sibling cards
       wear: the flag column below is pinned, and a pinned cell can only hide
       what scrolls under it if its background is exactly the card's. */
    <div className="rounded-[18px] bg-surface p-3">
      <div className="scrollbar-none overflow-x-auto">
        <table className="border-separate border-spacing-[3px]">
          <thead>
            <tr>
              {/* Pinned, so the flag stays beside its own numbers. The cell
                  paints its own background or the columns scroll under it —
                  and it is ranked barely above them, never above the page's
                  own pinned bar. */}
              <th aria-label="Country" className="sticky left-0 z-[1] bg-surface" />
              {matrix.years.map((year) => (
                <th
                  key={year}
                  scope="col"
                  className="min-w-[38px] pb-0.5 text-center text-[11px] font-medium tabular-nums text-ink-3"
                >
                  ’{String(year).slice(2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-[1] bg-surface pr-2 text-left"
                >
                  <FlagChip countryCode={row.code} size="md" />
                  <span className="sr-only">{row.label}</span>
                </th>
                {matrix.years.map((year) => {
                  const cell = matrix.cells.get(`${row.key}:${year}`);
                  if (!cell) {
                    return (
                      <td key={year} aria-label={`${row.label} ${year}: nothing`}>
                        <span className="block size-[38px] rounded-[10px] bg-fill" />
                      </td>
                    );
                  }
                  const value = valueOf(cell);
                  const heat = value / most;
                  return (
                    <td key={year}>
                      <button
                        type="button"
                        onClick={() => onCell(row, year)}
                        aria-label={`${row.label} ${year}: ${value} ${
                          value === 1 ? unit : `${unit}s`
                        }`}
                        className="pressable relative grid size-[38px] place-items-center rounded-[10px] bg-fill"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-[10px] bg-accent"
                          style={{ opacity: 0.2 + heat * 0.65 }}
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            "relative text-[12.5px] font-semibold tabular-nums",
                            heat > 0.5 ? "text-on-accent" : "text-ink",
                          )}
                        >
                          {value}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The key every contribution graph needs, and the only place the word
          "less" and "more" belong on this screen. */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span>Less</span>
        {[0.2, 0.4, 0.6, 0.85].map((opacity) => (
          <span
            key={opacity}
            aria-hidden="true"
            className="size-[10px] rounded-[3px] bg-accent"
            style={{ opacity }}
          />
        ))}
        <span>More</span>
        <span className="ml-auto">{metric === "days" ? "days" : "visits"} per year</span>
      </div>
    </div>
  );
}
