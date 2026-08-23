import { inclusiveDayCount, parseCalendarDate } from "@/lib/utils/date";
import type { VisitedPlace } from "@/types/place";

/**
 * The travel history as a chronology.
 *
 * Kept as a pure function over the same `places` array the globe and the list
 * read, so the timeline cannot show a different history from the other two.
 * All of the date reasoning lives here rather than in the view, which is what
 * makes it testable without a browser.
 */

export type TimelineEntry = {
  place: VisitedPlace;
  /** `YYYY-MM-DD`. */
  start: string;
  /** `YYYY-MM-DD`. Equals `start` for an open-ended or single-day visit. */
  end: string;
  /** Whole days on the ground, counting both ends. A day trip is 1. */
  days: number;
};

export type TimelineYear = {
  year: number;
  /** Chronological within the year. */
  entries: TimelineEntry[];
  /** Distinct countries visited that year. */
  countries: number;
  days: number;
};

export type Timeline = {
  /** Oldest year first, so scrolling down moves forward in time. */
  years: TimelineYear[];
  /** Places with no usable date. They have nowhere to sit on a timeline. */
  undated: VisitedPlace[];
  /** Most entries in any one year — the scale the histogram is drawn against. */
  busiest: number;
  totals: { places: number; countries: number; years: number; days: number };
};

const DAY_MS = 86_400_000;

/** Countries are counted by code where there is one, since names vary in spelling. */
function countryKey(place: VisitedPlace): string | null {
  const key = place.countryCode?.trim().toUpperCase() || place.country?.trim().toLowerCase();
  return key ? key : null;
}

function toEntry(place: VisitedPlace): TimelineEntry | null {
  const start = parseCalendarDate(place.visitedFrom);
  if (!start) return null;

  const parsedEnd = parseCalendarDate(place.visitedTo);
  // An end before the start is a typo, not a negative trip; treat it as a day.
  const ends = parsedEnd && parsedEnd.getTime() >= start.getTime();

  return {
    place,
    start: place.visitedFrom as string,
    end: ends ? (place.visitedTo as string) : (place.visitedFrom as string),
    days: inclusiveDayCount(place.visitedFrom, place.visitedTo) ?? 1,
  };
}

export function buildTimeline(places: VisitedPlace[]): Timeline {
  const entries: TimelineEntry[] = [];
  const undated: VisitedPlace[] = [];

  for (const place of places) {
    // Somewhere still to go has not happened yet, so it has no place in a
    // chronology — not even in the "waiting for dates" list, which is about
    // visits whose dates were never filled in.
    if (place.wantToGo) continue;

    const entry = toEntry(place);
    if (entry) entries.push(entry);
    else undated.push(place);
  }

  // A trip that crosses new year belongs to the year it began in — that is the
  // year a person would look under to find it.
  const byYear = new Map<number, TimelineEntry[]>();
  for (const entry of entries) {
    const year = Number(entry.start.slice(0, 4));
    const bucket = byYear.get(year);
    if (bucket) bucket.push(entry);
    else byYear.set(year, [entry]);
  }

  const years: TimelineYear[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, yearEntries]) => {
      yearEntries.sort(
        (a, b) => a.start.localeCompare(b.start) || a.place.name.localeCompare(b.place.name),
      );

      const countries = new Set<string>();
      let days = 0;
      for (const entry of yearEntries) {
        const key = countryKey(entry.place);
        if (key) countries.add(key);
        days += entry.days;
      }

      return { year, entries: yearEntries, countries: countries.size, days };
    });

  const allCountries = new Set<string>();
  let totalDays = 0;
  for (const entry of entries) {
    const key = countryKey(entry.place);
    if (key) allCountries.add(key);
    totalDays += entry.days;
  }

  return {
    years,
    undated: [...undated].sort((a, b) => a.name.localeCompare(b.name)),
    busiest: years.reduce((most, year) => Math.max(most, year.entries.length), 0),
    totals: {
      places: entries.length,
      countries: allCountries.size,
      years: years.length,
      days: totalDays,
    },
  };
}

