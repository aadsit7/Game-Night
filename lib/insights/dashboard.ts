import { continentOf } from "@/lib/insights/continents";
import {
  isCountableVisit,
  matchesTripType,
  yearOf,
  type InsightMetric,
  type InsightOptions,
} from "@/lib/insights/insights";
import { countryKeyOf } from "@/lib/places/grouping";
import {
  isResidenceVisit,
  isUpcomingVisit,
  latestResidence,
  monthYearLabel,
  visitsForPlace,
} from "@/lib/places/visits";
import { inclusiveDayCount, parseCalendarDate, todayCalendarDate } from "@/lib/utils/date";
import { distanceKm, hasValidCoordinates, sphericalCentre, type LngLat } from "@/lib/utils/geo";
import type { PlaceVisit, VisitedPlace } from "@/types/place";

/**
 * The answers a traveller actually opens a stats tab for.
 *
 * `insights.ts` ranks places against each other — who wins, and where you keep
 * going. This asks the other half of the question, the half a leaderboard
 * cannot answer: how much travelling was that, how does this year compare with
 * last, which months am I away, how long is a typical trip of mine, how far
 * from home have I got, and what is still ahead. One pass over the same rows,
 * shaped for a phone screen rather than for a spreadsheet.
 *
 * Pure and clock-injectable: `options.today` exists so a test can ask what
 * "three weeks ago" means without waiting for the calendar.
 */

/** One countable stay, flattened — the unit every figure below is built from. */
export type DashboardEntry = {
  place: VisitedPlace;
  visit: PlaceVisit;
  /** Whole days, both ends counted. Zero when the stay carries no dates. */
  days: number;
  year: number | null;
  /** 0–11, or null when the stay carries no usable date. */
  month: number | null;
};

export type DashboardTotals = {
  /** Stays that happened. Named for what a person calls them. */
  trips: number;
  days: number;
  countries: number;
  places: number;
};

export type MonthTally = { month: number; trips: number; days: number };

export type YearTally = {
  year: number;
  trips: number;
  days: number;
  countries: number;
  /** Countries whose very first stay — in the whole journal — fell this year. */
  newCountries: number;
};

/** A place that holds a record, with the number that earned it. */
export type PlaceRecord = {
  place: VisitedPlace;
  days: number;
  /** "Aug 2026", when the stay behind the record is dated. */
  label: string | null;
};

export type TravelDashboard = {
  totals: DashboardTotals;
  /**
   * The same totals for the year before the one in the lens, so a year can be
   * read against its predecessor. Null under "all time", where there is
   * nothing to compare against.
   */
  previous: { year: number; totals: DashboardTotals } | null;
  /** Countries seen for the first time inside the lens. */
  newCountries: number;
  /** Always twelve, January first, whether or not anything happened. */
  months: MonthTally[];
  /** Every year with a countable stay, oldest first. Never year-filtered. */
  years: YearTally[];
  /** The single longest stay in the lens. */
  longest: PlaceRecord | null;
  /** The middle stay length — a typical trip, unmoved by one long sabbatical. */
  typicalDays: number;
  /** The month you are away most, by the chosen metric. */
  busiestMonth: MonthTally | null;
  /** The most recent stay, and how long ago it started. */
  last: (PlaceRecord & { daysAgo: number | null }) | null;
  /** Where you live, from the residence rows. The wide world needs an origin. */
  home: VisitedPlace | null;
  /**
   * The place in the lens furthest from `home` — or, with nowhere lived
   * recorded, from the middle of everywhere you have been.
   */
  furthest: { place: VisitedPlace; km: number; fromHome: boolean } | null;
  /** First and last year travelled, across the whole journal. */
  span: { from: number; to: number } | null;
  /** One row per continent you have set foot on, biggest first. */
  continents: Array<{ name: string; places: number; countries: number }>;
  /** Stays still ahead, soonest first. */
  upcoming: Array<{ place: VisitedPlace; visit: PlaceVisit; inDays: number | null }>;
  /** Places on the wishlist, and how many countries they would add. */
  wishlist: { places: number; newCountries: number };
};

