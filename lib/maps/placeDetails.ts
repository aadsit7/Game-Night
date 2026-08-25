import { searchWithGoogle } from "@/lib/maps/googlePlaces";
import { normalizePlaceName } from "@/lib/places/dedupe";
import { getPlaceDetails, getPlacePhoto } from "@/lib/sheets/sheetsClient";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import { angularDistance } from "@/lib/utils/geo";
import type { LocationResult, VisitedPlace } from "@/types/place";

/**
 * The card's Google Maps section: one listing, looked up by saved id.
 *
 * Everything here is best-effort by design. A key that is missing, a script
 * too old to answer, a listing Google has retired — any of it means the card
 * simply shows less, never an error. The id is the only thing ever persisted
 * (Google's terms allow storing ids indefinitely and nothing else long-term);
 * the content is fetched fresh and cached briefly.
 */

/** One Google review, reduced to what the display policies ask us to show. */
export type GoogleReview = {
  rating?: number;
  text?: string;
  /** "2 months ago" — Google's own relative phrasing, kept verbatim. */
  when?: string;
  author: string;
  /** The reviewer's Google Maps profile; attribution links here. */
  authorUri?: string;
  avatarUrl?: string;
};

export type GooglePlaceDetails = {
  id: string;
  /** What Google calls the listing — shown when it differs from the saved name. */
  name?: string;
  /** "Historical Landmark", "Coffee Shop" — Google's own label for what it is. */
  kind?: string;
  rating?: number;
  ratingCount?: number;
  openNow?: boolean;
  /** Today's line from the week's hours, "9:30 AM – 11:00 PM". */
  todaysHours?: string;
  address?: string;
  website?: string;
  phone?: string;
  /** Minutes ahead of UTC at the place, for the "local time there" line. */
  utcOffsetMinutes?: number;
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
  /** "$" through "$$$$", from Google's price level. */
  priceLabel?: string;
  /** The entrance takes a wheelchair; the one accessibility fact shown. */
  wheelchairEntrance?: boolean;
  /** Google's one-line editorial description of the place. */
  summary?: string;
  /** The listing on Google Maps itself; "more reviews" points here. */
  googleMapsUri?: string;
  reviews?: GoogleReview[];
  /** Every day's hours, Monday first — the line the card can unfold. */
  weekHours?: string[];
  /** The listing's lead photograph, as a resource name to resolve on use. */
  photoName?: string;
  /** Who took it — shown with the picture, as Google's policies require. */
  photoBy?: string;
  photoByUri?: string;
};

