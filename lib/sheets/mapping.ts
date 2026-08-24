import { derivedVisitCells } from "@/lib/places/visits";
import { clampLatitude, isValidLatitude, isValidLongitude, normalizeLongitude } from "@/lib/utils/geo";
import type {
  NewPlaceInput,
  NewVisitInput,
  PlaceChanges,
  PlaceVisit,
  VisitChanges,
  VisitedPlace,
} from "@/types/place";
import type { NewTripInput, Trip, TripChanges } from "@/types/trip";
import type { TravelPhoto } from "@/types/travelPhoto";

/**
 * Translation between the app's travel record and a row of the Places tab.
 *
 * Columns are addressed by header text, never by position. Places is 78
 * columns wide; if a column is ever inserted, position-based code would keep
 * working and quietly write every value one field to the left. Matching on the
 * header means an inserted column moves the target with it, and a *renamed*
 * one fails loudly instead of corrupting data.
 */

export const PLACES_TAB = "Places";
export const VISITS_TAB = "Dates_Visits";
export const TRIPS_TAB = "Trips";
export const MEDIA_TAB = "Media_Links";
export const TRAVEL_PHOTOS_TAB = "Travel_Photos";

/** The columns the app reads and writes. Every other column is left alone. */
export const COLUMNS = {
  id: "Place ID",
  name: "Place Name",
  status: "Status",
  favorite: "Favorite",
  notes: "Personal Notes",
  country: "Country",
  countryCode: "Country Code",
  region: "Region / State",
  city: "City",
  latitude: "Latitude",
  longitude: "Longitude",
  visitedFrom: "First Visited Date",
  visitedTo: "Last Visited Date",
  // Written whenever the visit rows change, so the spreadsheet's own summary
  // columns tell the same story the app derives from Dates_Visits.
  visitCount: "Visit Count",
  daysTotal: "Days Spent Total",
  // Already in the sheet, and meant for exactly this. Reusing it is why trips
  // need no new column on a 78-column tab that other formulas read.
  tripId: "Trip ID / Collection",
  photoUrl: "Photo URL",
  googlePlaceId: "Google Place ID",
  createdAt: "Created At",
  updatedAt: "Updated At",
  deleted: "Deleted?",
  archived: "Archived?",
} as const;

/**
 * Trips columns.
 *
 * Named in the spreadsheet's own style — Title Case, `Deleted?` rather than a
 * timestamp — so the Apps Script's derived-column and soft-delete machinery
 * applies to this tab unchanged.
 */
export const TRIP_COLUMNS = {
  id: "Trip ID",
  name: "Trip Name",
  startDate: "Start Date",
  endDate: "End Date",
  description: "Description",
  coverPlaceId: "Cover Place ID",
  createdAt: "Created At",
  updatedAt: "Updated At",
  deleted: "Deleted?",
  archived: "Archived?",
} as const;

/**
 * Dates_Visits columns. One row per stay; the tab was in the spreadsheet all
 * along ("Repeat rows support multiple trips to the same place", says its own
 * description) — the app now writes it as well as reads it.
 */
export const VISIT_COLUMNS = {
  placeId: "Place ID",
  visitId: "Visit ID",
  start: "Start Date",
  end: "End Date",
  tripId: "Trip ID",
  status: "Visit Status",
  tripType: "Trip Type",
  notes: "Highlights",
  companions: "Companions",
  accommodationName: "Accommodation Name",
  // Derived from the dates on the way out, so the spreadsheet's own columns
  // stay filled in for anyone reading it as a spreadsheet.
  days: "Days",
  year: "Year",
  month: "Month",
  season: "Season",
  createdAt: "Created At",
  updatedAt: "Updated At",
  deleted: "Deleted?",
  archived: "Archived?",
} as const;

/**
 * Media_Links columns. The tab stores URLs against a place; the app uses it
 * for photos uploaded to Drive, which is what lets a photo taken on one phone
 * appear on every device that opens the sheet.
 */
export const MEDIA_COLUMNS = {
  id: "Media ID",
  placeId: "Place ID",
  type: "Media Type",
  title: "Title",
  url: "URL",
  fileName: "File Name",
  createdAt: "Created At",
  updatedAt: "Updated At",
  deleted: "Deleted?",
  archived: "Archived?",
} as const;

/** The Media Type word this app writes and looks for. */
export const MEDIA_TYPE_PHOTO = "Photo";