export type DashboardOptions = InsightOptions & {
  /** `YYYY-MM-DD`. Defaults to the real today; a test pins it. */
  today?: string;
};

/** Countries under 195 is a percentage worth showing; the usual denominator. */
export const COUNTRIES_IN_THE_WORLD = 195;

/** How many trips ahead the horizon card is willing to list. */
export const UPCOMING_LIMIT = 3;

const DAY_MS = 86_400_000;

/** Whole days between two calendar dates, or null when either is unusable. */
export function daysBetween(from: string | undefined, to: string | undefined): number | null {
  const start = parseCalendarDate(from);
  const end = parseCalendarDate(to);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/**
 * Every countable stay in the journal, flattened to one row each.
 *
 * The trip-type lens is applied here and the year lens is not, deliberately:
 * the year-by-year chart has to keep its whole calendar while the boards
 * beside it narrow to one year, and both must be counting the same stays.
 */
export function dashboardEntries(
  places: VisitedPlace[],
  visits: PlaceVisit[],
  options: { tripType?: string; continent?: string; today?: string } = {},
): DashboardEntry[] {
  const { tripType, continent, today } = options;
  const entries: DashboardEntry[] = [];
  for (const place of places) {
    if (place.wantToGo) continue;
    if (continent !== undefined && continentOf(place.countryCode) !== continent) continue;
    for (const visit of visitsForPlace(place, visits)) {
      if (!isCountableVisit(visit, today) || !matchesTripType(visit, tripType)) continue;
      const start = parseCalendarDate(visit.startDate);
      entries.push({
        place,
        visit,
        days: inclusiveDayCount(visit.startDate, visit.endDate) ?? 0,
        year: yearOf(visit.startDate),
        month: start ? start.getMonth() : null,
      });
    }
  }
  return entries;
}

function totalsOf(entries: DashboardEntry[]): DashboardTotals {
  const countries = new Set<string>();
  const places = new Set<string>();
  let days = 0;
  for (const entry of entries) {
    countries.add(countryKeyOf(entry.place));
    places.add(entry.place.id);
    days += entry.days;
  }
  return { trips: entries.length, days, countries: countries.size, places: places.size };
}

/** The middle stay length, rounded. Zero when nothing here has dates. */
function medianDays(entries: DashboardEntry[]): number {
  const lengths = entries
    .map((entry) => entry.days)
    .filter((days) => days > 0)
    .sort((a, b) => a - b);
  if (lengths.length === 0) return 0;
  const middle = Math.floor(lengths.length / 2);
  return lengths.length % 2 === 1
    ? lengths[middle]
    : Math.round((lengths[middle - 1] + lengths[middle]) / 2);
}

/** The year each country was first seen, across the unfiltered calendar. */
function firstYearByCountry(entries: DashboardEntry[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const entry of entries) {
    if (entry.year === null) continue;
    const key = countryKeyOf(entry.place);
    const known = first.get(key);
    if (known === undefined || entry.year < known) first.set(key, entry.year);
  }
  return first;
}

function yearTallies(entries: DashboardEntry[]): YearTally[] {
  const firstSeen = firstYearByCountry(entries);
  const rows = new Map<number, { trips: number; days: number; countries: Set<string> }>();

  for (const entry of entries) {
    if (entry.year === null) continue;
    const row = rows.get(entry.year) ?? { trips: 0, days: 0, countries: new Set<string>() };
    row.trips += 1;
    row.days += entry.days;
    row.countries.add(countryKeyOf(entry.place));
    rows.set(entry.year, row);
  }

  return Array.from(rows.entries())
    .map(([year, row]) => ({
      year,
      trips: row.trips,
      days: row.days,
      countries: row.countries.size,
      newCountries: Array.from(row.countries).filter((key) => firstSeen.get(key) === year).length,
    }))
    .sort((a, b) => a.year - b.year);
}

function monthTallies(entries: DashboardEntry[]): MonthTally[] {
  const months: MonthTally[] = Array.from({ length: 12 }, (_, month) => ({
    month,
    trips: 0,
    days: 0,
  }));
  for (const entry of entries) {
    if (entry.month === null) continue;
    months[entry.month].trips += 1;
    months[entry.month].days += entry.days;
  }
  return months;
}

function weightOf(value: { trips: number; days: number }, metric: InsightMetric): number {
  return metric === "days" ? value.days : value.trips;
}

/** Coordinates worth measuring from, or null. */
function coordsOf(place: VisitedPlace | null | undefined): LngLat | null {
  if (!place || !hasValidCoordinates(place)) return null;
  return { latitude: place.latitude, longitude: place.longitude };
}

/**
 * Everywhere still ahead: dated visits whose day has not come.
 *
 * Read straight off the visit rows rather than through `visitsForPlace`,
 * because a wishlist place with a booking is exactly the case this answers —
 * and a wishlist place has no implicit visit to find.
 */
function upcomingVisits(
  places: VisitedPlace[],
  visits: PlaceVisit[],
  today: string,
  continent: string | undefined,
): TravelDashboard["upcoming"] {
  const byId = new Map(
    places
      .filter(
        (place) => continent === undefined || continentOf(place.countryCode) === continent,
      )
      .map((place) => [place.id, place]),
  );
  const ahead: TravelDashboard["upcoming"] = [];

  for (const visit of visits) {
    if (visit.deletedAt || isResidenceVisit(visit) || !isUpcomingVisit(visit, today)) continue;
    const place = byId.get(visit.placeId);
    if (!place) continue;
    ahead.push({ place, visit, inDays: daysBetween(today, visit.startDate) });
  }

  return ahead.sort((a, b) => (a.visit.startDate ?? "").localeCompare(b.visit.startDate ?? ""));
}

/** Wishlist places, and how many countries they would be the first visit to. */
function wishlistSummary(
  places: VisitedPlace[],
  visited: Set<string>,
  continent: string | undefined,
): TravelDashboard["wishlist"] {
  const wanted = places.filter(
    (place) =>
      place.wantToGo &&
      (continent === undefined || continentOf(place.countryCode) === continent),
  );
  const newCountries = new Set<string>();
  for (const place of wanted) {
    const key = countryKeyOf(place);
    if (!visited.has(key)) newCountries.add(key);
  }
  return { places: wanted.length, newCountries: newCountries.size };
}

/** One row per continent the entries touch, most places first. */
function continentRows(entries: DashboardEntry[]): TravelDashboard["continents"] {
  const rows = new Map<string, { places: Set<string>; countries: Set<string> }>();
  for (const entry of entries) {
    const name = continentOf(entry.place.countryCode);
    const row = rows.get(name) ?? { places: new Set<string>(), countries: new Set<string>() };
    row.places.add(entry.place.id);
    row.countries.add(countryKeyOf(entry.place));
    rows.set(name, row);
  }
  return Array.from(rows.entries())
    .map(([name, row]) => ({ name, places: row.places.size, countries: row.countries.size }))
    .sort((a, b) => b.places - a.places || a.name.localeCompare(b.name));
}

/**
 * The continent coverage a lens sees — deliberately blind to `options.continent`.
 *
 * The strip that draws this is how a region is *chosen*, so it has to keep
 * showing the other six: narrowing it to the continent already selected would
 * turn "six of seven" into "one of one" the moment anyone used it.
 */
export function continentCoverage(
  places: VisitedPlace[],
  visits: PlaceVisit[],
  options: DashboardOptions = {},
): TravelDashboard["continents"] {
  const all = dashboardEntries(places, visits, {
    tripType: options.tripType,
    today: options.today,
  });
  return continentRows(
    options.year === undefined ? all : all.filter((entry) => entry.year === options.year),
  );
}

/**
 * The continents you have actually been to, busiest first — the region
 * filter's vocabulary, always drawn from the unfiltered journal so choosing
 * one never hides the way back to the others.
 */
export function continentsVisited(places: VisitedPlace[], visits: PlaceVisit[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of dashboardEntries(places, visits)) {
    const name = continentOf(entry.place.countryCode);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** Everything the redesigned Stats tab draws, through the lens it is set to. */
export function buildDashboard(
  places: VisitedPlace[],
  visits: PlaceVisit[],
  options: DashboardOptions = {},
): TravelDashboard {
  const metric = options.metric ?? "stays";
  const today = options.today ?? todayCalendarDate();

  const lensYear = options.year;

  /* Everything the trip-type lens allows, whatever year it happened. */
  const all = dashboardEntries(places, visits, {
    tripType: options.tripType,
    continent: options.continent,
    today,
  });
  const lens = lensYear === undefined ? all : all.filter((entry) => entry.year === lensYear);

  const totals = totalsOf(lens);
  const years = yearTallies(all);

  const previous =
    lensYear === undefined
      ? null
      : {
          year: lensYear - 1,
          totals: totalsOf(all.filter((entry) => entry.year === lensYear - 1)),
        };

  /* Countries whose first-ever stay falls inside the lens. Under "all time"
     every country qualifies, which is exactly right: they were all new once. */
  const firstSeen = firstYearByCountry(all);
  const newCountries =
    lensYear === undefined
      ? totals.countries
      : new Set(
          lens
            .map((entry) => countryKeyOf(entry.place))
            .filter((key) => firstSeen.get(key) === lensYear),
        ).size;

  const months = monthTallies(lens);
  const busiest = months.reduce<MonthTally | null>((best, month) => {
    if (weightOf(month, metric) === 0) return best;
    return best === null || weightOf(month, metric) > weightOf(best, metric) ? month : best;
  }, null);

  /* The longest single stay. Ties go to the more recent one — a record you
     have just equalled is the one you remember. */
  const longestEntry = lens.reduce<DashboardEntry | null>((best, entry) => {
    if (entry.days <= 0) return best;
    if (best === null || entry.days > best.days) return entry;
    if (entry.days === best.days && (entry.visit.startDate ?? "") > (best.visit.startDate ?? "")) {
      return entry;
    }
    return best;
  }, null);

  const lastEntry = lens.reduce<DashboardEntry | null>((best, entry) => {
    if (!entry.visit.startDate) return best;
    if (best === null || entry.visit.startDate > (best.visit.startDate ?? "")) return entry;
    return best;
  }, null);

  const residence = latestResidence(visits);
  const home = residence
    ? places.find((place) => place.id === residence.placeId) ?? null
    : null;

  /* Distance is measured from home when there is one, and otherwise from the
     middle of your own map — the honest fallback, and the only origin a
     journal without an address can offer. */
  const origin =
    coordsOf(home) ??
    sphericalCentre(
      lens
        .map((entry) => entry.place)
        .filter(hasValidCoordinates)
        .map((place) => ({ latitude: place.latitude, longitude: place.longitude })),
    );

  let furthest: TravelDashboard["furthest"] = null;
  if (origin) {
    for (const entry of lens) {
      const there = coordsOf(entry.place);
      if (!there) continue;
      const km = distanceKm(origin, there);
      if (km <= 1) continue;
      if (!furthest || km > furthest.km) {
        furthest = { place: entry.place, km, fromHome: home !== null };
      }
    }
  }

  const visitedCountries = new Set(all.map((entry) => countryKeyOf(entry.place)));

  return {
    totals,
    previous,
    newCountries,
    months,
    years,
    longest: longestEntry
      ? {
          place: longestEntry.place,
          days: longestEntry.days,
          label: monthYearLabel(longestEntry.visit.startDate),
        }
      : null,
    typicalDays: medianDays(lens),
    busiestMonth: busiest,
    last: lastEntry
      ? {
          place: lastEntry.place,
          days: lastEntry.days,
          label: monthYearLabel(lastEntry.visit.startDate),
          daysAgo: daysBetween(lastEntry.visit.startDate, today),
        }
      : null,
    home,
    furthest,
    span:
      years.length > 0 ? { from: years[0].year, to: years[years.length - 1].year } : null,
    continents: continentRows(lens),
    upcoming: upcomingVisits(places, visits, today, options.continent),
    wishlist: wishlistSummary(places, visitedCountries, options.continent),
  };
}
