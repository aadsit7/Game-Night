import { searchWithGoogle } from "@/lib/maps/googlePlaces";
import { searchWithOpenStreetMap } from "@/lib/maps/geocoding";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import type { LocationResult } from "@/types/place";

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

export async function searchLocations(
  query: string,
  options: { signal?: AbortSignal; proximity?: [number, number] } = {},
): Promise<LocationResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const connection = sheetPlaceRepository.getConnection();

  if (connection && sheetPlaceRepository.getCapabilities().placesSearch) {
    try {
      const results = await searchWithGoogle(connection, trimmed, {
        signal: options.signal,
        proximity: options.proximity,
        language: language(),
      });
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
