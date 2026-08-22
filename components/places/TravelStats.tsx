"use client";

import { FlagChip } from "@/components/ui/FlagChip";
import { cn } from "@/lib/utils/cn";

/**
 * How much of the world, and which of it.
 *
 * This was three tiles and a progress ring — seventy pixels of chrome to say
 * three short facts, above a rail of flags that says the same thing better. A
 * line of text carries the figures now, and the countries themselves carry the
 * coverage: nine flags reads as "nine countries" without anyone counting, and
 * tapping one filters the list, so the row is a way through the collection
 * rather than a trophy shelf.
 */

export type CountryTally = { key: string; label: string; code?: string; count: number };

/** UN member states plus the two observers; the usual denominator. */
const COUNTRIES_IN_THE_WORLD = 195;

export function TravelStats({
  visited,
  countries,
  collected = [],
  selected = null,
  onSelect,
}: {
  /** Places actually been to — the wishlist is counted on its own chip. */
  visited: number;
  countries: number;
  /** Every country with a place in it, most-visited first. */
  collected?: CountryTally[];
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const coverage = Math.min(100, (countries / COUNTRIES_IN_THE_WORLD) * 100);
  const share = coverage > 0 && coverage < 1 ? "<1%" : `${Math.round(coverage)}%`;

  return (
    <div>
      <p className="text-[14px] text-ink-2">
        {/* "Visited", not "places": the wishlist is not somewhere you have been,
            and this figure has never counted it. */}
        <Figure value={visited} label="visited" />
        <Dot />
        <Figure value={countries} label={countries === 1 ? "country" : "countries"} />
        <Dot />
        <span className="font-semibold tabular-nums text-ink">{share}</span>{" "}
        <span>of the world</span>
      </p>

      {/* One country is not a collection, and a rail of one is just a bullet. */}
      {onSelect && collected.length > 1 ? (
        <div
          role="group"
          aria-label="Filter by country"
          className="scrollbar-none -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-0.5"
        >
          {collected.map((country) => {
            const active = selected === country.key;
            return (
              <button
                key={country.key}
                type="button"
                aria-pressed={active}
                aria-label={`${country.label}, ${country.count} ${
                  country.count === 1 ? "place" : "places"
                }`}
                onClick={() => onSelect(active ? null : country.key)}
                className={cn(
                  "pressable shrink-0 rounded-full transition-shadow",
                  active && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
                )}
              >
                <FlagChip countryCode={country.code} size="md" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <>
      <span className="font-semibold tabular-nums text-ink">{value.toLocaleString()}</span>{" "}
      <span>{label}</span>
    </>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="mx-1.5 text-ink-3">
      ·
    </span>
  );
}
