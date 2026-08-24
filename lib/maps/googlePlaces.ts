import type { SheetConnection } from "@/lib/sheets/connection";
import { searchPlaces } from "@/lib/sheets/sheetsClient";
import type { LocationResult } from "@/types/place";

/**
 * Google Places search, reached through the Apps Script rather than directly.
 *
 * The site is a public static bundle: an API key compiled into it is delivered
 * to every visitor and readable from the page source, which is the same reason
 * the Google *Sheets* credentials never come near the browser either. The key
 * lives in a Script Property on the web app, the browser asks the script to do
 * the searching, and the key stays on Google's side of the wire.
 *
 * The whole thing is optional. With no key set the app uses its keyless
 * geocoder and nothing here is ever called.
 */

/** The Places types worth an icon; everything else falls back to a pin. */
const PLACE_KINDS: Array<[string, string]> = [
  ["country", "country"],
  ["administrative_area_level_1", "region"],
  ["locality", "place"],
  ["postal_town", "place"],
  ["sublocality", "place"],
  ["neighborhood", "place"],
  ["airport", "poi"],
  ["lodging", "poi"],
  ["restaurant", "poi"],
  ["cafe", "poi"],
  ["bar", "poi"],
  ["museum", "poi"],
  ["park", "poi"],
  ["natural_feature", "poi"],
  ["tourist_attraction", "poi"],
  ["point_of_interest", "poi"],
  ["street_address", "address"],
  ["route", "address"],
];

function kindOf(types: string[]): string {
  const set = new Set(types);
  for (const [type, kind] of PLACE_KINDS) {
    if (set.has(type)) return kind;
  }
  return "place";
}

export type GooglePlace = {
  id?: string;
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  types?: string[];
};

/**
 * One Places result as the app understands it.
 *
 * Returns `null` for anything the app could not draw — no name, or no
 * coordinates to put a pin on — rather than letting a half-formed row through.
 */
export function toLocationResult(place: GooglePlace, index: number): LocationResult | null {
  const name = place.name?.trim();
  const { latitude, longitude } = place;
  if (!name) return null;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const city = place.city?.trim() || undefined;
  const region = place.region?.trim() || undefined;
  const country = place.country?.trim() || undefined;

  // The short line under the name. Google's formatted address is the full
  // street line, which is the wrong length for a subtitle, so the same
  // city/region/country shape the rest of the app uses is built here instead.
  const context = [city, region, country]
    .filter((part, position, all): part is string =>
      Boolean(part) && part !== name && all.indexOf(part) === position,
    )
    .join(", ");

  const address = place.address?.trim();
  const googlePlaceId = place.id?.trim() || undefined;

  return {
    id: googlePlaceId || `google-${index}`,
    name,
    context,
    // Only worth showing when it says more than the subtitle already does.
    address: address && address !== context ? address : undefined,
    city,
    region,
    country,
    countryCode: place.countryCode?.trim().toUpperCase(),
    latitude,
    longitude,
    kind: kindOf(place.types ?? []),
    source: "google",
    // The listing id rides along so a place saved from this result can link
    // back to the real thing on Google Maps, not just to its coordinates.
    googlePlaceId,
  };
}

export async function searchWithGoogle(
  connection: SheetConnection,
  query: string,
  options: { signal?: AbortSignal; proximity?: [number, number]; language?: string } = {},
): Promise<LocationResult[]> {
  const places = await searchPlaces(
    connection,
    { query, proximity: options.proximity, language: options.language },
    options.signal,
  );

  return places
    .map((place, index) => toLocationResult(place, index))
    .filter((result): result is LocationResult => result !== null);
}
