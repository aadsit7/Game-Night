"use client";

import { CONTINENT_INITIALS } from "@/components/insights/LevelRow";
import { cn } from "@/lib/utils/cn";

/**
 * How much of the world, as seven marks — and the way to look at one of them.
 *
 * "4 of 7 continents" is a sentence; this is the same fact as a picture, and
 * the three you have never set foot on are as much of the answer as the four
 * you have. Tapping one you *have* been to puts the whole tab inside it, which
 * is what makes the region filter something you can find: a picture of the
 * world beats a line in a settings sheet. Tapping it again comes back out.
 *
 * Antarctica is included on purpose. Almost nobody has been, and that is
 * exactly why leaving it out would make the row a lie.
 */

/** West to east, the way an atlas lays them out. */
const CONTINENTS = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
  "Antarctica",
] as const;

export function ContinentStrip({
  visited,
  selected,
  onSelect,
}: {
  /** Continent name → how many places you have there, ignoring this filter. */
  visited: Map<string, number>;
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const count = CONTINENTS.filter((name) => (visited.get(name) ?? 0) > 0).length;

  return (
    <div className="rounded-[18px] bg-fill/60 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3 pb-2.5">
        <span className="text-[13px] font-medium text-ink-2">
          {selected ?? "Continents"}
        </span>
        {selected ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="pressable text-[13px] font-medium text-accent"
          >
            Show all
          </button>
        ) : (
          <span className="text-[13px] tabular-nums text-ink-3">
            <span className="font-semibold text-ink">{count}</span> of 7
          </span>
        )}
      </div>

      <div className="flex gap-1.5">
        {CONTINENTS.map((name) => {
          const places = visited.get(name) ?? 0;
          const active = selected === name;
          const label = `${name}: ${
            places === 0 ? "not yet" : `${places} ${places === 1 ? "place" : "places"}`
          }`;

          if (places === 0) {
            return (
              <span
                key={name}
                role="img"
                aria-label={label}
                className="grid h-9 min-w-0 flex-1 place-items-center rounded-[11px] bg-fill text-[11px] font-bold text-ink-3/70"
              >
                <span aria-hidden="true">{CONTINENT_INITIALS[name]}</span>
              </span>
            );
          }

          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(active ? null : name)}
              aria-pressed={active}
              aria-label={`${label}. Show only ${name}.`}
              className={cn(
                "pressable grid h-9 min-w-0 flex-1 place-items-center rounded-[11px]",
                "text-[11px] font-bold transition-colors",
                /* Picking one dims the rest rather than hiding them: the row
                   is the way back out as much as the way in. */
                active
                  ? "bg-accent text-on-accent ring-2 ring-accent ring-offset-2 ring-offset-bg"
                  : selected
                    ? "bg-accent-soft text-accent"
                    : "bg-accent text-on-accent",
              )}
            >
              <span aria-hidden="true">{CONTINENT_INITIALS[name]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
