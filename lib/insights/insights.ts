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

/** One place folded down to its tally; null when nothing countable happened. */
export function tallyPlace(place: VisitedPlace, visits: PlaceVisit[]): PlaceTally | null {
  if (place.wantToGo) return null;

  let stays = 0;
  let days = 0;
  let last: string | undefined;
  const years = new Map<number, { stays: number; days: number }>();

  for (const visit of visitsForPlace(place, visits)) {
    if (!countable(visit)) continue;
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

/** Most stays first, longest first among equals, then the familiar A–Z. */
function byWeight(a: { stays: number; days: number }, b: { stays: number; days: number }): number {
  return b.stays - a.stays || b.days - a.days;
}

function rollUp(
  tallies: PlaceTally[],
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
    (a, b) => byWeight(a, b) || a.label.localeCompare(b.label),
  );
}

/** Everything the Stats tab draws, from the same arrays every view reads. */
export function buildInsights(places: VisitedPlace[], visits: PlaceVisit[]): TravelInsights {
  const tallies = places
    .map((place) => tallyPlace(place, visits))
    .filter((tally): tally is PlaceTally => tally !== null);

  const countries = rollUp(
    tallies,
    countryKeyOf,
    (place) => place.country || "No country",
    (place) => place.countryCode,
  );
  const continents = rollUp(
    tallies,
    (place) => continentOf(place.countryCode),
    (place) => continentOf(place.countryCode),
    () => undefined,
  );

  /* The matrix: the busiest countries against every year that holds a stay,
     newest years kept when there are more than fit. */
  const matrixRows = countries.slice(0, MATRIX_COUNTRY_LIMIT);
  const rowKeys = new Set(matrixRows.map((row) => row.key));
  const cells = new Map<string, MatrixCell>();
  const yearSet = new Set<number>();

  for (const tally of tallies) {
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
      .sort((a, b) => byWeight(a, b) || a.place.name.localeCompare(b.place.name))
      .slice(0, REGULARS_LIMIT),
    countries,
    continents,
    matrix: { rows: matrixRows, years, cells },
  };
}

/* ------------------------------------------------------------------ *
 * Drilling in
 * ------------------------------------------------------------------ */

/** What a leaderboard row or a matrix cell is about. */
export type InsightScope = {
  level: "country" | "continent";
  key: string;
  /** Present when a matrix cell was tapped: just that year's stays. */
  year?: number;
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

  for (const place of places) {
    const key =
      scope.level === "country" ? countryKeyOf(place) : continentOf(place.countryCode);
    if (key !== scope.key) continue;

    const tally = tallyPlace(place, visits);
    if (!tally) continue;

    if (scope.year === undefined) {
      members.push(tally);
      continue;
    }

    // A cell is one year of one country: the drill shows that year's numbers,
    // not the place's lifetime ones.
    const year = tally.years.get(scope.year);
    if (!year) continue;
    members.push({ ...tally, stays: year.stays, days: year.days });
  }

  return members.sort((a, b) => byWeight(a, b) || a.place.name.localeCompare(b.place.name));
}
