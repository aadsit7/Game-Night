"use client";

import { Check } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { cn } from "@/lib/utils/cn";
import type { InsightMetric } from "@/lib/insights/insights";

/**
 * The whole lens, in one sheet.
 *
 * It lived on the screen: a segmented control, a rail of years and a rail of
 * trip types, three rows deep, above the first number anyone came to read. On
 * a phone that is a third of the screen spent on controls. The year rail stays
 * out there — it is the one people move constantly — and everything else comes
 * here, one tap away, with the button that opens it wearing a dot when it
 * holds something.
 */
export function StatsFilterSheet({
  open,
  onClose,
  metric,
  onMetricChange,
  year,
  onYearChange,
  years,
  continent,
  onContinentChange,
  continents,
  tripType,
  onTripTypeChange,
  tripTypes,
}: {
  open: boolean;
  onClose: () => void;
  metric: InsightMetric;
  onMetricChange: (metric: InsightMetric) => void;
  year: number | null;
  onYearChange: (year: number | null) => void;
  years: number[];
  continent: string | null;
  onContinentChange: (continent: string | null) => void;
  /** The continents you have been to; a chip for one you haven't is a dead end. */
  continents: string[];
  tripType: string | null;
  onTripTypeChange: (tripType: string | null) => void;
  tripTypes: string[];
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Filter your stats"
      header={
        <div className="flex items-center justify-between pb-2 pt-1">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            data-autofocus
            className="pressable min-h-9 rounded-pill px-2 text-[16px] font-medium text-accent"
          >
            Done
          </button>
        </div>
      }
    >
      <section aria-labelledby="metric-heading" className="pb-2">
        <Heading id="metric-heading">Rank by</Heading>
        <div className="overflow-hidden rounded-md bg-fill">
          <Row
            label="Visits"
            detail="How often you went"
            selected={metric === "stays"}
            onPress={() => onMetricChange("stays")}
          />
          <Row
            label="Days"
            detail="How long you stayed"
            selected={metric === "days"}
            first={false}
            onPress={() => onMetricChange("days")}
          />
        </div>
      </section>

      {continents.length > 1 ? (
        <section aria-labelledby="region-heading" className="pt-4">
          <Heading id="region-heading">Part of the world</Heading>
          <div className="flex flex-wrap gap-2">
            <Chip active={continent === null} onPress={() => onContinentChange(null)}>
              Anywhere
            </Chip>
            {continents.map((option) => (
              <Chip
                key={option}
                active={continent === option}
                onPress={() => onContinentChange(continent === option ? null : option)}
              >
                {option}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}

      {tripTypes.length > 0 ? (
        <section aria-labelledby="trip-type-heading" className="pt-4">
          <Heading id="trip-type-heading">Kind of trip</Heading>
          <div className="flex flex-wrap gap-2">
            <Chip active={tripType === null} onPress={() => onTripTypeChange(null)}>
              Any trip
            </Chip>
            {tripTypes.map((option) => (
              <Chip
                key={option}
                active={tripType === option}
                onPress={() => onTripTypeChange(tripType === option ? null : option)}
              >
                {option}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}

      {years.length > 0 ? (
        <section aria-labelledby="year-heading" className="pb-3 pt-4">
          <Heading id="year-heading">Year</Heading>
          <div className="flex flex-wrap gap-2">
            <Chip active={year === null} onPress={() => onYearChange(null)}>
              All time
            </Chip>
            {years.map((option) => (
              <Chip
                key={option}
                active={year === option}
                onPress={() => onYearChange(year === option ? null : option)}
              >
                {option}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}
    </BottomSheet>
  );
}

function Heading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="px-1 pb-1.5 pt-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3"
    >
      {children}
    </h3>
  );
}

/** A settings row, the shape iOS gives a single choice out of a short list. */
function Row({
  label,
  detail,
  selected,
  first = true,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[50px] w-full items-center justify-between gap-3 px-4 text-left",
        "transition-colors active:bg-fill-strong",
        !first && "border-t border-separator",
      )}
    >
      <span className="min-w-0">
        <span
          className={cn("block truncate text-[16px] text-ink", selected && "font-medium")}
        >
          {label}
        </span>
        <span className="block truncate text-[13px] text-ink-3">{detail}</span>
      </span>
      {selected ? (
        <Check size={18} aria-hidden="true" className="shrink-0 text-accent" />
      ) : null}
    </button>
  );
}

function Chip({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={cn(
        "pressable inline-flex min-h-10 max-w-full items-center rounded-pill px-3.5",
        "text-[15px] tabular-nums transition-colors",
        active ? "bg-accent font-medium text-on-accent" : "bg-fill text-ink",
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}