/** Whether this browser's sheet can serve the lookup at all. */
export function hasGoogleDetails(): boolean {
  return (
    sheetPlaceRepository.getCapabilities().placeDetails &&
    sheetPlaceRepository.getConnection() !== null
  );
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Which row of a Monday-first week is "today" — today *at the place*, which
 * is not always today where the phone is: a card for Tokyo opened from New
 * York on Monday evening is asking about Tuesday. Google's
 * `weekdayDescriptions` start on Monday.
 */
export function placeWeekdayIndex(utcOffsetMinutes: number | undefined, now: Date): number {
  const there =
    utcOffsetMinutes === undefined ? now : new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const day = utcOffsetMinutes === undefined ? there.getDay() : there.getUTCDay();
  return (day + 6) % 7;
}

/** Today's line of the week's hours, with the day name pared off. */
export function todaysHoursLine(
  descriptions: unknown,
  utcOffsetMinutes: number | undefined,
  now: Date,
): string | undefined {
  if (!Array.isArray(descriptions) || descriptions.length !== 7) return undefined;

  const line = descriptions[placeWeekdayIndex(utcOffsetMinutes, now)];
  if (typeof line !== "string") return undefined;

  // "Monday: 9:30 AM – 11:00 PM" → the hours; the day is already "today".
  const separated = line.indexOf(": ");
  return text(separated === -1 ? line : line.slice(separated + 2));
}

/** "3:40 PM" at the place, from its UTC offset. */
export function localTimeAt(utcOffsetMinutes: number, now: Date): string {
  const there = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  return there.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** "$" through "$$$$"; unspecified and free stay unlabelled — a museum with
 * no admission is not a "free" restaurant. */
const PRICE_LABELS: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

/** How many reviews a card carries. Three reads; five scrolls. */
const REVIEW_LIMIT = 3;

function toReview(raw: unknown): GoogleReview | null {
  if (typeof raw !== "object" || raw === null) return null;
  const review = raw as Record<string, unknown>;
  const author = (review.authorAttribution ?? {}) as Record<string, unknown>;
  const name = text(author.displayName);
  const body = text((review.text as Record<string, unknown> | undefined)?.text);
  const stars = count(review.rating);

  // Google's policies want reviews credited; one with no author is not
  // something this card can show, and one with neither text nor stars has
  // nothing to say.
  if (!name || (!body && stars === undefined)) return null;

  return {
    rating: stars !== undefined && stars >= 1 && stars <= 5 ? stars : undefined,
    text: body,
    when: text(review.relativePublishTimeDescription),
    author: name,
    authorUri: text(author.uri),
    avatarUrl: text(author.photoUri),
  };
}

/** The raw field-masked payload, shaped into exactly what a card shows. */
export function toGooglePlaceDetails(raw: unknown, now: Date = new Date()): GooglePlaceDetails | null {
  if (typeof raw !== "object" || raw === null) return null;
  const place = raw as Record<string, unknown>;
  const id = text(place.id);
  if (!id) return null;

  const hours = (place.currentOpeningHours ?? {}) as Record<string, unknown>;
  const offset = count(place.utcOffsetMinutes);
  const rating = count(place.rating);
  const status = text(place.businessStatus);
  const access = (place.accessibilityOptions ?? {}) as Record<string, unknown>;
  const reviews = (Array.isArray(place.reviews) ? place.reviews : [])
    .map(toReview)
    .filter((review): review is GoogleReview => review !== null)
    .slice(0, REVIEW_LIMIT);

  return {
    id,
    name: text((place.displayName as Record<string, unknown> | undefined)?.text),
    kind: text((place.primaryTypeDisplayName as Record<string, unknown> | undefined)?.text),
    // A rating outside the scale is a payload problem, not something to draw.
    rating: rating !== undefined && rating >= 1 && rating <= 5 ? rating : undefined,
    ratingCount: count(place.userRatingCount),
    openNow: typeof hours.openNow === "boolean" ? hours.openNow : undefined,
    todaysHours: todaysHoursLine(hours.weekdayDescriptions, offset, now),
    address: text(place.shortFormattedAddress),
    website: text(place.websiteUri),
    phone: text(place.nationalPhoneNumber) ?? text(place.internationalPhoneNumber),
    utcOffsetMinutes: offset,
    permanentlyClosed: status === "CLOSED_PERMANENTLY" || undefined,
    temporarilyClosed: status === "CLOSED_TEMPORARILY" || undefined,
    priceLabel: PRICE_LABELS[text(place.priceLevel) ?? ""],
    wheelchairEntrance: access.wheelchairAccessibleEntrance === true || undefined,
    summary: text((place.editorialSummary as Record<string, unknown> | undefined)?.text),
    googleMapsUri: text(place.googleMapsUri),
    reviews: reviews.length > 0 ? reviews : undefined,
    weekHours:
      Array.isArray(hours.weekdayDescriptions) &&
      hours.weekdayDescriptions.length === 7 &&
      hours.weekdayDescriptions.every((line) => typeof line === "string")
        ? (hours.weekdayDescriptions as string[])
        : undefined,
    ...leadPhoto(place.photos),
  };
}

/** The first photo's name and credit; the picture itself is fetched on use. */
function leadPhoto(
  raw: unknown,
): Pick<GooglePlaceDetails, "photoName" | "photoBy" | "photoByUri"> {
  if (!Array.isArray(raw) || raw.length === 0) return {};
  const photo = raw[0] as Record<string, unknown>;
  const name = text(photo.name);
  if (!name) return {};

  const author = (Array.isArray(photo.authorAttributions) ? photo.authorAttributions[0] : {}) as
    | Record<string, unknown>
    | undefined;
  return {
    photoName: name,
    photoBy: text(author?.displayName),
    photoByUri: text(author?.uri),
  };
}

/* ------------------------------------------------------------------ *
 * A short cache, so reopening a card is free
 *
 * Six hours, matching the script's own cache — fresh enough for "open
 * now", far inside what Google's terms allow, and long enough that one
 * afternoon of browsing bills each listing once.
 * ------------------------------------------------------------------ */

const CACHE_KEY = "travel-globe.place-details.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** More listings than anyone opens in six hours; keeps the entry small. */
const CACHE_MAX_ENTRIES = 120;

type CacheShape = Record<string, { at: number; place: GooglePlaceDetails }>;

function readCache(): CacheShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? ((JSON.parse(raw) as CacheShape) ?? {}) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private mode or a full quota — the cache is a nicety, never a need.
  }
  summaryMemo = null;
}

