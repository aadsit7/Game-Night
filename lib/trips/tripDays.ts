import { effectiveVisitTripId } from "@/lib/places/visits";
import { formatDayHeading, parseCalendarDate } from "@/lib/utils/date";
import type { PlaceVisit, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * A trip, worked out from the places that belong to it.
 *
 * Nothing here is stored in the sheet. Day numbers, day counts, place counts
 * and the countries visited are all derived from the rows that already exist,
 * which is what stops a trip's summary going stale the moment a place is added
 * to it or its dates are edited.
 *
 * Kept as pure functions over `places`, the same array the globe, the timeline
 * and the list read, so a trip can never show a history the rest of the app
 * disagrees with — and so all of the date arithmetic is testable without a
 * browser.
 */

const DAY_MS = 86_400_000;

export type TripDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  /**
   * 1 for the trip's start date, 2 for the day after, and so on. `null` when
   * the trip has no start date to count from.
   */
  dayNumber: number | null;
  /** "Monday, May 4" — the heading under the day number. */
  heading: string;
  places: VisitedPlace[];
};

export type TripGrouping = {
  /** Chronological. */
  days: TripDay[];
  /** In the trip, but dated outside its range — surfaced, never hidden. */
  outside: TripDay[];
  /** In the trip with no date at all. They have no day to sit under. */
  undated: VisitedPlace[];
};

export type TripSummary = {
  /** `endDate - startDate + 1`, or the span the visits themselves cover. */
  days: number | null;
  places: number;
  /** Distinct countries, in the order they were first visited. */
  countries: string[];
  /**
   * The same countries as ISO codes, in the same order — what a flag is drawn
   * from. Kept alongside the names rather than derived from them, because a
   * name is not a code and no lookup table in this app claims otherwise.
   */
  countryCodes: string[];
  /** Distinct cities, in the order they were first visited. */
  cities: string[];
};

/**
 * Whole days from a trip's first day to the given date, counting the first day
 * as 1. `null` when either date is missing or unparseable.
 *
 * Rounded rather than truncated: the two local midnights are 23 or 25 hours
 * apart across a daylight-saving boundary, which would otherwise put a visit
 * on the wrong day. Crossing months and years needs no special case, because
 * the arithmetic is done on instants rather than on the calendar.
 */
export function tripDayNumber(startDate: string | undefined, date: string): number | null {
  const start = parseCalendarDate(startDate);
  const day = parseCalendarDate(date);
  if (!start || !day) return null;
  return Math.round((day.getTime() - start.getTime()) / DAY_MS) + 1;
}

/**
 * A trip's membership, worked out from visits first.
 *
 * Visit.Trip ID is the authoritative relationship: it is what lets Salt Lake
 * City belong to the 2015 trip *and* the 2024 trip without being two pins.
 * The place-level Trip ID cell stays honoured as a fallback for rows written
 * before visits carried trips — a place whose visits never mention any trip
 * still belongs where its own cell says it does. The moment any of a place's
 * visits names a trip, the visit rows are the whole story for that place.
 */
export type TripMembership = {
  /** The visits that belong to this trip, place-resolved where possible. */
  visits: PlaceVisit[];
  /** Every member place, from visits and the legacy fallback alike. */
  places: VisitedPlace[];
  /**
   * Members through the place-level cell alone — no visit rows tie them in.
   * These group by the place's own dates, exactly as they always did.
   */
  legacyPlaces: VisitedPlace[];
};

export function tripMembership(
  trip: Trip | null | undefined,
  places: VisitedPlace[],
  visits: PlaceVisit[] = [],
): TripMembership {
  if (!trip) return { visits: [], places: [], legacyPlaces: [] };

  const byId = new Map(places.map((place) => [place.id, place]));
  const live = visits.filter((visit) => !visit.deletedAt);

  const memberVisits = live.filter(
    (visit) => effectiveVisitTripId(visit, byId.get(visit.placeId), live) === trip.id,
  );
  const placesViaVisits = new Set(memberVisits.map((visit) => visit.placeId));

  const legacyPlaces = places.filter((place) => {
    if (place.tripId !== trip.id || placesViaVisits.has(place.id)) return false;
    // Any visit that names a trip means visit rows own this place's history.
    const own = live.filter((visit) => visit.placeId === place.id);
    return !own.some((visit) => visit.tripId);
  });

  const memberPlaces: VisitedPlace[] = [];
  const seen = new Set<string>();
  for (const visit of memberVisits) {
    const place = byId.get(visit.placeId);
    if (place && !seen.has(place.id)) {
      seen.add(place.id);
      memberPlaces.push(place);
    }
  }
  for (const place of legacyPlaces) {
    if (!seen.has(place.id)) {
      seen.add(place.id);
      memberPlaces.push(place);
    }
  }

  return { visits: memberVisits, places: memberPlaces, legacyPlaces };
}

/**
 * Every place assigned to a trip. With visits supplied, membership follows
 * `tripMembership`; without them it reads the place-level cell alone, which
 * is exactly what every caller did before visits carried trips.
 */
export function placesInTrip(
  trip: Trip | null | undefined,
  places: VisitedPlace[],
  visits?: PlaceVisit[],
): VisitedPlace[] {
  if (!trip) return [];
  if (visits && visits.length > 0) return tripMembership(trip, places, visits).places;
  return places.filter((place) => place.tripId === trip.id);
}

/**
 * Whether a visit's dates sit inside the trip's own.
 *
 * A trip with no dates of its own cannot contradict anything, so nothing is
 * outside it. This only ever *reports*; a visit is never moved or rejected on
 * the strength of it.
 */