/**
 * Travel_Photos columns. One row per cloud photo: the Google Photos identity
 * it came from, the visit/trip/place it belongs to, and the two Drive file
 * ids the script serves renditions from. Deliberately its own tab rather than
 * new columns on Media_Links, whose rows mean other things already.
 *
 * There is intentionally no column for a Google Photos `baseUrl`: that link
 * is temporary and persisting one would be persisting a broken image.
 */
export const TRAVEL_PHOTO_COLUMNS = {
  id: "Photo ID",
  googlePhotosItemId: "Google Photos Item ID",
  placeId: "Place ID",
  visitId: "Visit ID",
  tripId: "Trip ID",
  takenAt: "Taken At",
  filename: "Filename",
  mimeType: "MIME Type",
  width: "Width",
  height: "Height",
  thumbDriveFileId: "Thumb Drive File ID",
  displayDriveFileId: "Display Drive File ID",
  videoDriveFileId: "Video Drive File ID",
  source: "Source",
  sortOrder: "Sort Order",
  createdAt: "Created At",
  updatedAt: "Updated At",
  deleted: "Deleted?",
  archived: "Archived?",
} as const;

/**
 * Exact spellings from the Lookups tab. "Been" and "Want to go" are the
 * sheet's own words — writing "visited" or "want_to_go" would fall outside the
 * dropdown and show as an invalid value in the cell.
 */
export const STATUS_BEEN = "Been";
export const STATUS_WANT_TO_GO = "Want to go";

export type SheetTable = { headers: string[]; rows: unknown[][] };

/** Header text to column position, built from whatever the sheet actually has. */
export function indexHeaders(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((header, position) => {
    const key = String(header ?? "").trim();
    if (key && !index.has(key)) index.set(key, position);
  });
  return index;
}

function cell(row: unknown[], index: Map<string, number>, header: string): unknown {
  const position = index.get(header);
  return position === undefined ? undefined : row[position];
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const next = String(value).trim();
  return next.length > 0 ? next : undefined;
}

function isYes(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

/** Matched case-insensitively, because the cell is typed by hand as often as not. */
function isWantToGo(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === STATUS_WANT_TO_GO.toLowerCase();
}

function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim();
  // `Number("")` is 0, which would drop a row with an empty Latitude cell onto
  // the equator off west Africa instead of skipping it as incomplete.
  return raw ? Number(raw) : Number.NaN;
}

/**
 * The sheet stores timestamps in its own timezone and without an offset. The
 * app only ever compares and sorts them, so they are normalised to ISO on the
 * way in and a value that cannot be parsed falls back rather than poisoning a
 * sort with NaN.
 */
