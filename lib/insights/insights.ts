import { continentOf } from "@/lib/insights/continents";
import { countryKeyOf } from "@/lib/places/grouping";
import {
  isResidenceVisit,
  isUpcomingVisit,
  monthYearLabel,
  visitsForPlace,
} from "@/lib/places/visits";
import { inclusiveDayCount } from "@/lib/utils/date";
import type { PlaceVisit, VisitedPlace } from "@/types/place";

/**
 * The numbers behind "where do I keep going?".
 *
 * Everything here counts the same thing the place card's own pill counts: a
 * stay that has actually happened. Wishlist entries are plans, upcoming
 * visits haven't happened yet, and living somewhere is not visiting it —
 * all three are excluded, so a place can never rank above another on the
 * strength of intentions or an address.
 *
 * Pure functions over the same arrays every view reads; nothing is fetched
 * and nothing is stored.
 */

/** One place's countable history: how often, how long, how recently, when. */
export type PlaceTally = {
  place: VisitedPlace;
  /** Stays that happened — no residences, no upcoming, no wishlist. */
  stays: number;
  days: number;
  /** "Mar 2026", from the latest stay with a date. */
  lastLabel: string | null;
  /** Stays and days by calendar year, for the matrix. */
  years: Map<number, { stays: number; days: number }>;
};

/** A rollup row: one country or one continent. */
export type LevelTally = {
  key: string;
  label: string;
  /** Present for countries; a continent has no flag. */
  code?: string;
  places: number;
  stays: number;
  days: number;
};

export type MatrixCell = { stays: number; days: number };

/** The years-by-countries grid: rows are countries, columns are years. */
export type TravelMatrix = {
  rows: LevelTally[];
  years: number[];
  /** Keyed `${countryKey}:${year}`; absent means an empty cell. */
  cells: Map<string, MatrixCell>;
};

export type TravelInsights = {
  totals: { places: number; countries: number; stays: number; days: number };
  /** Places been to more than once, most-visited first. */
  regulars: PlaceTally[];
  countries: LevelTally[];
  continents: LevelTally[];
  matrix: TravelMatrix;
};

/** Which number leads: how often you went, or how long you stayed. */
export type InsightMetric = "stays" | "days";

/**
 * The lens the whole tab looks through. A year narrows every list to stays
 * that started then; a trip type narrows them to the visits logged that way
 * ("Family", "Solo" — the sheet's own words); the metric decides what leads
 * the ranking. The matrix keeps all its years whatever the year filter says —
 * it *is* the year view — but honours the other two.
 */
export type InsightOptions = {
  year?: number;
  tripType?: string;
  metric?: InsightMetric;
};

/** How far a leaderboard runs before it stops being a podium. */
export const REGULARS_LIMIT = 8;
/** Rows the matrix shows; more would be a spreadsheet, not a picture. */
export const MATRIX_COUNTRY_LIMIT = 8;
/** Columns the matrix shows; the scroll keeps older years reachable. */
export const MATRIX_YEAR_LIMIT = 12;

function countable(visit: PlaceVisit): boolean {
  return !isResidenceVisit(visit) && !isUpcomingVisit(visit);
}

function yearOf(date: string | undefined): number | null {
  const year = date ? Number(date.slice(0, 4)) : Number.NaN;
  return Number.isInteger(year) && year > 1000 ? year : null;
}

