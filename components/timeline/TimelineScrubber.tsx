"use client";

import type { TimelineYear } from "@/lib/timeline/buildTimeline";
import { cn } from "@/lib/utils/cn";

/**
 * The years of a travel history, as a track you can drag through.
 *
 * The bars are the history itself — one per year, as tall as that year was
 * busy — so the shape of the control tells you where the travelling actually
 * happened before you touch it. The active year is the accent-coloured bar,
 * which doubles as the position indicator.
 *
 * A real `<input type="range">` sits invisibly on top rather than a custom drag
 * handler: it brings touch, keyboard and VoiceOver behaviour that would
 * otherwise all have to be rebuilt, and rebuilt worse.
 */
export function TimelineScrubber({
  years,
  activeIndex,
  onScrub,
  busiest,
  bottomInset,
}: {
  years: TimelineYear[];
  activeIndex: number;
  onScrub: (index: number) => void;
  busiest: number;
  bottomInset: number;
}) {
  if (years.length < 2) return null;

  const active = years[Math.min(activeIndex, years.length - 1)];

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4"
      style={{ paddingBottom: bottomInset }}
    >
      <div className="glass pointer-events-auto mx-auto max-w-[520px] rounded-lg border border-glass-border px-4 pb-2.5 pt-2.5 shadow-float">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium tabular-nums text-ink-3">
            {years[0].year}
          </span>
          <span className="text-[15px] font-semibold tabular-nums text-ink">
            {active.year}
            <span className="ml-1.5 text-[13px] font-normal text-ink-2">
              {active.entries.length === 1 ? "1 place" : `${active.entries.length} places`}
            </span>
          </span>
          <span className="text-[12px] font-medium tabular-nums text-ink-3">
            {years[years.length - 1].year}
          </span>
        </div>

        <div className="relative mt-2 h-9">
          <div className="absolute inset-0 flex items-end gap-[3px]" aria-hidden="true">
            {years.map((year, index) => (
              <span
                key={year.year}
                className={cn(
                  "flex-1 rounded-t-[3px] transition-colors duration-150",
                  index === activeIndex ? "bg-accent" : "bg-fill-strong",
                )}
                // A year with one place still needs to be visible and tappable,
                // so every bar keeps a floor regardless of the busiest year.
                style={{ height: `${Math.max(18, (year.entries.length / Math.max(busiest, 1)) * 100)}%` }}
              />
            ))}
          </div>

          <input
            type="range"
            min={0}
            max={years.length - 1}
            step={1}
            value={activeIndex}
            onChange={(event) => onScrub(Number(event.target.value))}
            aria-label="Scrub through the years"
            aria-valuetext={`${active.year}, ${active.entries.length} places`}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
        </div>
      </div>
    </div>
  );
}