export function isVisitOutsideTrip(
  trip: Pick<Trip, "startDate" | "endDate">,
  visitedFrom: string | undefined,
): boolean {
  if (!visitedFrom) return false;
  // Calendar dates are `YYYY-MM-DD`, so string comparison orders them.
  if (trip.startDate && visitedFrom < trip.startDate) return true;
  if (trip.endDate && visitedFrom > trip.endDate) return true;
  return false;
}

/**
 * A trip's places, grouped into the days they happened on.
 *
 * Places share a day when they share a start date. Within a day they keep a
 * stable order — by name, since the sheet stores calendar dates and has no
 * time of day to sort by. A place whose visit spans several days belongs to
 * the day it began on, which is where a person looks for it.
 */
export function groupTripDays(
  trip: Trip,
  places: VisitedPlace[],
  visits: PlaceVisit[] = [],
): TripGrouping {
  const membership = tripMembership(trip, places, visits);
  const byId = new Map(places.map((place) => [place.id, place]));

  const byDate = new Map<string, VisitedPlace[]>();
  const undated: VisitedPlace[] = [];
  const undatedSeen = new Set<string>();

  const add = (date: string | undefined, place: VisitedPlace) => {
    if (!date || !parseCalendarDate(date)) {
      if (!undatedSeen.has(place.id)) {
        undatedSeen.add(place.id);
        undated.push(place);
      }
      return;
    }
    const bucket = byDate.get(date);
    // The same place twice on one day is one row, not an echo.
    if (bucket) {
      if (!bucket.some((existing) => existing.id === place.id)) bucket.push(place);
    } else {
      byDate.set(date, [place]);
    }
  };

  // Member visits pin their place to the day that stay began — which is what
  // lets one city sit under two different days of two different years.
  for (const visit of membership.visits) {
    const place = byId.get(visit.placeId);
    if (place) add(visit.startDate, place);
  }
  // Legacy members group by their own dates, exactly as before.
  for (const place of membership.legacyPlaces) {
    add(place.visitedFrom, place);
  }

  const days: TripDay[] = [];
  const outside: TripDay[] = [];

  for (const [date, group] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const day: TripDay = {
      date,
      dayNumber: tripDayNumber(trip.startDate, date),
      heading: formatDayHeading(date),
      places: [...group].sort((a, b) => a.name.localeCompare(b.name)),
    };
    if (isVisitOutsideTrip(trip, date)) outside.push(day);
    else days.push(day);
  }

  return {
    days,
    outside,
    undated: [...undated].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * The numbers on a trip card, all of them derived.
 *
 * Length comes from the trip's own dates when it has them, because that is
 * what was planned; a trip with no dates falls back to the span its visits
 * actually cover, so a card still says something true rather than nothing.
 */
export function tripSummary(
  trip: Trip,
  places: VisitedPlace[],
  visits: PlaceVisit[] = [],
): TripSummary {
  const inTrip = placesInTrip(trip, places, visits);

  const countries: string[] = [];
  const countryCodes: string[] = [];
  const cities: string[] = [];
  const seenCountry = new Set<string>();
  const seenCode = new Set<string>();
  const seenCity = new Set<string>();

  const dated = [...inTrip].sort((a, b) => (a.visitedFrom ?? "").localeCompare(b.visitedFrom ?? ""));
  for (const place of dated) {
    const country = place.country?.trim();
    if (country && !seenCountry.has(country.toLowerCase())) {
      seenCountry.add(country.toLowerCase());
      countries.push(country);
    }
    const code = place.countryCode?.trim().toUpperCase();
    if (code && !seenCode.has(code)) {
      seenCode.add(code);
      countryCodes.push(code);
    }
    const city = place.city?.trim();
    if (city && !seenCity.has(city.toLowerCase())) {
      seenCity.add(city.toLowerCase());
      cities.push(city);
    }
  }

  return {
    days: tripLength(trip, inTrip),
    places: inTrip.length,
    countries,
    countryCodes,
    cities,
  };
}

function tripLength(trip: Trip, inTrip: VisitedPlace[]): number | null {
  const start = parseCalendarDate(trip.startDate);
  const end = parseCalendarDate(trip.endDate);
  if (start && end && end.getTime() >= start.getTime()) {
    return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  }
  if (start && !end) return 1;

  const dates = inTrip
    .map((place) => place.visitedTo || place.visitedFrom)
    .concat(inTrip.map((place) => place.visitedFrom))
    .filter((date): date is string => Boolean(date && parseCalendarDate(date)))
    .sort();
  if (dates.length === 0) return null;

  const first = parseCalendarDate(dates[0]);
  const last = parseCalendarDate(dates[dates.length - 1]);
  if (!first || !last) return null;
  return Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
}

/**
 * Trips in the order the screen shows them: most recent first.
 *
 * A trip with no dates has no place in a chronology, so it sits after the
 * dated ones rather than at either extreme of them, ordered by when it was
 * created.
 */
export function sortTrips(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    const aDate = a.startDate ?? "";
    const bDate = b.startDate ?? "";
    if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return (
      Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.name.localeCompare(b.name)
    );
  });
}

/** "13 days" · "1 day" — the same wording the timeline uses. */
export function formatTripLength(days: number | null): string | null {
  if (days === null) return null;
  return days === 1 ? "1 day" : `${days} days`;
}

/** "5 places" · "1 place". */
export function formatPlaceCount(count: number): string {
  return count === 1 ? "1 place" : `${count} places`;
}