function cachedDetails(id: string, now: number): GooglePlaceDetails | null {
  const entry = readCache()[id];
  return entry && now - entry.at < CACHE_TTL_MS ? entry.place : null;
}

function rememberDetails(id: string, place: GooglePlaceDetails, now: number): void {
  const cache = readCache();
  cache[id] = { at: now, place };

  const entries = Object.entries(cache).filter(([, value]) => now - value.at < CACHE_TTL_MS);
  entries.sort((a, b) => b[1].at - a[1].at);
  writeCache(Object.fromEntries(entries.slice(0, CACHE_MAX_ENTRIES)));
}

/* ------------------------------------------------------------------ *
 * What a list card may borrow
 *
 * The Places list never fetches — two hundred rows would spend a month's
 * free calls in an afternoon. It borrows instead: whatever the card opens
 * have already put in the cache. The borrowed facts are the stable ones
 * (a rating moves by hundredths; closed-for-good is forever), so the list
 * may read entries the card would consider stale — up to a week, well
 * inside the thirty days Google's terms allow.
 * ------------------------------------------------------------------ */

export type GoogleSummary = {
  rating?: number;
  ratingCount?: number;
  permanentlyClosed?: boolean;
};

const SUMMARY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** One parse per render pass, not one per row of a two-hundred-place list. */
let summaryMemo: CacheShape | null = null;

export function googleSummaryFor(googlePlaceId: string | undefined): GoogleSummary | null {
  if (!googlePlaceId) return null;
  if (!summaryMemo) summaryMemo = readCache();

  const entry = summaryMemo[googlePlaceId];
  if (!entry || Date.now() - entry.at >= SUMMARY_TTL_MS) return null;

  const { rating, ratingCount, permanentlyClosed } = entry.place;
  if (rating === undefined && !permanentlyClosed) return null;
  return { rating, ratingCount, permanentlyClosed };
}

/** Photon's trick, repeated: ask Google in the viewer's own language. */
function language(): string {
  if (typeof navigator === "undefined") return "en";
  return navigator.language?.split("-")[0] ?? "en";
}

/**
 * The listing behind a saved id, or null for any reason at all — no key, an
 * old script, a retired id, a bad connection. Callers render what they get.
 */
export async function fetchGoogleDetails(
  googlePlaceId: string,
  options: { signal?: AbortSignal } = {},
): Promise<GooglePlaceDetails | null> {
  const id = googlePlaceId.trim();
  if (!id || !hasGoogleDetails()) return null;

  const now = Date.now();
  const cached = cachedDetails(id, now);
  if (cached) return cached;

  const connection = sheetPlaceRepository.getConnection();
  if (!connection) return null;

  try {
    const raw = await getPlaceDetails(connection, { id, language: language() }, options.signal);
    const details = toGooglePlaceDetails(raw);
    if (details) rememberDetails(id, details, now);
    return details;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    console.warn("Google place details lookup failed; the card shows less.", error);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The borrowed photograph
 *
 * Shown only where the traveller has no photo of their own, so each is a
 * once-per-place lookup against the photo call's own monthly allowance.
 * Cached for a week — the picture of a landmark does not churn — and
 * display-only throughout: the address is never written to the sheet,
 * which is what Google's terms ask of their content.
 * ------------------------------------------------------------------ */

const PHOTO_CACHE_KEY = "travel-globe.place-photo.v1";
const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PHOTO_CACHE_MAX = 200;

type PhotoCache = Record<string, { at: number; uri: string }>;

function readPhotoCache(): PhotoCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PHOTO_CACHE_KEY);
    return raw ? ((JSON.parse(raw) as PhotoCache) ?? {}) : {};
  } catch {
    return {};
  }
}

function writePhotoCache(cache: PhotoCache): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const entries = Object.entries(cache).filter(([, value]) => now - value.at < PHOTO_TTL_MS);
    entries.sort((a, b) => b[1].at - a[1].at);
    window.localStorage.setItem(
      PHOTO_CACHE_KEY,
      JSON.stringify(Object.fromEntries(entries.slice(0, PHOTO_CACHE_MAX))),
    );
  } catch {
    // The cache is a nicety, never a need.
  }
}

/**
 * The image address behind a photo name, or null for any reason at all.
 * Keyed by the place rather than the photo: names churn as Google refreshes
 * a listing, and one picture per place per week is the whole appetite.
 */
