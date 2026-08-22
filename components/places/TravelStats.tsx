"use client";

import { FlagChip } from "@/components/ui/FlagChip";
import { cn } from "@/lib/utils/cn";

/**
 * A small progress read-out, in the spirit of a travel app's "coverage" screen
 * but kept to a single row rather than a tab of its own — the point of this app
 * is still the places, not the scoreboard.
 *
 * Under the numbers, the countries themselves. Three figures say how much of
 * the world you have seen; the rail says *which* of it, in the same chips the
 * globe drops on the Earth — and tapping one filters the list, so the row is a
 * way through the collection rather than a trophy shelf.
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

  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5">
        <Tile value={visited.toLocaleString()} label="Visited" />
        <Tile
          value={countries.toLocaleString()}
          label={countries === 1 ? "Country" : "Countries"}
        />
        <Tile
          value={coverage < 1 && coverage > 0 ? "<1%" : `${Math.round(coverage)}%`}
          label="Of world"
          ring={coverage}
        />
      </div>

      {/* One country is not a collection, and a rail of one is just a bullet. */}
      {onSelect && collected.length > 1 ? (
        <div
          role="group"
          aria-label="Filter by country"
          className="scrollbar-none -mx-1 mt-2.5 flex gap-2.5 overflow-x-auto px-1 pb-1 pt-0.5"
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

function Tile({
  value,
  label,
  ring,
}: {
  value: string;
  label: string;
  ring?: number;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-fill/60 px-3 py-2.5">
      {ring !== undefined ? <Ring percent={ring} /> : null}
      <div className="min-w-0">
        <p className="truncate text-[19px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">
          {value}
        </p>
        <p className="mt-1 truncate text-[12px] text-ink-2">{label}</p>
      </div>
    </div>
  );
}

function Ring({ percent }: { percent: number }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  // A sliver of arc for any non-zero value, so "visited something" always reads.
  const filled = percent > 0 ? Math.max(circumference * (percent / 100), 2) : 0;

  return (
    <svg
      viewBox="0 0 32 32"
      className="size-8 shrink-0 -rotate-90"
      aria-hidden="true"
      role="presentation"
    >
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="text-fill-strong"
      />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        className="text-accent"
      />
    </svg>
  );
}