function timestamp(value: unknown, fallback: string): string {
  const raw = text(value);
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

/** A plain calendar date, kept exactly as `YYYY-MM-DD`. */
function calendarDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (match) return match[1];

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

/** Only a real link belongs in Photo URL; `photo:` refs are local blobs. */
export function isRemotePhoto(ref: string | undefined): boolean {
  return typeof ref === "string" && /^https?:\/\//i.test(ref);
}

/**
 * One Places row as the app understands it.
 *
 * Returns `null` for a row the app cannot render — no name, or coordinates
 * that aren't on the globe. That is a skip, not a failure: a half-filled row
 * someone started by hand in the sheet should not stop the app loading.
 */
export function placeFromRow(
  row: unknown[],
  index: Map<string, number>,
  fallbackTime: string,
): VisitedPlace | null {
  const id = text(cell(row, index, COLUMNS.id));
  const name = text(cell(row, index, COLUMNS.name));
  if (!id || !name) return null;

  const latitude = numeric(cell(row, index, COLUMNS.latitude));
  const longitude = numeric(cell(row, index, COLUMNS.longitude));
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

  const deleted = isYes(cell(row, index, COLUMNS.deleted));
  const updatedAt = timestamp(cell(row, index, COLUMNS.updatedAt), fallbackTime);
  const photo = text(cell(row, index, COLUMNS.photoUrl));

  return {
    id,
    name,
    city: text(cell(row, index, COLUMNS.city)),
    region: text(cell(row, index, COLUMNS.region)),
    country: text(cell(row, index, COLUMNS.country)) ?? "",
    countryCode: text(cell(row, index, COLUMNS.countryCode))?.toUpperCase(),
    latitude: clampLatitude(latitude),
    longitude: normalizeLongitude(longitude),
    visitedFrom: calendarDate(cell(row, index, COLUMNS.visitedFrom)),
    visitedTo: calendarDate(cell(row, index, COLUMNS.visitedTo)),
    notes: text(cell(row, index, COLUMNS.notes)),
    favorite: isYes(cell(row, index, COLUMNS.favorite)),
    // The sheet's Status holds more words than the app has screens for —
    // "Lived there", "Passed through", "Booked". Only one of them means the
    // place hasn't been visited, so that is the only one read here, and the
    // rest all mean "been". The original word is never lost, because it is
    // only ever written back when this flag is actually flipped.
    wantToGo: isWantToGo(cell(row, index, COLUMNS.status)),
    // Absent on every row written before trips existed, which is exactly what
    // "belongs to no trip" looks like.
    tripId: text(cell(row, index, COLUMNS.tripId)),
    coverImage: isRemotePhoto(photo) ? photo : undefined,
    googlePlaceId: text(cell(row, index, COLUMNS.googlePlaceId)),
    createdAt: timestamp(cell(row, index, COLUMNS.createdAt), fallbackTime),
    updatedAt,
    // The sheet has a Yes/No flag, not a moment. The last write is the closest
    // honest answer to when the deletion happened, and it only ever has to
    // sort and read as "deleted".
    deletedAt: deleted ? updatedAt : undefined,
  };
}

export function placesFromTable(table: SheetTable, fallbackTime: string): VisitedPlace[] {
  const index = indexHeaders(table.headers);
  if (!index.has(COLUMNS.id) || !index.has(COLUMNS.name)) return [];

  const places: VisitedPlace[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const place = placeFromRow(row, index, fallbackTime);
    // Two rows claiming one id would fight over a single pin; the first wins.
    if (place && !seen.has(place.id)) {
      seen.add(place.id);
      places.push(place);
    }
  }
  return places;
}

/**
 * Earliest start and latest end across every visit logged against a place.
 *
 * The app shows one date range per place, but the sheet can hold many visits
 * on Dates_Visits. Folding them into a span is what makes two visits attached
 * to one place both survive a reload instead of one of them disappearing.
 */
export function visitSpans(table: SheetTable): Map<string, { from?: string; to?: string }> {
  const index = indexHeaders(table.headers);
  const spans = new Map<string, { from?: string; to?: string }>();
  if (!index.has(VISIT_COLUMNS.placeId)) return spans;

  for (const row of table.rows) {
    const placeId = text(cell(row, index, VISIT_COLUMNS.placeId));
    if (!placeId) continue;

    const from = calendarDate(cell(row, index, VISIT_COLUMNS.start));
    const to = calendarDate(cell(row, index, VISIT_COLUMNS.end)) ?? from;
    if (!from && !to) continue;

    const span = spans.get(placeId) ?? {};
    if (from && (!span.from || from < span.from)) span.from = from;
    if (to && (!span.to || to > span.to)) span.to = to;
    spans.set(placeId, span);
  }
  return spans;
}

/**
 * Fills a place's dates from its visit rows when Places itself has none.
 *
 * Places wins whenever it has a value, because that is the column the app
 * writes to — otherwise editing a date in the app would appear to do nothing.
 */
export function applyVisitSpans(
  places: VisitedPlace[],
  spans: Map<string, { from?: string; to?: string }>,
): VisitedPlace[] {
  if (spans.size === 0) return places;

  return places.map((place) => {
    const span = spans.get(place.id);
    if (!span) return place;
    if (place.visitedFrom && place.visitedTo) return place;

    return {
      ...place,
      visitedFrom: place.visitedFrom ?? span.from,
      visitedTo: place.visitedTo ?? span.to ?? place.visitedTo,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Visits
 * ------------------------------------------------------------------ */

/**
 * One Dates_Visits row as the app understands it.
 *
 * A row with no visit id or no place id is skipped, same rule as everywhere:
 * a row someone started by hand should not become a broken card.
 */
export function visitFromRow(
  row: unknown[],
  index: Map<string, number>,
  fallbackTime: string,
): PlaceVisit | null {
  const id = text(cell(row, index, VISIT_COLUMNS.visitId));
  const placeId = text(cell(row, index, VISIT_COLUMNS.placeId));
  if (!id || !placeId) return null;

  const deleted = isYes(cell(row, index, VISIT_COLUMNS.deleted));
  const updatedAt = timestamp(cell(row, index, VISIT_COLUMNS.updatedAt), fallbackTime);
  const start = calendarDate(cell(row, index, VISIT_COLUMNS.start));
  const end = calendarDate(cell(row, index, VISIT_COLUMNS.end)) ?? start;

  return {
    id,
    placeId,
    startDate: start,
    // A hand-edited row can end before it starts; folding that into a span
    // would write an inverted First/Last pair back to Places. The start wins.
    endDate: start && end && end < start ? start : end,
    tripId: text(cell(row, index, VISIT_COLUMNS.tripId)),
    status: text(cell(row, index, VISIT_COLUMNS.status)),
    tripType: text(cell(row, index, VISIT_COLUMNS.tripType)),
    notes: text(cell(row, index, VISIT_COLUMNS.notes)),
    companions: text(cell(row, index, VISIT_COLUMNS.companions)),
    accommodationName: text(cell(row, index, VISIT_COLUMNS.accommodationName)),
    createdAt: timestamp(cell(row, index, VISIT_COLUMNS.createdAt), fallbackTime),
    updatedAt,
    deletedAt: deleted ? updatedAt : undefined,
  };
}

/**
 * Every visit on the Dates_Visits tab. An absent tab is not an error — a
 * sheet without one simply has no logged visits, and the Places dates still
 * carry the history exactly as they always did.
 */
export function visitsFromTable(table: SheetTable | undefined, fallbackTime: string): PlaceVisit[] {
  if (!table) return [];
  const index = indexHeaders(table.headers);
  if (!index.has(VISIT_COLUMNS.visitId) || !index.has(VISIT_COLUMNS.placeId)) return [];

  const visits: PlaceVisit[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const visit = visitFromRow(row, index, fallbackTime);
    if (visit && !seen.has(visit.id)) {
      seen.add(visit.id);
      visits.push(visit);
    }
  }
  return visits;
}

/**
 * The cells a visit save should change, keyed by header text.
 *
 * Whenever either date is touched the derived columns — Days, Year, Month,
 * Season — are recomputed and sent along, so the spreadsheet's own view of a
 * visit never drifts from the dates beside it. Timestamps stay the script's.
 */
export function fieldsFromVisitChanges(
  changes: VisitChanges | (NewVisitInput & { placeId?: string }),
  options: { isNew?: boolean; placeId?: string } = {},
): Record<string, string> {
  const fields: Record<string, string> = {};
  const source = changes as Record<string, unknown>;
  const has = (key: string) => key in source;
  const put = (column: string, value: string | undefined) => {
    fields[column] = value ?? "";
  };

  if (options.placeId) put(VISIT_COLUMNS.placeId, options.placeId);

  if (has("startDate")) put(VISIT_COLUMNS.start, (changes as VisitChanges).startDate);
  if (has("endDate")) put(VISIT_COLUMNS.end, (changes as VisitChanges).endDate);
  if (has("tripId")) put(VISIT_COLUMNS.tripId, (changes as VisitChanges).tripId?.trim());
  if (has("tripType")) put(VISIT_COLUMNS.tripType, (changes as VisitChanges).tripType?.trim());
  if (has("status")) put(VISIT_COLUMNS.status, (changes as VisitChanges).status?.trim());
  if (has("notes")) put(VISIT_COLUMNS.notes, (changes as VisitChanges).notes?.trim());
  if (has("companions")) put(VISIT_COLUMNS.companions, (changes as VisitChanges).companions?.trim());
  if (has("accommodationName")) {
    put(VISIT_COLUMNS.accommodationName, (changes as VisitChanges).accommodationName?.trim());
  }

  if (has("startDate") || has("endDate")) {
    const derived = derivedVisitCells(
      (changes as VisitChanges).startDate,
      (changes as VisitChanges).endDate,
    );
    put(VISIT_COLUMNS.days, derived.days);
    put(VISIT_COLUMNS.year, derived.year);
    put(VISIT_COLUMNS.month, derived.month);
    put(VISIT_COLUMNS.season, derived.season);
  }

  if (options.isNew) {
    put(VISIT_COLUMNS.archived, "No");
    put(VISIT_COLUMNS.deleted, "No");
  }

  return fields;
}

/**
 * Keeps a write inside the columns the sheet actually has.
 *
 * The script refuses a field whose header it cannot find — rightly, for a
 * typo — but a sheet whose Dates_Visits tab predates the bookkeeping columns
 * is not a typo, it is an older sheet. Trimming to the headers seen at load
 * time means the visit still saves there, just without the extras.
 */
export function restrictToHeaders(
  fields: Record<string, string>,
  headers: string[] | undefined,
): Record<string, string> {
  if (!headers || headers.length === 0) return fields;
  const allowed = indexHeaders(headers);
  const kept: Record<string, string> = {};
  for (const [column, value] of Object.entries(fields)) {
    if (allowed.has(column)) kept[column] = value;
  }
  return kept;
}

/* ------------------------------------------------------------------ *
 * Travel photos — the cloud gallery
 * ------------------------------------------------------------------ */

/**
 * One Travel_Photos row as the app understands it.
 *
 * A row with no Photo ID is skipped; a row with no Drive file ids is kept —
 * its import may still be completing on another device, and the metadata is
 * already true.
 */
export function travelPhotoFromRow(
  row: unknown[],
  index: Map<string, number>,
  fallbackTime: string,
): TravelPhoto | null {
  const id = text(cell(row, index, TRAVEL_PHOTO_COLUMNS.id));
  if (!id) return null;

  const deleted = isYes(cell(row, index, TRAVEL_PHOTO_COLUMNS.deleted));
  const updatedAt = timestamp(cell(row, index, TRAVEL_PHOTO_COLUMNS.updatedAt), fallbackTime);
  const width = numeric(cell(row, index, TRAVEL_PHOTO_COLUMNS.width));
  const height = numeric(cell(row, index, TRAVEL_PHOTO_COLUMNS.height));
  const sortOrder = numeric(cell(row, index, TRAVEL_PHOTO_COLUMNS.sortOrder));
  const source = text(cell(row, index, TRAVEL_PHOTO_COLUMNS.source));

  return {
    id,
    googlePhotosItemId: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.googlePhotosItemId)),
    placeId: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.placeId)),
    visitId: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.visitId)),
    tripId: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.tripId)),
    takenAt: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.takenAt)),
    filename: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.filename)),
    mimeType: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.mimeType)),
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
    thumbDriveFileId: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.thumbDriveFileId)),
    displayDriveFileId: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.displayDriveFileId)),
    videoDriveFileId: text(cell(row, index, TRAVEL_PHOTO_COLUMNS.videoDriveFileId)),
    source: source === "manual" ? "manual" : "google-photos",
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
    createdAt: timestamp(cell(row, index, TRAVEL_PHOTO_COLUMNS.createdAt), fallbackTime),
    updatedAt,
    deletedAt: deleted ? updatedAt : undefined,
  };
}