/** The filters' idea of a match, case- and whitespace-blind. */
function normalType(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function passesFilters(visit: PlaceVisit, options: InsightOptions): boolean {
  if (options.year !== undefined && yearOf(visit.startDate) !== options.year) return false;
  // A visit that never said what kind of trip it was cannot claim to be a
  // family one — under a type filter, unlabelled visits sit out.
  if (options.tripType !== undefined && normalType(visit.tripType) !== normalType(options.tripType)) {
    return false;
  }
  return true;
}

/** One place folded down to its tally; null when nothing countable happened. */
export function tallyPlace(
  place: VisitedPlace,
  visits: PlaceVisit[],
  options: InsightOptions = {},
): PlaceTally | null {
  if (place.wantToGo) return null;

  let stays = 0;
  let days = 0;
  let last: string | undefined;
  const years = new Map<number, { stays: number; days: number }>();

  for (const visit of visitsForPlace(place, visits)) {
    if (!countable(visit) || !passesFilters(visit, options)) continue;
    const visitDays = inclusiveDayCount(visit.startDate, visit.endDate) ?? 0;
    stays += 1;
    days += visitDays;
    if (visit.startDate && (!last || visit.startDate > last)) last = visit.startDate;

    const year = yearOf(visit.startDate);
    if (year !== null) {
      const cell = years.get(year) ?? { stays: 0, days: 0 };
      cell.stays += 1;
      cell.days += visitDays;
      years.set(year, cell);
    }
  }

  if (stays === 0) return null;
  return { place, stays, days, lastLabel: monthYearLabel(last), years };
}

/** The chosen metric leads; the other breaks ties; A–Z is the caller's last resort. */
function byWeight(
  a: { stays: number; days: number },
  b: { stays: number; days: number },
  metric: InsightMetric = "stays",
): number {
  return metric === "days"
    ? b.days - a.days || b.stays - a.stays
    : b.stays - a.stays || b.days - a.days;
}

function rollUp(
  tallies: PlaceTally[],
  metric: InsightMetric,
  keyOf: (place: VisitedPlace) => string,
  labelOf: (place: VisitedPlace) => string,
  codeOf: (place: VisitedPlace) => string | undefined,
): LevelTally[] {
  const rows = new Map<string, LevelTally>();
  for (const tally of tallies) {
    const key = keyOf(tally.place);
    const row = rows.get(key);
    if (row) {
      row.places += 1;
      row.stays += tally.stays;
      row.days += tally.days;
      if (!row.code) row.code = codeOf(tally.place);
    } else {
      rows.set(key, {
        key,
        label: labelOf(tally.place),
        code: codeOf(tally.place),
        places: 1,
        stays: tally.stays,
        days: tally.days,
      });
    }
  }
  return Array.from(rows.values()).sort(
    (a, b) => byWeight(a, b, metric) || a.label.localeCompare(b.label),
  );
}

function talliesFor(
  places: VisitedPlace[],
  visits: PlaceVisit[],
  options: InsightOptions,
): PlaceTally[] {
  return places
    .map((place) => tallyPlace(place, visits, options))
    .filter((tally): tally is PlaceTally => tally !== null);
}

/** Everything the Stats tab draws, through whatever lens the filters set. */
export function buildInsights(
  places: VisitedPlace[],
  visits: PlaceVisit[],
  options: InsightOptions = {},
): TravelInsights {
  const metric = options.metric ?? "stays";
  const tallies = talliesFor(places, visits, options);

  const countries = rollUp(
    tallies,
    metric,
    countryKeyOf,
    (place) => place.country || "No country",
    (place) => place.countryCode,
  );
  const continents = rollUp(
    tallies,
    metric,
    (place) => continentOf(place.countryCode),
    (place) => continentOf(place.countryCode),
    () => undefined,
  );

  /* The matrix: the busiest countries against every year that holds a stay,
     newest years kept when there are more than fit. It is the year view, so
     the year filter never narrows it — the other filters do. */
  const matrixTallies =
    options.year === undefined ? tallies : talliesFor(places, visits, { ...options, year: undefined });
  const matrixRows = (options.year === undefined
    ? countries
    : rollUp(matrixTallies, metric, countryKeyOf, (place) => place.country || "No country", (place) => place.countryCode)
  ).slice(0, MATRIX_COUNTRY_LIMIT);
  const rowKeys = new Set(matrixRows.map((row) => row.key));
  const cells = new Map<string, MatrixCell>();
  const yearSet = new Set<number>();

  for (const tally of matrixTallies) {
    const key = countryKeyOf(tally.place);
    if (!rowKeys.has(key)) continue;
    for (const [year, count] of tally.years) {
      yearSet.add(year);
      const cellKey = `${key}:${year}`;
      const cell = cells.get(cellKey) ?? { stays: 0, days: 0 };
      cell.stays += count.stays;
      cell.days += count.days;
      cells.set(cellKey, cell);
    }
  }

  const years = Array.from(yearSet).sort((a, b) => a - b).slice(-MATRIX_YEAR_LIMIT);

  return {
    totals: {
      places: tallies.length,
      countries: countries.length,
      stays: tallies.reduce((sum, tally) => sum + tally.stays, 0),
      days: tallies.reduce((sum, tally) => sum + tally.days, 0),
    },
    regulars: tallies
      .filter((tally) => tally.stays >= 2)
      .sort((a, b) => byWeight(a, b, metric) || a.place.name.localeCompare(b.place.name))
      .slice(0, REGULARS_LIMIT),
    countries,
    continents,
    matrix: { rows: matrixRows, years, cells },
  };
}

/**
 * Every year with a countable stay, newest first — the year filter's
 * vocabulary, always drawn from the unfiltered journal so choosing one year
 * never hides the way back to the others.
 */
export function visitYears(places: VisitedPlace[], visits: PlaceVisit[]): number[] {
  const years = new Set<number>();
  for (const tally of talliesFor(places, visits, {})) {
    for (const year of tally.years.keys()) years.add(year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * The trip-type words the sheet actually uses — "Family", "Solo", whatever
 * was typed — most frequent first, one spelling per word. The filter offers
 * only words that exist, so no chip is ever a dead end.
 */
export function tripTypesOf(visits: PlaceVisit[]): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const visit of visits) {
    if (visit.deletedAt || !countable(visit)) continue;
    const key = normalType(visit.tripType);
    if (!key) continue;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label: visit.tripType!.trim(), count: 1 });
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((entry) => entry.label);
}

/* ------------------------------------------------------------------ *
 * Drilling in
 * ------------------------------------------------------------------ */

/**
 * What a leaderboard row or a matrix cell is about — including the filters
 * that were on when it was tapped, so the drill answers the same question
 * the number did.
 */
export type InsightScope = {
  level: "country" | "continent";
  key: string;
  /** Present when a matrix cell was tapped, or a year filter was on. */
  year?: number;
  /** Present when a trip-type filter was on. */
  tripType?: string;
  metric?: InsightMetric;
};

/**
 * The places behind a scope, tallied for the drill sheet — recomputed from
 * live data on every open, so a sync landing mid-browse can never leave the
 * sheet listing a place that no longer answers for it.
 */
export function scopeMembers(
  scope: InsightScope,
  places: VisitedPlace[],
  visits: PlaceVisit[],
): PlaceTally[] {
  const members: PlaceTally[] = [];
  const options: InsightOptions = { year: scope.year, tripType: scope.tripType };

  for (const place of places) {
    const key =
      scope.level === "country" ? countryKeyOf(place) : continentOf(place.countryCode);
    if (key !== scope.key) continue;

    // The scope's own numbers — a cell's drill shows that year's stays, a
    // filtered board's drill shows the filtered ones, never the lifetime.
    const tally = tallyPlace(place, visits, options);
    if (!tally) continue;
    members.push(tally);
  }

  return members.sort(
    (a, b) => byWeight(a, b, scope.metric ?? "stays") || a.place.name.localeCompare(b.place.name),
  );
}
