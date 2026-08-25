import { searchWithGoogle } from "@/lib/maps/googlePlaces";
import { searchWithOpenStreetMap } from "@/lib/maps/geocoding";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import type { LocationResult, VisitedPlace } from "@/types/place";

/**
 * The one place the app asks "where is this?".
 *
 * Two providers sit behind it. Google Places answers when the sheet's script
 * has an API key, because it is markedly better at the thing this app is for —
 * "Blue Bottle Coffee" comes back as four distinguishable branches with
 * addresses rather than four identical rows. OpenStreetMap answers otherwise,
 * needs no key, and is what keeps the promise that opening the URL is all the
 * setup there is.
 *
 * Google is never a hard dependency. A key that is missing, restricted,
 * unbilled or simply having a bad minute falls through to the keyless search
 * rather than leaving someone unable to add a place — the failure is logged
 * for whoever set it up and invisible to whoever is typing.
 */

export { GeocodingError, GEOCODING_UNAVAILABLE, reverseGeocode } from "@/lib/maps/geocoding";

/** Photon carries a handful of localisations; anything else falls back. */
function language(): string {
  if (typeof navigator === "undefined") return "en";
  return navigator.language?.split("-")[0] ?? "en";
}

/** Whether this browser's sheet can serve a Places search right now. */
export function hasPlacesSearch(): boolean {
  return (
    sheetPlaceRepository.getCapabilities().placesSearch &&
    sheetPlaceRepository.getConnection() !== null
  );
}

/* ------------------------------------------------------------------ *
 * A short memory of recent searches
 *
 * The round trip through the sheet's script takes a second or two; typing
 * "kyo", backspacing, and typing it again should not pay that twice. Half an
 * hour matches the script's own server-side cache, and is far inside what
 * Google's terms allow. Bias is part of the question — the same word asked
 * from the other side of the world is a different search — so it is part of
 * the key, rounded to the degree so a nudged globe still hits.
 * ------------------------------------------------------------------ */

const SEARCH_CACHE_KEY = "travel-globe.search-cache.v1";
const SEARCH_TTL_MS = 30 * 60_000;
const SEARCH_CACHE_MAX = 40;

type CachedSearch = { at: number; results: LocationResult[] };

/** One search, as a cache key: what was asked, from where, in which tongue. */
export function searchCacheKey(
  term: string,
  proximity: [number, number] | undefined,
  lang: string,
): string {
  const bias = proximity ? `${Math.round(proximity[0])},${Math.round(proximity[1])}` : "-";
  return `${lang}:${bias}:${term.toLowerCase()}`;
}

function readSearchCache(): Record<string, CachedSearch> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SEARCH_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CachedSearch>) : {};
  } catch {
    return {};
  }
}

function writeSearchCache(cache: Record<string, CachedSearch>): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(cache)
      .filter(([, entry]) => Date.now() - entry.at < SEARCH_TTL_MS)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, SEARCH_CACHE_MAX);
    window.localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A cache that cannot be written is simply not a cache.
  }
}

export async function searchLocations(
  query: string,
  options: { signal?: AbortSignal; proximity?: [number, number] } = {},
): Promise<LocationResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const connection = sheetPlaceRepository.getConnection();
  const viaGoogle = Boolean(connection && sheetPlaceRepository.getCapabilities().placesSearch);

  // Only the good geocoder's answers are worth remembering: the fallback's
  // are what you get *because* nothing better was available, and must not
  // outlive the moment the better one comes online.
  const key = viaGoogle ? searchCacheKey(trimmed, options.proximity, language()) : null;
  if (key) {
    const hit = readSearchCache()[key];
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.results;
  }

  if (connection && viaGoogle) {
    try {
      const results = await searchWithGoogle(connection, trimmed, {
        signal: options.signal,
        proximity: options.proximity,
        language: language(),
      });
      if (key) {
        const cache = readSearchCache();
        cache[key] = { at: Date.now(), results };
        writeSearchCache(cache);
      }
      // An empty answer is an answer: Google found nothing, and asking a
      // second geocoder the same question would only muddy that.
      return results;
    } catch (error) {
      // A cancelled keystroke is not a failure, and must not fall through to a
      // second request that nobody is waiting for either.
      if ((error as Error)?.name === "AbortError") throw error;

      console.warn(
        "Google Places search failed; falling back to the keyless geocoder.",
        error,
      );
    }
  }

  return searchWithOpenStreetMap(trimmed, options);
}

/**
 * The results that would be additions rather than repetitions: anything whose
 * listing is already saved in the journal is dropped, because the saved place
 * itself is listed right above.
 */
export function newToJournal(
  results: LocationResult[],
  places: Pick<VisitedPlace, "googlePlaceId">[],
): LocationResult[] {
  const known = new Set(
    places.map((place) => place.googlePlaceId).filter((id): id is string => Boolean(id)),
  );
  return results.filter((result) => !result.googlePlaceId || !known.has(result.googlePlaceId));
}