/**
 * Every photo on the Travel_Photos tab. An absent tab — a script not yet
 * re-deployed — is simply a sheet with no cloud photos, never an error.
 */
export function travelPhotosFromTable(
  table: SheetTable | undefined,
  fallbackTime: string,
): TravelPhoto[] {
  if (!table) return [];
  const index = indexHeaders(table.headers);
  if (!index.has(TRAVEL_PHOTO_COLUMNS.id)) return [];

  const photos: TravelPhoto[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const photo = travelPhotoFromRow(row, index, fallbackTime);
    if (photo && !seen.has(photo.id)) {
      seen.add(photo.id);
      photos.push(photo);
    }
  }
  return photos;
}

/* ------------------------------------------------------------------ *
 * Media links — remote photos
 * ------------------------------------------------------------------ */

export type MediaLink = {
  id: string;
  placeId: string;
  url: string;
};

/**
 * The photo rows of Media_Links: one per uploaded picture, pointing at the
 * place it belongs to. Rows whose type isn't a photo — websites, bookings,
 * guides — are left for the spreadsheet's own use.
 */
export function mediaFromTable(table: SheetTable | undefined): MediaLink[] {
  if (!table) return [];
  const index = indexHeaders(table.headers);
  if (!index.has(MEDIA_COLUMNS.id) || !index.has(MEDIA_COLUMNS.url)) return [];

  const media: MediaLink[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const id = text(cell(row, index, MEDIA_COLUMNS.id));
    const placeId = text(cell(row, index, MEDIA_COLUMNS.placeId));
    const url = text(cell(row, index, MEDIA_COLUMNS.url));
    const type = text(cell(row, index, MEDIA_COLUMNS.type));
    if (!id || !placeId || !url || seen.has(id)) continue;
    if (isYes(cell(row, index, MEDIA_COLUMNS.deleted))) continue;
    if (type !== MEDIA_TYPE_PHOTO || !isRemotePhoto(url)) continue;

    seen.add(id);
    media.push({ id, placeId, url });
  }
  return media;
}

