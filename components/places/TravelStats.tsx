"use client";

/**
 * A small progress read-out, in the spirit of a travel app's "coverage" screen
 * but kept to a single row rather than a tab of its own — the point of this app
 * is still the places, not the scoreboard.
 */

/** UN member states plus the two observers; the usual denominator. */
const COUNTRIES_IN_THE_WORLD = 195;

export function TravelStats({
  places,
  countries,
}: {
  places: number;
  countries: number;
}) {
  const coverage = Math.min(100, (countries / COUNTRIES_IN_THE_WORLD) * 100);

  return (
    <div className="grid grid-cols-3 gap-2.5">
      <Tile value={places.toLocaleString()} label={places === 1 ? "Place" : "Places"} />
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
