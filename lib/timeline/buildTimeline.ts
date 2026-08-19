import { parseCalendarDate } from "@/lib/utils/date";
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

/**
 * Whole days between two calendar dates, inclusive of both.
 *
 * Rounded because the two local midnights are 23 or 25 hours apart across a
 * daylight-saving boundary, and a trip is not 6.96 days long.
 */
function inclusiveDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function toEntry(place: VisitedPlace): TimelineEntry | null {
  const start = parseCalendarDate(place.visitedFrom);
  if (!start) return null;

  const parsedEnd = parseCalendarDate(place.visitedTo);
  // An end before the start is a typo, not a negative trip; treat it as a day.
  const end = parsedEnd && parsedEnd.getTime() >= start.getTime() ? parsedEnd : start;

  return {
    place,
    start: place.visitedFrom as string,
    end: parsedEnd && parsedEnd.getTime() >= start.getTime() ? (place.visitedTo as string) : (place.visitedFrom as string),
    days: inclusiveDays(start, end),
  };
}

export function buildTimeline(places: VisitedPlace[]): Timeline {
  const entries: TimelineEntry[] = [];
  const undated: VisitedPlace[] = [];

  for (const place of places) {
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