/**
 * Attaches uploaded photos to their places.
 *
 * The Photo URL column stays the cover; Media_Links holds the rest. Anything
 * already on the place — the cover, a link typed by hand — is not repeated.
 */
export function applyMediaPhotos(places: VisitedPlace[], media: MediaLink[]): VisitedPlace[] {
  if (media.length === 0) return places;

  const byPlace = new Map<string, string[]>();
  for (const link of media) {
    const list = byPlace.get(link.placeId) ?? [];
    list.push(link.url);
    byPlace.set(link.placeId, list);
  }

  return places.map((place) => {
    const urls = byPlace.get(place.id);
    if (!urls) return place;

    const existing = new Set([place.coverImage, ...(place.photos ?? [])]);
    const extra = urls.filter((url) => !existing.has(url));
    if (extra.length === 0) return place;

    // A place with no cover gets one from its uploads, so the card leads with
    // a photograph on every device rather than only the one that took it.
    if (!place.coverImage) {
      const [cover, ...rest] = extra;
      return {
        ...place,
        coverImage: cover,
        photos: [...(place.photos ?? []), ...rest],
      };
    }
    return { ...place, photos: [...(place.photos ?? []), ...extra] };
  });
}

/**
 * The cells a save should change, keyed by header text.
 *
 * Only the fields the app actually owns appear here. Created At, Updated At,
 * Last Synced At, Sync Version, Coordinate Key, Map URL and Search Text are
 * deliberately absent: the Apps Script derives those from the merged row, so
 * they stay right even when a stale copy of the app writes.
 */
