"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CalendarRange, Luggage, Plus } from "lucide-react";

import { TimelineScrubber } from "@/components/timeline/TimelineScrubber";
import { EmptyState } from "@/components/ui/EmptyState";
import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { buildTimeline, formatDays, gapLabel, type TimelineEntry } from "@/lib/timeline/buildTimeline";
import { formatVisitRange } from "@/lib/utils/date";
import { countryFlag } from "@/lib/utils/geo";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * The travel history as a chronology, oldest at the top.
 *
 * Reads from the same `places` array the globe and the list do — there is no
 * third dataset to fall out of step. It opens on the most recent year, because
 * that is the one worth seeing first, and the scrubber underneath is how you
 * get anywhere else without a long scroll.
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<number, HTMLElement>());
  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * While a drag is driving the scroll, the scroll handler must not fight it by
   * writing the position back. This holds the moment after which scroll events
   * are trusted again.
   */
  const scrubbingUntil = useRef(0);
  const openedAt = useRef(false);

  const scrollToYear = useCallback((index: number, behavior: ScrollBehavior) => {
    const year = years[index];
    const section = year ? sectionRefs.current.get(year.year) : undefined;
    const container = scrollRef.current;
    if (!section || !container) return;

    scrubbingUntil.current = Date.now() + 700;
    container.scrollTo({
      top: section.offsetTop - container.offsetTop - 8,
      behavior,
    });
  }, [years]);

  // Land on the most recent year rather than the oldest: the last trip is the
  // one someone opening this is usually looking for.
  useEffect(() => {
    if (openedAt.current || years.length === 0) return;
    openedAt.current = true;
    const last = years.length - 1;
    setActiveIndex(last);
    // After paint, so the sections have their real offsets.
    requestAnimationFrame(() => scrollToYear(last, "auto"));
  }, [years, scrollToYear]);

  const onScroll = useCallback(() => {
    if (Date.now() < scrubbingUntil.current) return;
    const container = scrollRef.current;
    if (!container) return;

    // The year whose heading has most recently passed the top of the viewport.
    const line = container.scrollTop + 72;
    let next = 0;
    years.forEach((year, index) => {
      const section = sectionRefs.current.get(year.year);
      if (section && section.offsetTop - container.offsetTop <= line) next = index;
    });
    setActiveIndex((current) => (current === next ? current : next));
  }, [years]);

  const scrub = useCallback((index: number) => {
    setActiveIndex(index);
    scrollToYear(index, "smooth");
  }, [scrollToYear]);

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
              className="scroll-mt-4"
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
                  return (
                    <li key={entry.place.id}>
                      {gap ? <Gap label={gap} /> : null}
                      <Entry
                        entry={entry}
                        last={index === year.entries.length - 1}
                        tripName={
                          entry.place.tripId ? tripNames.get(entry.place.tripId) : undefined
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
        activeIndex={activeIndex}
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
  last,
  tripName,
  onOpen,
  onOpenTrip,
}: {
  entry: TimelineEntry;
  last: boolean;
  /** Absent unless the place belongs to a trip the app knows about. */
  tripName?: string;
  onOpen: () => void;
  onOpenTrip: () => void;
}) {
  const { place } = entry;
  const hasFlag = Boolean(countryFlag(place.countryCode));
  const range = formatVisitRange(entry.start, entry.end === entry.start ? undefined : entry.end);
  const where = [place.city, place.country].filter(Boolean).join(", ");

  return (
    <div className="relative flex gap-3.5 pl-1">
      {/* The spine: a dot for this stop, and the line onward to the next. */}
      <div className="relative flex w-3 shrink-0 justify-center pt-[22px]" aria-hidden="true">
        <span className="absolute top-[22px] size-[9px] rounded-full bg-accent ring-4 ring-bg" />
        {!last ? <span className="absolute top-[34px] bottom-[-6px] w-[2px] bg-separator" /> : null}
      </div>

      <div className="mb-1 min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="pressable -mx-2 flex w-[calc(100%+1rem)] items-start gap-3.5 rounded-md px-2 py-3 text-left"
        >
          <PlaceImage
            place={place}
            alt=""
            className="size-[58px] shrink-0 overflow-hidden rounded-md"
          />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-semibold leading-tight text-ink">
              {place.name}
            </span>
            <span className="mt-0.5 block truncate text-[14px] text-ink-2">
              {hasFlag ? <FlagChip countryCode={place.countryCode} className="mr-1.5" /> : null}
              {where || place.country}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[13px] tabular-nums text-ink-3">
              <CalendarRange size={13} aria-hidden="true" className="shrink-0" />
              <span className="truncate">
                {range}
                {entry.days > 1 ? ` · ${formatDays(entry.days)}` : null}
              </span>
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
            className="pressable ml-[72px] inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-pill bg-fill px-2.5 text-[12.5px] font-medium text-ink-2"
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
