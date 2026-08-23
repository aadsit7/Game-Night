"use client";

import { useEffect, useRef, useState } from "react";

import { stopAt, valueAt, type ScrubTrack, type TimelineYear } from "@/lib/timeline/buildTimeline";
import { cn } from "@/lib/utils/cn";

/**
 * The years of a travel history, as a track you can drag through.
 *
 * The bars are the history itself — one per year, as tall as that year was
 * busy — so the shape of the control tells you where the travelling actually
 * happened before you touch it.
 *
 * It scrubs to a *place*, not to a year. A year is one bar wide however much
 * happened in it, and the drag inside that bar walks the places within it, so
 * a fourteen-stop 2024 is somewhere you can move around in rather than
 * somewhere the control can only drop you at the top of. The readout above the
 * track says which stop is under your thumb while you are on it, since your
 * thumb is over the track itself.
 *
 * A real `<input type="range">` sits invisibly on top rather than a custom drag
 * handler: it brings touch, keyboard and VoiceOver behaviour that would
 * otherwise all have to be rebuilt, and rebuilt worse. Its own steps are far
 * finer than one place, so the arrow keys are taken over below and moved a
 * stop at a time — a key press that advanced a fiftieth of a year would move
 * nothing anyone could see.
 */

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** A short tick as the handle crosses onto another place, where the device has one. */
function haptic() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(5);
}

export function TimelineScrubber({
  years,
  track,
  value,
  onScrub,
  busiest,
  bottomInset,
}: {
  years: TimelineYear[];
  track: ScrubTrack;
  /** Where the handle is, 0…`track.max`. */
  value: number;
  /**
   * `live` is true while a finger is dragging: the timeline should jump to
   * keep up rather than glide, because a smooth scroll per step turns a drag
   * into a queue of animations the list is always a moment behind.
   */
  onScrub: (value: number, live: boolean) => void;
  busiest: number;
  bottomInset: number;
}) {
  const [scrubbing, setScrubbing] = useState(false);
  /** Set only once a finger has actually moved, so a tap still glides. */
  const dragging = useRef(false);
  const lastStop = useRef(-1);

  const stopIndex = stopAt(track, value);
  const stop = track.stops[stopIndex];

  useEffect(() => {
    // Only while a finger is down: the same position also moves as the list is
    // scrolled by hand, and a phone that buzzed its way through a scroll would
    // be unbearable.
    if (!scrubbing) {
      lastStop.current = stopIndex;
      return;
    }
    if (lastStop.current === stopIndex) return;
    lastStop.current = stopIndex;
    haptic();
  }, [scrubbing, stopIndex]);

  if (years.length < 2 || !stop) return null;

  const year = years[stop.yearIndex];
  const fraction = track.max > 0 ? value / track.max : 0;

  const move = (stopTarget: number) => {
    onScrub(valueAt(track, clamp(stopTarget, 0, track.stops.length - 1)), false);
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4"
      style={{ paddingBottom: bottomInset }}
    >
      <div className="glass pointer-events-auto mx-auto max-w-[520px] rounded-lg border border-glass-border px-4 pb-2.5 pt-2.5 shadow-float">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-ink-3">
            {years[0].year}
          </span>

          {/*
            One line that answers whichever question is live: at rest, how big
            the year you are in is; under a thumb, exactly where that thumb is.
          */}
          <span
            className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold tabular-nums text-ink"
            aria-hidden="true"
          >
            {scrubbing ? (
              <>
                {stop.month} {stop.year}
                <span className="ml-1.5 text-[13px] font-normal text-ink-2">{stop.name}</span>
              </>
            ) : (
              <>
                {year.year}
                <span className="ml-1.5 text-[13px] font-normal text-ink-2">
                  {year.entries.length === 1 ? "1 place" : `${year.entries.length} places`}
                </span>
              </>
            )}
          </span>

          <span className="shrink-0 text-[12px] font-medium tabular-nums text-ink-3">
            {years[years.length - 1].year}
          </span>
        </div>

        <div className="relative mt-2 h-9">
          <div className="absolute inset-0 flex items-end gap-[3px]" aria-hidden="true">
            {years.map((entryYear, index) => (
              <span
                key={entryYear.year}
                className={cn(
                  "flex-1 rounded-t-[3px] transition-colors duration-150",
                  index === stop.yearIndex ? "bg-accent" : "bg-fill-strong",
                )}
                // A year with one place still needs to be visible and tappable,
                // so every bar keeps a floor regardless of the busiest year.
                style={{
                  height: `${Math.max(18, (entryYear.entries.length / Math.max(busiest, 1)) * 100)}%`,
                }}
              />
            ))}
          </div>

          {/*
            Taller than the bars it covers: the track is 36px of histogram, and
            a control you drag with a thumb needs more of the screen than that.
          */}
          <input
            type="range"
            min={0}
            max={track.max}
            step={1}
            value={value}
            onChange={(event) => onScrub(Number(event.target.value), dragging.current)}
            onPointerDown={() => setScrubbing(true)}
            onPointerMove={() => {
              dragging.current = true;
            }}
            onPointerUp={() => {
              dragging.current = false;
              setScrubbing(false);
            }}
            onPointerCancel={() => {
              dragging.current = false;
              setScrubbing(false);
            }}
            onKeyDown={(event) => {
              switch (event.key) {
                case "ArrowRight":
                case "ArrowUp":
                  event.preventDefault();
                  return move(stopIndex + 1);
                case "ArrowLeft":
                case "ArrowDown":
                  event.preventDefault();
                  return move(stopIndex - 1);
                // A page is a year, which is what the bars underneath promise.
                case "PageDown":
                  event.preventDefault();
                  return move(track.firstStop[Math.min(stop.yearIndex + 1, years.length - 1)]);
                case "PageUp":
                  event.preventDefault();
                  return move(track.firstStop[Math.max(stop.yearIndex - 1, 0)]);
                case "Home":
                  event.preventDefault();
                  return move(0);
                case "End":
                  event.preventDefault();
                  return move(track.stops.length - 1);
                default:
              }
            }}
            aria-label="Scrub through your travel history"
            aria-valuetext={`${stop.month} ${stop.year}, ${stop.name}`}
            className="scrub-range peer absolute -inset-y-3 z-10 h-[60px] w-full cursor-pointer touch-none appearance-none bg-transparent opacity-0"
          />

          {/*
            Where you are, to the place rather than to the year: the lit bar
            says which year, this says how far into it.
          */}
          <span
            aria-hidden="true"
            style={{ left: `${fraction * 100}%` }}
            className={cn(
              // Grounded on the same baseline the bars stand on, and a little
              // taller than the tallest of them: it rides over the histogram
              // rather than floating beside it.
              "pointer-events-none absolute -top-1 bottom-0 -translate-x-1/2 rounded-full bg-ink shadow-soft",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2",
              scrubbing ? "w-[3.5px]" : "w-[2.5px] transition-[left] duration-150 ease-out",
            )}
          >
            {/* A head, only while it is being held: at rest the year's own bar
                is the loud indicator and this only has to say where in it. */}
            <span
              className={cn(
                "absolute left-1/2 top-0 size-2 -translate-x-1/2 rounded-full bg-ink",
                "transition-transform duration-150 ease-out",
                scrubbing ? "scale-100" : "scale-0",
              )}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