/** "9 days" · "1 day" — the duration shown against each entry. */
export function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The gap between one trip and the next, when it is long enough to be worth
 * drawing. Short gaps would put a label between every pair of entries.
 */
export function gapLabel(previousEnd: string, nextStart: string): string | null {
  const from = parseCalendarDate(previousEnd);
  const to = parseCalendarDate(nextStart);
  if (!from || !to) return null;

  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (days < 45) return null;

  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months later`;

  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (remainder === 0) return years === 1 ? "a year later" : `${years} years later`;
  return years === 1 ? "over a year later" : `over ${years} years later`;
}

/* ==========================================================================
   The scrubber's track

   The control under the timeline used to have one position per year, which
   made a busy year a dead end: the histogram advertised "fourteen places in
   2024" and then dropped you at the top of it to scroll for the rest. These
   turn the chronology into a list of *stops* — one per place — while still
   giving every year an equal slice of the track, so the bar you are under
   always matches the year you are in.
   ========================================================================== */

/** Parsed off the `YYYY-MM-DD` string rather than a Date, so no zone can shift it. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One reachable position on the scrubber. */
export type ScrubStop = {
  placeId: string;
  name: string;
  year: number;
  /** Index into `years`, so the histogram can light the bar this stop sits in. */
  yearIndex: number;
  /** Where the stop sits inside its own year; `0` is the year's first place. */
  indexInYear: number;
  /** "Mar" — the month the visit began. */
  month: string;
};

export type ScrubTrack = {
  /** Chronological, matching the order the timeline is drawn in. */
  stops: ScrubStop[];
  /** Slider positions each year is given. Equal for every year, by design. */
  perYear: number;
  /** Index of each year's first stop, index-aligned with `years`. */
  firstStop: number[];
  /** How many stops each year holds, index-aligned with `years`. */
  counts: number[];
  /** The highest slider value; the lowest is always 0. */
  max: number;
};

export function buildScrubTrack(years: TimelineYear[]): ScrubTrack {
  const stops: ScrubStop[] = [];
  const firstStop: number[] = [];
  const counts: number[] = [];
  let busiest = 0;

  years.forEach((year, yearIndex) => {
    firstStop.push(stops.length);
    counts.push(year.entries.length);
    busiest = Math.max(busiest, year.entries.length);

    year.entries.forEach((entry, indexInYear) => {
      stops.push({
        placeId: entry.place.id,
        name: entry.place.name,
        year: year.year,
        yearIndex,
        indexInYear,
        month: MONTHS[Number(entry.start.slice(5, 7)) - 1] ?? "",
      });
    });
  });

  /*
   * Every year owns the same width of track, because the histogram above it is
   * drawn that way and a handle that disagreed with the bar under it would be
   * lying. That slice then has to be fine enough that each stop in the busiest
   * year gets several positions inside it — at one position each, rounding
   * would put two stops on the same value and the second would be unreachable.
   */
  const perYear = Math.max(24, busiest * 4);

  return { stops, firstStop, counts, perYear, max: Math.max(0, years.length * perYear - 1) };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Which stop a slider position lands on. `-1` when there is nothing to land on. */
export function stopAt(track: ScrubTrack, value: number): number {
  if (track.stops.length === 0) return -1;

  const position = clamp(Math.round(value), 0, track.max);
  const yearIndex = Math.min(Math.floor(position / track.perYear), track.counts.length - 1);
  const within = (position - yearIndex * track.perYear) / track.perYear;
  const count = track.counts[yearIndex];

  return track.firstStop[yearIndex] + clamp(Math.floor(within * count), 0, count - 1);
}

/** Where a stop sits on the slider: the middle of the span it owns. */
export function valueAt(track: ScrubTrack, stopIndex: number): number {
  const stop = track.stops[clamp(stopIndex, 0, track.stops.length - 1)];
  if (!stop) return 0;

  const count = track.counts[stop.yearIndex];
  const within = (stop.indexInYear + 0.5) / count;
  return clamp(Math.round((stop.yearIndex + within) * track.perYear), 0, track.max);
}