export function fieldsFromChanges(
  changes: PlaceChanges | NewPlaceInput,
  existing?: VisitedPlace,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const has = (key: keyof VisitedPlace) => key in (changes as Record<string, unknown>);

  const put = (column: string, value: string | undefined) => {
    fields[column] = value ?? "";
  };

  if (has("name")) put(COLUMNS.name, (changes as PlaceChanges).name?.trim());
  if (has("city")) put(COLUMNS.city, (changes as PlaceChanges).city?.trim());
  if (has("region")) put(COLUMNS.region, (changes as PlaceChanges).region?.trim());
  if (has("country")) put(COLUMNS.country, (changes as PlaceChanges).country?.trim());
  if (has("countryCode")) {
    put(COLUMNS.countryCode, (changes as PlaceChanges).countryCode?.trim().toUpperCase());
  }
  if (has("notes")) put(COLUMNS.notes, (changes as PlaceChanges).notes?.trim());
  if (has("visitedFrom")) put(COLUMNS.visitedFrom, (changes as PlaceChanges).visitedFrom);
  if (has("visitedTo")) put(COLUMNS.visitedTo, (changes as PlaceChanges).visitedTo);
  // An empty string is the whole of "remove this from its trip": the cell is
  // cleared, the row is otherwise untouched, and the place stays in the
  // history exactly as it was.
  if (has("tripId")) put(COLUMNS.tripId, (changes as PlaceChanges).tripId?.trim());
  // Cleared the same way when a place is re-anchored somewhere Google didn't
  // answer for — a stale listing id would send "Open in Google Maps" to the
  // old place.
  if (has("googlePlaceId")) put(COLUMNS.googlePlaceId, (changes as PlaceChanges).googlePlaceId?.trim());

  if (has("latitude") && typeof changes.latitude === "number") {
    put(COLUMNS.latitude, clampLatitude(changes.latitude).toFixed(6));
  }
  if (has("longitude") && typeof changes.longitude === "number") {
    put(COLUMNS.longitude, normalizeLongitude(changes.longitude).toFixed(6));
  }

  // A locally-uploaded photo is a blob in this browser's IndexedDB and has no
  // meaning anywhere else, so it is kept out of the sheet. Clearing the cell
  // only happens when the cover was a link and the link was removed.
  if (has("coverImage")) {
    const cover = (changes as PlaceChanges).coverImage;
    if (isRemotePhoto(cover)) {
      put(COLUMNS.photoUrl, cover);
    } else if (isRemotePhoto(existing?.coverImage)) {
      put(COLUMNS.photoUrl, "");
    }
  }

  if (has("favorite")) put(COLUMNS.favorite, (changes as PlaceChanges).favorite ? "Yes" : "No");

  /*
   * Status is written only when the answer to "have I been?" actually changes.
   *
   * The sheet's own vocabulary is wider than this app's two words — "Lived
   * there", "Passed through", "Booked" — and all of them mean been. Writing
   * "Been" every time a place was saved would flatten every one of them into
   * the blandest word available. Comparing the flags first means a place
   * marked "Lived there" is left saying "Lived there" unless someone actually
   * moves it to the wishlist and back.
   */
  if (has("wantToGo")) {
    const next = Boolean((changes as PlaceChanges).wantToGo);
    if (!existing || Boolean(existing.wantToGo) !== next) {
      put(COLUMNS.status, next ? STATUS_WANT_TO_GO : STATUS_BEEN);
    }
  } else if (!existing) {
    // An older caller that never mentions the flag: fall back to the original
    // rule, which read intent from whether a date was given.
    put(COLUMNS.status, (changes as NewPlaceInput).visitedFrom ? STATUS_BEEN : STATUS_WANT_TO_GO);
  }

  if (!existing) {
    put(COLUMNS.archived, "No");
    put(COLUMNS.deleted, "No");
  }

  return fields;
}