export async function fetchGooglePhotoUri(
  googlePlaceId: string,
  photoName: string,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  if (!hasGoogleDetails()) return null;

  const cached = readPhotoCache()[googlePlaceId];
  if (cached && Date.now() - cached.at < PHOTO_TTL_MS) return cached.uri;

  const connection = sheetPlaceRepository.getConnection();
  if (!connection) return null;

  try {
    const uri = await getPlacePhoto(connection, { name: photoName }, options.signal);
    if (!uri) return null;
    const cache = readPhotoCache();
    cache[googlePlaceId] = { at: Date.now(), uri };
    writePhotoCache(cache);
    return uri;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    console.warn("Google place photo lookup failed; the card stays photo-less.", error);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Linking places saved before listings were
 * ------------------------------------------------------------------ */

/** One degree of great circle is ~111.3 km. */
const METERS_PER_DEGREE = 111_320;

/**
 * Same rooftop: two pins this close are one place whatever they are called.
 * Matches the dedupe rule for "the same spot", for the same reason.
 */
const SAME_SPOT_METERS = 60;

/**
 * How far a listing may sit from the saved pin when the names agree. Wide
 * enough for a hand-adjusted pin or a venue's other gate; narrower than two
 * same-named branches usually sit apart.
 */
const SAME_NAME_METERS = 250;

function namesAgree(a: string, b: string): boolean {
  const nameA = normalizePlaceName(a);
  const nameB = normalizePlaceName(b);
  if (!nameA || !nameB) return false;
  if (nameA === nameB || nameA.includes(nameB) || nameB.includes(nameA)) return true;

  // "Basilica de la Sagrada Familia" vs "Sagrada Família": most of the shorter
  // name's words appearing in the longer one is agreement enough — alongside a
  // distance check, never alone.
  const tokensA = new Set(nameA.split(" "));
  const tokensB = nameB.split(" ");
  const [shorter, longer] =
    tokensA.size <= tokensB.length ? [Array.from(tokensA), new Set(tokensB)] : [tokensB, tokensA];
  const shared = shorter.filter((token) => longer.has(token)).length;
  return shared >= Math.max(1, Math.ceil(shorter.length / 2));
}

/**
 * The one result that is confidently this place, or null.
 *
 * Conservative on purpose: a wrong link sends "Open in Google Maps" — and the
 * whole Google section — to somebody else's listing, while no link merely
 * leaves the card as it was. Results arrive ranked, so the first confident
 * match wins.
 */
export function pickGoogleListing(
  place: Pick<VisitedPlace, "name" | "latitude" | "longitude">,
  results: LocationResult[],
): string | null {
  for (const result of results) {
    const id = result.googlePlaceId;
    if (!id) continue;

    const meters =
      angularDistance(
        { latitude: place.latitude, longitude: place.longitude },
        { latitude: result.latitude, longitude: result.longitude },
      ) * METERS_PER_DEGREE;

    if (meters <= SAME_SPOT_METERS) return id;
    if (meters <= SAME_NAME_METERS && namesAgree(place.name, result.name)) return id;
  }
  return null;
}

/**
 * One search per place per session, shared by whoever asks.
 *
 * The card's effect can run twice for one open — React remounts effects in
 * development, and a link landing re-renders the sheet — and each run must
 * see the same answer rather than the second finding the attempt "used up".
 * The promise is the memo: a settled "no" holds for the session, a failure
 * is forgotten so the next open can try again.
 */
const attempts = new Map<string, Promise<string | null>>();

/**
 * Finds the Google listing for a place saved before listings were captured,
 * so the card's Google section lights up for the whole journal rather than
 * only for places added from now on. One search, biased to the saved pin;
 * only a confident match comes back. The caller persists it.
 *
 * Deliberately not abortable: by the time a card is closed the search is
 * usually answered, and an answer worth having is worth keeping either way.
 */
export function autoLinkGooglePlace(place: VisitedPlace): Promise<string | null> {
  if (place.googlePlaceId) return Promise.resolve(null);
  if (!sheetPlaceRepository.getCapabilities().placesSearch) return Promise.resolve(null);
  const connection = sheetPlaceRepository.getConnection();
  if (!connection) return Promise.resolve(null);

  const pending = attempts.get(place.id);
  if (pending) return pending;

  const attempt = searchWithGoogle(connection, place.name, {
    proximity: [place.longitude, place.latitude],
    language: language(),
  })
    .then((results) => pickGoogleListing(place, results))
    .catch((error) => {
      // A failed search is not "no listing" — forget it, so a card opened
      // after the network recovers simply asks again.
      attempts.delete(place.id);
      console.warn("Could not look for this place's Google listing.", error);
      return null;
    });

  attempts.set(place.id, attempt);
  return attempt;
}
