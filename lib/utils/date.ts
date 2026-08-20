/**
 * Dates are stored as plain `YYYY-MM-DD` calendar strings — a visit happened on
 * a day, not at an instant — so they are always parsed as local time. Parsing
 * them with `new Date(string)` would treat them as UTC midnight and shift the
 * displayed day backwards for anyone west of Greenwich.
 */

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS_SHORT = MONTHS_LONG.map((m) => (m.length > 5 ? `${m.slice(0, 3)}` : m));

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCalendarDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Reject impossible dates such as 2025-02-31, which JS would roll forward.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function toCalendarDate(date: Date): string {
  const y = date.getFullYear().toString().padStart(4, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayCalendarDate(): string {
  return toCalendarDate(new Date());
}

/**
 * Full, human range used on detail screens.
 *   "May 12, 2025"  ·  "May 12–16, 2025"  ·  "Dec 28, 2024 – Jan 3, 2025"
 */
export function formatVisitRange(from?: string, to?: string): string | null {
  const start = parseCalendarDate(from);
  if (!start) return null;
  const end = parseCalendarDate(to);

  const startMonth = MONTHS_LONG[start.getMonth()];
  const startLabel = `${startMonth} ${start.getDate()}, ${start.getFullYear()}`;

  if (!end || end.getTime() === start.getTime() || end.getTime() < start.getTime()) {
    return startLabel;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${startMonth} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }

  const endMonth = MONTHS_SHORT[end.getMonth()];
  if (sameYear) {
    return `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${start.getFullYear()}`;
  }

  return `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

/**
 * Compact form used on cards, where the month is the useful signal.
 *   "April 2025"  ·  "Apr – Jun 2025"  ·  "Dec 2024 – Jan 2025"
 */
export function formatVisitShort(from?: string, to?: string): string | null {
  const start = parseCalendarDate(from);
  if (!start) return null;
  const end = parseCalendarDate(to);

  const sameMonth =
    !end ||
    (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) ||
    end.getTime() < start.getTime();

  if (sameMonth) {
    return `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
  }

  if (start.getFullYear() === end.getFullYear()) {
    return `${MONTHS_SHORT[start.getMonth()]} – ${MONTHS_SHORT[end.getMonth()]} ${start.getFullYear()}`;
  }

  return `${MONTHS_SHORT[start.getMonth()]} ${start.getFullYear()} – ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

/**
 * A single day, named the way a diary would name it: "Monday, May 4".
 *
 * No year — the heading above it already carries one, and repeating it on
 * every day of a trip is noise. Falls back to the raw value rather than
 * inventing a date the app cannot parse.
 */
export function formatDayHeading(value?: string | null): string {
  const date = parseCalendarDate(value);
  if (!date) return value ?? "";
  return `${WEEKDAYS_LONG[date.getDay()]}, ${MONTHS_LONG[date.getMonth()]} ${date.getDate()}`;
}

/** Sort key for "recently visited" / "oldest visited". */
export function visitTimestamp(from?: string): number | null {
  const date = parseCalendarDate(from);
  return date ? date.getTime() : null;
}
