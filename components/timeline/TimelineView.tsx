"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CalendarClock, Luggage, Plus } from "lucide-react";

import { TimelineScrubber } from "@/components/timeline/TimelineScrubber";
import { EmptyState } from "@/components/ui/EmptyState";
import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import {
  buildScrubTrack,
  buildTimeline,
  formatDays,
  gapLabel,
  stopAt,
  valueAt,
  type ScrubStop,
  type TimelineEntry,
} from "@/lib/timeline/buildTimeline";
import { formatVisitRange } from "@/lib/utils/date";
import { flagVariant } from "@/lib/ui/flags";
import { countryFlag, placeSubtitle } from "@/lib/utils/geo";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * The travel history as a chronology, oldest at the top.
 *
 * Reads from the same `places` array the globe and the list do — there is no
 * third dataset to fall out of step. It opens on the most recent year, because
 * that is the one worth seeing first, and the scrubber underneath is how you
 * get anywhere else without a long scroll — down to the individual place, not
 * just the year it happened in.
 */
export function TimelineView({
  places,
  trips,
  loading,
  bottomInset,
  onOpenPlace,
  onOpenTrip,
  onAdd,
  onShowGlobe,
}: {
  places: VisitedPlace[];
  /** Only used to name an entry's trip; the chronology itself is unchanged. */
  trips: Trip[];
  loading: boolean;
  bottomInset: number;
  onOpenPlace: (id: string) => void;
  onOpenTrip: (id: string) => void;
  onAdd: () => void;
  onShowGlobe: () => void;
}) {
  const timeline = useMemo(() => buildTimeline(places), [places]);
  const tripNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const trip of trips) map.set(trip.id, trip.name);
    return map;
  }, [trips]);
  const { years, undated, busiest, totals } = timeline;
  /** Every place the scrubber can land on, and how they map onto its track. */
  const track = useMemo(() => buildScrubTrack(years), [years]);

  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<number, HTMLElement>());
  const entryRefs = useRef(new Map<string, HTMLElement>());
  /**
   * Where the scrubber's handle sits, in the track's own units. Clamped as it
   * is read rather than stored clamped: a place added or removed reshapes the
   * track under the handle, and the alternative is a stored position that
   * points past the end of a shorter history until something moves it.
   */
  const [scrubValue, setScrubValue] = useState(0);

  /**
   * While a drag is driving the scroll, the scroll handler must not fight it by
   * writing the position back. This holds the moment after which scroll events
   * are trusted again.
   */
  const scrubbingUntil = useRef(0);
  const openedAt = useRef(false);
  /**
   * The scroll-margin each kind of landing place carries, read back from the
   * DOM rather than written down twice. The same figure has to put a stop below
   * the sticky year heading when the scrubber jumps to it *and* recognise that
   * stop again once the scroll settles; as two constants they drift apart and
   * the handle springs back a place every time you let go. Forgotten whenever
   * the safe-area inset underneath it can have changed.
   */
  const margins = useRef<{ section: number; entry: number } | null>(null);

  useEffect(() => {
    const forget = () => {
      margins.current = null;
    };
    window.addEventListener("resize", forget);
    window.addEventListener("orientationchange", forget);
    return () => {
      window.removeEventListener("resize", forget);
      window.removeEventListener("orientationchange", forget);
    };
  }, []);

  /**
   * What a stop scrolls to. A year's first place scrolls to the year itself, so
   * arriving in 2019 shows the heading that says so; every other place scrolls
   * to its own row.
   */
  const anchorFor = useCallback((stop: ScrubStop | undefined) => {
    if (!stop) return undefined;
    return stop.indexInYear === 0
      ? sectionRefs.current.get(stop.year)
      : entryRefs.current.get(stop.placeId);
  }, []);

  const scrollMargins = useCallback(() => {
    if (margins.current) return margins.current;
    const read = (element?: HTMLElement) =>
      element ? Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0 : 0;

    const next = {
      section: read(sectionRefs.current.values().next().value),
      entry: read(entryRefs.current.values().next().value),
    };
    // Nothing has rendered yet: measure again rather than cache a zero.
    if (next.section || next.entry) margins.current = next;
    return next;
  }, []);

  /** Where the page sits when this stop is at the top of the view. */
  const landingTop = useCallback(
    (stopIndex: number) => {
      const stop = track.stops[stopIndex];
      const element = anchorFor(stop);
      if (!stop || !element) return Number.NEGATIVE_INFINITY;
      const inset = scrollMargins();
      return element.offsetTop - (stop.indexInYear === 0 ? inset.section : inset.entry);
    },
    [track, anchorFor, scrollMargins],
  );

  const scrollToStop = useCallback(
    (stopIndex: number, behavior: ScrollBehavior) => {
      const element = anchorFor(track.stops[stopIndex]);
      if (!element) return;
      // Long enough to cover a smooth scroll; short enough that the next step
      // of a drag is never waiting on the one before it.
      scrubbingUntil.current = Date.now() + (behavior === "smooth" ? 650 : 300);
      element.scrollIntoView({ block: "start", behavior });
    },
    [track, anchorFor],
  );

  // Land on the most recent year rather than the oldest: the last trip is the
  // one someone opening this is usually looking for.
  useEffect(() => {
    if (openedAt.current || years.length === 0) return;
    openedAt.current = true;
    const first = track.firstStop[years.length - 1];
    setScrubValue(valueAt(track, first));
    // After paint, so the sections have their real offsets.
    requestAnimationFrame(() => scrollToStop(first, "auto"));
  }, [years, track, scrollToStop]);

  const onScroll = useCallback(() => {
    if (Date.now() < scrubbingUntil.current) return;
    const container = scrollRef.current;
    if (!container || track.stops.length === 0) return;

    const top = container.scrollTop;
    /*
     * The last places on a timeline can never reach the top of the view —
     * there is nothing below them to scroll past — so at the bottom the answer
     * is the last stop, not the last one that happens to fit.
     */
    const atEnd = top + container.clientHeight >= container.scrollHeight - 2;

    let found = track.stops.length - 1;
    if (!atEnd) {
      // The last stop the scroll has reached. Landing positions only climb, so
      // this is a binary search rather than a walk past every place.
      let low = 0;
      let high = track.stops.length - 1;
      found = 0;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (landingTop(mid) <= top + 1) {
          found = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
    }

    const next = valueAt(track, found);
    setScrubValue((current) => (current === next ? current : next));
  }, [track, landingTop]);

  const scrub = useCallback(
    (next: number, live: boolean) => {
      setScrubValue(next);
      // A drag jumps: a smooth scroll queued per step leaves the list trailing
      // the thumb by half a second. Anything else glides.
      scrollToStop(stopAt(track, next), live || reduceMotion ? "auto" : "smooth");
    },
    [track, scrollToStop, reduceMotion],
  );

  if (loading) {
    return (
      <div className="absolute inset-0 bg-bg">
        <div className="mx-auto w-full max-w-[720px] px-4 pt-16" aria-hidden="true">
          <div className="skeleton h-9 w-40 rounded" />
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="mt-6 flex gap-4">
              <div className="skeleton size-14 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-5 w-1/2 rounded" />
                <div className="skeleton mt-2 h-4 w-1/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div className="absolute inset-0 bg-bg">
        <div className="scroll-area absolute inset-0" style={{ paddingBottom: bottomInset }}>
          <div className="mx-auto w-full max-w-[720px] px-4">
            <Header totals={totals} />
            <EmptyState
              className="pt-6"
              icon={<CalendarClock size={28} aria-hidden="true" />}
              title={places.length === 0 ? "Nothing on the timeline yet" : "No dates to plot"}
              description={
                places.length === 0
                  ? "Add a place with the dates you were there and it will appear here."
                  : "Your places don’t have visit dates yet. Add dates to one and it takes its place in the chronology."
              }
              action={
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={onAdd}
                    className="pressable inline-flex min-h-[50px] items-center gap-2 rounded-md bg-accent px-6 text-[17px] font-semibold text-on-accent"
                  >
                    <Plus size={19} aria-hidden="true" />
                    Add a place
                  </button>
                  <button
                    type="button"
                    onClick={onShowGlobe}
                    className="pressable min-h-11 rounded-pill px-4 text-[16px] font-medium text-accent"
                  >
                    Back to the globe
                  </button>
                </div>
              }
            />
            {undated.length > 0 ? <Undated places={undated} onOpenPlace={onOpenPlace} /> : null}
          </div>
        </div>
      </div>
    );
  }

  // Room for the scrubber, which floats above the tab bar.
  const scrubberHeight = years.length > 1 ? 92 : 0;

  return (
    <div className="absolute inset-0 bg-bg">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-area absolute inset-0"
        style={{ paddingBottom: bottomInset + scrubberHeight }}
      >
        <div className="mx-auto w-full max-w-[720px] px-4">
          <Header totals={totals} />

          {years.map((year) => (
            <section
              key={year.year}
              ref={(node) => {
                if (node) sectionRefs.current.set(year.year, node);
                else sectionRefs.current.delete(year.year);
              }}
              aria-labelledby={`timeline-year-${year.year}`}
              // Scrubbing to a year puts its heading clear of the status bar,
              // not underneath it.
              style={{ scrollMarginTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
            >
              <div
                className="sticky z-10 -mx-4 flex items-baseline gap-3 bg-bg/85 px-4 pb-2 pt-3 backdrop-blur-xl"
                style={{ top: "env(safe-area-inset-top, 0px)" }}
              >
                <h2
                  id={`timeline-year-${year.year}`}
                  className="text-[26px] font-bold tabular-nums leading-none tracking-[-0.03em] text-ink"
                >
                  {year.year}
                </h2>
                <p className="truncate text-[13px] text-ink-3">
                  {year.entries.length === 1 ? "1 place" : `${year.entries.length} places`}
                  {" · "}
                  {year.countries === 1 ? "1 country" : `${year.countries} countries`}
                  {" · "}
                  {formatDays(year.days)}
                </p>
              </div>

              <ol className="pb-2">
                {year.entries.map((entry, index) => {
                  const previous = index > 0 ? year.entries[index - 1] : null;
                  const gap = previous ? gapLabel(previous.end, entry.start) : null;
                  /* The trip is named once per run, not once per stop. Four
                     places on the same trip printed "Japan, spring" four
                     times, in four pills, down four consecutive entries —
                     a caption that repeats itself stops being read. */
                  const opensATrip =
                    Boolean(entry.place.tripId) && entry.place.tripId !== previous?.place.tripId;
                  return (
                    <li key={entry.place.id}>
                      {gap ? <Gap label={gap} /> : null}
                      <Entry
                        entry={entry}
                        anchorRef={(node) => {
                          if (node) entryRefs.current.set(entry.place.id, node);
                          else entryRefs.current.delete(entry.place.id);
                        }}
                        last={index === year.entries.length - 1}
                        tripName={
                          opensATrip && entry.place.tripId
                            ? tripNames.get(entry.place.tripId)
                            : undefined
                        }
                        onOpen={() => onOpenPlace(entry.place.id)}
                        onOpenTrip={() =>
                          entry.place.tripId && onOpenTrip(entry.place.tripId)
                        }
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {undated.length > 0 ? <Undated places={undated} onOpenPlace={onOpenPlace} /> : null}
        </div>
      </div>

      <TimelineScrubber
        years={years}
        track={track}
        value={Math.min(scrubValue, track.max)}
        onScrub={scrub}
        busiest={busiest}
        bottomInset={bottomInset}
      />
    </div>
  );
}

function Header({ totals }: { totals: { places: number; countries: number; days: number } }) {
  return (
    <header className="pb-1" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)" }}>
      <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">Timeline</h1>
      {totals.places > 0 ? (
        <p className="mt-1 text-[15px] text-ink-2">
          {totals.places === 1 ? "1 place" : `${totals.places} places`}
          {" · "}
          {totals.countries === 1 ? "1 country" : `${totals.countries} countries`}
          {" · "}
          {formatDays(totals.days)} away
        </p>
      ) : null}
    </header>
  );
}

/** One place, on the spine. */
function Entry({
  entry,
  anchorRef,
  last,
  tripName,
  onOpen,
  onOpenTrip,
}: {
  entry: TimelineEntry;
  /** Registers the row as somewhere the scrubber can land. */
  anchorRef: (node: HTMLElement | null) => void;
  last: boolean;
  /** Absent unless the place belongs to a trip the app knows about. */
  tripName?: string;
  onOpen: () => void;
  onOpenTrip: () => void;
}) {
  const { place } = entry;
  const range = formatVisitRange(entry.start, entry.end === entry.start ? undefined : entry.end);
  /* "Sintra, Sintra, Portugal" — the city is the place as often as not, and
     printing it twice is how a list stops being read. */
  const where = placeSubtitle(place) || place.country;
  const when = entry.days > 1 ? `${range} · ${formatDays(entry.days)}` : range;
  const hasFlag = Boolean(countryFlag(place.countryCode));
  const hasPhoto = Boolean(place.coverImage);

  return (
    <div
      ref={anchorRef}
      className="relative flex gap-3 pl-1"
      // Clears the status bar and the year heading stuck below it, so a place
      // scrubbed to is never hiding behind the year it belongs to.
      style={{ scrollMarginTop: "calc(env(safe-area-inset-top, 0px) + 54px)" }}
    >
      {/* The spine: a dot for this stop, and the line onward to the next. */}
      <div className="relative flex w-3 shrink-0 justify-center" aria-hidden="true">
        <span className="absolute top-[20px] size-[9px] rounded-full bg-accent ring-4 ring-bg" />
        {!last ? <span className="absolute top-[31px] bottom-[-4px] w-[2px] bg-separator" /> : null}
      </div>

      <div className="mb-0.5 min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="pressable -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left"
        >
          {/* The photograph when there is one; the country's chip when there is
              not. A tinted rectangle standing in for a missing picture, once
              per stop, is what made this page a column of grey squares. */}
          {hasPhoto ? (
            <PlaceImage
              place={place}
              alt=""
              className="size-[46px] shrink-0 overflow-hidden rounded-[14px]"
            />
          ) : (
            <FlagChip
              countryCode={place.countryCode}
              variant={flagVariant(place)}
              size="lg"
            />
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16.5px] font-semibold leading-tight text-ink">
              {place.name}
            </span>
            <span className="mt-0.5 block truncate text-[13.5px] leading-snug text-ink-2">
              {hasPhoto && hasFlag ? (
                <FlagChip countryCode={place.countryCode} className="mr-1.5" />
              ) : null}
              {where}
            </span>
            <span className="block truncate text-[13px] tabular-nums leading-snug text-ink-3">
              {when}
            </span>
          </span>
        </button>

        {/*
          A quiet label under the entry, aligned with its text rather than its
          photo. Its own button, because one cannot sit inside another.
        */}
        {tripName ? (
          <button
            type="button"
            onClick={onOpenTrip}
            className="pressable ml-[58px] inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-pill bg-fill px-2.5 text-[12.5px] font-medium text-ink-2"
          >
            <Luggage size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{tripName}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The quiet stretches between trips, so a long gap reads as one. */
function Gap({ label }: { label: string }) {
  return (
    <div className="relative flex items-center gap-3.5 pl-1" aria-hidden="true">
      <div className="flex w-3 shrink-0 justify-center">
        <span className="h-6 w-[2px] bg-separator [mask-image:repeating-linear-gradient(to_bottom,#000_0_3px,transparent_3px_6px)]" />
      </div>
      <span className="text-[12.5px] font-medium text-ink-3">{label}</span>
    </div>
  );
}

/** Places that have no date yet, kept visible rather than silently dropped. */
function Undated({
  places,
  onOpenPlace,
}: {
  places: VisitedPlace[];
  onOpenPlace: (id: string) => void;
}) {
  return (
    <section className="mt-6 border-t border-separator pt-5" aria-labelledby="timeline-undated">
      <h2 id="timeline-undated" className="text-[15px] font-semibold text-ink">
        No dates yet
      </h2>
      <p className="mt-0.5 text-[13.5px] text-ink-2">
        {places.length === 1 ? "1 place is" : `${places.length} places are`} waiting for dates
        before {places.length === 1 ? "it" : "they"} can take a place in the chronology.
      </p>

      <ul className="mt-3 flex flex-wrap gap-2 pb-2">
        {places.map((place) => (
          <li key={place.id}>
            <button
              type="button"
              onClick={() => onOpenPlace(place.id)}
              className={cn(
                "pressable inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-fill px-3.5",
                "text-[14px] font-medium text-ink-2",
              )}
            >
              <FlagChip countryCode={place.countryCode} />
              {place.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
