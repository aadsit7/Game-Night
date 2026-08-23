import {
  inclusiveDayCount,
  parseCalendarDate,
  todayCalendarDate,
  visitTimestamp,
} from "@/lib/utils/date";
import type { PlaceVisit, VisitedPlace } from "@/types/place";

/**
 * The date reasoning behind the visits card, kept pure so it can be tested
 * without a browser.
 *
 * A place owns its visits the way a trip owns nothing: the visit rows point at
 * the place, and everything shown about them — the count, the span, the days
 * total, the "first visited" year — is derived from those rows at render time
 * rather than stored anywhere it could go stale.
 */

/**
 * The one visit a place recorded before visits existed.
 *
 * Every row written by the old app carries its dates on the Places tab and has
 * no Dates_Visits row at all. Those dates are still a visit — the first one —
 * so a place with dates and no visit rows presents them as one, marked with an
 * id no sheet row will ever have. The moment a real visit is logged against
 * the place, this one is written down for real and stops being implicit.
 */
const IMPLICIT_PREFIX = "implicit:";

export function isImplicitVisitId(id: string): boolean {
  return id.startsWith(IMPLICIT_PREFIX);
}

export function implicitVisit(place: VisitedPlace): PlaceVisit | null {
  if (place.wantToGo || !place.visitedFrom) return null;
  return {
    id: `${IMPLICIT_PREFIX}${place.id}`,
    placeId: place.id,
    startDate: place.visitedFrom,
    endDate: place.visitedTo ?? place.visitedFrom,
    tripId: place.tripId,
    createdAt: place.createdAt,
    updatedAt: place.updatedAt,
  };
}

/**
 * The visits to show for one place: its real rows, or the implicit one.
 *
 * Real rows win outright — once any visit has been written down, the place's
 * own date columns are derived from the rows and repeating them as an extra
 * visit would double-count the first trip.
 */
export function visitsForPlace(place: VisitedPlace, visits: PlaceVisit[]): PlaceVisit[] {
  const own = sortVisits(visits.filter((visit) => visit.placeId === place.id));
  if (own.length > 0) return own;
  const implied = implicitVisit(place);
  return implied ? [implied] : [];
}

/** Newest first; undated visits sink to the end, where they can't mislead. */
export function sortVisits(visits: PlaceVisit[]): PlaceVisit[] {
  return [...visits].sort((a, b) => {
    const at = visitTimestamp(a.startDate);
    const bt = visitTimestamp(b.startDate);
    if (at === null && bt === null) return b.createdAt.localeCompare(a.createdAt);
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  });
}

/**
 * Earliest start and latest end across a set of visits — the span the Places
 * tab's First/Last Visited Date columns hold, so the timeline and the sort
 * orders keep working on one pair of dates however many stays there were.
 */
export function visitSpan(visits: PlaceVisit[]): { from?: string; to?: string } {
  const span: { from?: string; to?: string } = {};
  for (const visit of visits) {
    const from = visit.startDate;
    const to = visit.endDate ?? visit.startDate;
    if (from && (!span.from || from < span.from)) span.from = from;
    if (to && (!span.to || to > span.to)) span.to = to;
  }
  return span;
}

/**
 * Visit Status words, from the sheet's own Status vocabulary. A stay that has
 * happened is "Been"; one still ahead is "Planned". Anything else found in a
 * cell — "Booked", "Considering" — is kept as written, never flattened.
 */
export const VISIT_STATUS_BEEN = "Been";
export const VISIT_STATUS_PLANNED = "Planned";

/**
 * The status a stay earns from its start date: already happened means "Been",
 * still ahead means "Planned", and a stay with no date at all is a memory
 * whose date was forgotten, not a plan.
 */
export function visitStatusFor(startDate: string | undefined): string {
  if (!startDate) return VISIT_STATUS_BEEN;
  return startDate > todayCalendarDate() ? VISIT_STATUS_PLANNED : VISIT_STATUS_BEEN;
}

/** Whether a status word means "hasn't happened yet". */
export function isPlannedStatus(status: string | undefined): boolean {
  const word = (status ?? "").trim().toLowerCase();
  return word === "planned" || word === "booked" || word === "considering";
}

/** A stay that is still ahead, by its own date. */
export function isUpcomingVisit(visit: PlaceVisit): boolean {
  return Boolean(visit.startDate && visit.startDate > todayCalendarDate());
}

export type VisitStats = {
  count: number;
  /** Whole days across every visit, both ends counted — a day trip is 1. */
  daysTotal: number;
  /** The year of the earliest visit, e.g. "2015". */
  firstYear: string | null;
  /** The most recent visit as "Aug 2026". */
  lastLabel: string | null;
};

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Aug 2026" — the stats row's shorthand for a calendar date. */
export function monthYearLabel(value: string | undefined): string | null {
  const date = parseCalendarDate(value);
  if (!date) return null;
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

export function visitStats(visits: PlaceVisit[]): VisitStats {
  let daysTotal = 0;
  let first: string | undefined;
  let last: string | undefined;

  for (const visit of visits) {
    daysTotal += inclusiveDayCount(visit.startDate, visit.endDate) ?? 0;
    if (visit.startDate) {
      if (!first || visit.startDate < first) first = visit.startDate;
      if (!last || visit.startDate > last) last = visit.startDate;
    }
  }

  return {
    count: visits.length,
    daysTotal,
    firstYear: first ? first.slice(0, 4) : null,
    lastLabel: monthYearLabel(last),
  };
}

/**
 * What the sheet derives from a visit's dates — Days, Year, Month, Season —
 * written alongside them so the spreadsheet's own columns stay filled in.
 * Northern-hemisphere seasons, matching the sample rows already in the sheet.
 */
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function derivedVisitCells(
  startDate: string | undefined,
  endDate: string | undefined,
): { days: string; year: string; month: string; season: string } {
  const start = parseCalendarDate(startDate);
  if (!start) return { days: "", year: "", month: "", season: "" };

  const month = start.getMonth();
  const season =
    month >= 2 && month <= 4 ? "Spring"
    : month >= 5 && month <= 7 ? "Summer"
    : month >= 8 && month <= 10 ? "Autumn/Fall"
    : "Winter";

  return {
    days: String(inclusiveDayCount(startDate, endDate) ?? ""),
    year: String(start.getFullYear()),
    month: MONTHS_LONG[month],
    season,
  };
}