/* ------------------------------------------------------------------ *
 * Trips
 * ------------------------------------------------------------------ */

/**
 * One Trips row as the app understands it.
 *
 * A row with no id or no name is skipped rather than shown as a nameless
 * trip — the same rule the Places tab follows, for the same reason: a row
 * someone started by hand should not become a broken card.
 */
export function tripFromRow(
  row: unknown[],
  index: Map<string, number>,
  fallbackTime: string,
): Trip | null {
  const id = text(cell(row, index, TRIP_COLUMNS.id));
  const name = text(cell(row, index, TRIP_COLUMNS.name));
  if (!id || !name) return null;

  const deleted = isYes(cell(row, index, TRIP_COLUMNS.deleted));
  const updatedAt = timestamp(cell(row, index, TRIP_COLUMNS.updatedAt), fallbackTime);

  return {
    id,
    name,
    startDate: calendarDate(cell(row, index, TRIP_COLUMNS.startDate)),
    endDate: calendarDate(cell(row, index, TRIP_COLUMNS.endDate)),
    description: text(cell(row, index, TRIP_COLUMNS.description)),
    coverPlaceId: text(cell(row, index, TRIP_COLUMNS.coverPlaceId)),
    createdAt: timestamp(cell(row, index, TRIP_COLUMNS.createdAt), fallbackTime),
    updatedAt,
    deletedAt: deleted ? updatedAt : undefined,
  };
}

/**
 * Every trip in the Trips tab.
 *
 * An absent tab is not an error: a sheet whose script hasn't been re-deployed
 * yet simply has no trips, and the rest of the app carries on exactly as it
 * did before trips existed.
 */
export function tripsFromTable(table: SheetTable | undefined, fallbackTime: string): Trip[] {
  if (!table) return [];
  const index = indexHeaders(table.headers);
  if (!index.has(TRIP_COLUMNS.id) || !index.has(TRIP_COLUMNS.name)) return [];

  const trips: Trip[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const trip = tripFromRow(row, index, fallbackTime);
    if (trip && !seen.has(trip.id)) {
      seen.add(trip.id);
      trips.push(trip);
    }
  }
  return trips;
}

/**
 * The cells a trip save should change, keyed by header text.
 *
 * As with places, the timestamps are left out: the Apps Script derives them
 * from the merged row, so they stay right whichever device wrote.
 */
export function fieldsFromTripChanges(changes: TripChanges | NewTripInput): Record<string, string> {
  const fields: Record<string, string> = {};
  const has = (key: keyof Trip) => key in (changes as Record<string, unknown>);
  const put = (column: string, value: string | undefined) => {
    fields[column] = value ?? "";
  };

  if (has("name")) put(TRIP_COLUMNS.name, (changes as TripChanges).name?.trim());
  if (has("startDate")) put(TRIP_COLUMNS.startDate, (changes as TripChanges).startDate);
  if (has("endDate")) put(TRIP_COLUMNS.endDate, (changes as TripChanges).endDate);
  if (has("description")) put(TRIP_COLUMNS.description, (changes as TripChanges).description?.trim());
  if (has("coverPlaceId")) put(TRIP_COLUMNS.coverPlaceId, (changes as TripChanges).coverPlaceId?.trim());

  return fields;
}
