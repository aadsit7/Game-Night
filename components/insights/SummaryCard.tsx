"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { DashboardTotals } from "@/lib/insights/dashboard";
import type { InsightMetric } from "@/lib/insights/insights";

/**
 * The four numbers the tab exists to say, big enough to read at arm's length.
 *
 * They were a line of small grey type under the title — "12 visits · 43 days
 * away · 6 countries" — which is a caption, not a dashboard. At a glance from a
 * phone in one hand, a figure has to be the largest thing on the screen or it
 * is not a figure at all.
 *
 * Two of the four are also the ranking switch. Everything below this card is
 * ordered by either how often you went or how long you stayed, and the
 * cheapest place to put that choice is on the numbers themselves: tap "Days
 * away" and the boards re-rank behind it. The same switch sits in the filter
 * sheet for anyone who never thinks to try.
 */
export function SummaryCard({
  totals,
  previous,
  metric,
  onMetricChange,
}: {
  totals: DashboardTotals;
  /** Last year's figures, when a year is in the lens. */
  previous: { year: number; totals: DashboardTotals } | null;
  metric: InsightMetric;
  onMetricChange: (metric: InsightMetric) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label="Trips"
          value={totals.trips}
          delta={previous ? { from: previous.totals.trips, year: previous.year } : null}
          ranking={metric === "stays"}
          onPress={() => onMetricChange("stays")}
        />
        <Tile
          label="Days away"
          value={totals.days}
          delta={previous ? { from: previous.totals.days, year: previous.year } : null}
          ranking={metric === "days"}
          onPress={() => onMetricChange("days")}
        />
        <Tile
          label="Countries"
          value={totals.countries}
          delta={previous ? { from: previous.totals.countries, year: previous.year } : null}
        />
        <Tile
          label="Places"
          value={totals.places}
          delta={previous ? { from: previous.totals.places, year: previous.year } : null}
        />
      </div>

      <p className="px-1 pt-1.5 text-[12px] leading-snug text-ink-3">
        Ranking everything below by{" "}
        <span className="font-medium text-ink-2">
          {metric === "days" ? "days" : "visits"}
        </span>
        . Tap {metric === "days" ? "Trips" : "Days away"} to switch.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  delta,
  ranking,
  onPress,
}: {
  label: string;
  value: number;
  delta: { from: number; year: number } | null;
  /** Set on the two tiles that double as the ranking switch. */
  ranking?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "block text-[13px] font-medium leading-none",
          ranking ? "text-accent" : "text-ink-2",
        )}
      >
        {label}
      </span>
      <span className="mt-1.5 block text-[30px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
        {value.toLocaleString()}
      </span>
      {delta ? <Delta value={value} from={delta.from} year={delta.year} /> : null}
    </>
  );

  /* One background class or the other, never both: `cn` joins rather than
     merges, and two competing `bg-` utilities leave the winner to whichever
     Tailwind happened to emit last. */
  const shell = cn(
    "block rounded-[18px] px-3.5 py-3 text-left transition-colors",
    ranking ? "bg-accent-soft" : "bg-fill/60",
  );

  if (!onPress) return <div className={shell}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={ranking}
      aria-label={`${label}: ${value.toLocaleString()}. Rank by ${label.toLowerCase()}.`}
      className={cn("pressable", shell)}
    >
      {body}
    </button>
  );
}

/**
 * This year against last year — the comparison a year on its own cannot make.
 * A rise is the accent, a fall is quiet grey rather than red: fewer days away
 * than last year is a fact about a calendar, not a failure.
 */
function Delta({ value, from, year }: { value: number; from: number; year: number }) {
  if (value === 0 && from === 0) return null;

  const diff = value - from;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  const text =
    diff === 0
      ? `same as ${year}`
      : `${Math.abs(diff).toLocaleString()} ${diff > 0 ? "more" : "fewer"} than ${year}`;

  return (
    <span
      className={cn(
        "mt-1.5 flex items-center gap-0.5 text-[12px] leading-none",
        diff > 0 ? "text-accent" : "text-ink-3",
      )}
    >
      <Icon size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}
