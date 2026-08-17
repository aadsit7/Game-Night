import { MAPBOX_TOKEN, hasMapboxToken } from "@/lib/maps/mapbox";
import type { LocationResult } from "@/types/place";

/**
 * Real-world location lookup.
 *
 * Primary: the Mapbox Search Box API, because it returns points of interest —
 * "Sagrada Família", "Blue Bottle", "Table Mountain" — alongside cities and
 * countries. The Geocoding v6 API is kept as a fallback: it has no POI
 * coverage, but it keeps city/country search working if Search Box is
 * unavailable on an account or blocked by a network.
 */

export class GeocodingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GeocodingError";
  }
}

export const GEOCODING_UNAVAILABLE =
  "Location search needs a Mapbox access token. You can still add a place by name.";

const SEARCH_BOX = "https://api.mapbox.com/search/searchbox/v1";
const GEOCODE_V6 = "https://api.mapbox.com/search/geocode/v6";

const SEARCH_TYPES = [
  "country",
  "region",
  "district",
  "place",
  "locality",
  "neighborhood",
  "street",
  "address",
  "poi",
].join(",");

/** Both APIs return the same context shape, so one parser serves both. */
type ContextEntry = { name?: string; country_code?: string; region_code?: string };

type FeatureProperties = {
  mapbox_id?: string;
  name?: string;
  name_preferred?: string;
  place_formatted?: string;
  full_address?: string;
  feature_type?: string;
  poi_category?: string[];
  coordinates?: { longitude?: number; latitude?: number };
  context?: {
    country?: ContextEntry;
    region?: ContextEntry;
    postcode?: ContextEntry;
    district?: ContextEntry;
    place?: ContextEntry;
    locality?: ContextEntry;
    neighborhood?: ContextEntry;
    street?: ContextEntry;
  };
};

type Feature = {
  id?: string;
  properties?: FeatureProperties;
  geometry?: { coordinates?: [number, number] };
};

function toResult(feature: Feature, index: number): LocationResult | null {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;
  const longitude = props.coordinates?.longitude ?? (coords ? coords[0] : undefined);
  const latitude = props.coordinates?.latitude ?? (coords ? coords[1] : undefined);

  if (
    typeof longitude !== "number" ||
    typeof latitude !== "number" ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    return null;
  }

  const name = props.name_preferred || props.name;
  if (!name) return null;

  const context = props.context ?? {};
  const type = props.feature_type;

  const country = context.country?.name ?? (type === "country" ? name : undefined);
  const region = context.region?.name ?? (type === "region" ? name : undefined);
  const city =
    context.place?.name ??
    context.locality?.name ??
    (type === "place" || type === "locality" ? name : undefined);

  // Prefer the geocoder's own subtitle; fall back to assembling one.
  const subtitle =
    props.place_formatted ??
    [city, region, country].filter((part) => part && part !== name).join(", ");

  return {
    id: props.mapbox_id ?? feature.id ?? `result-${index}`,
    name,
    context: subtitle,
    city,
    region,
    country,
    countryCode: context.country?.country_code?.toUpperCase(),
    latitude,
    longitude,
    kind: type,
  };
}

function parseCollection(payload: unknown): LocationResult[] {
  const features = (payload as { features?: Feature[] })?.features;
  if (!Array.isArray(features)) return [];
  return features
    .map(toResult)
    .filter((result): result is LocationResult => result !== null);
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new GeocodingError(`Search failed with status ${response.status}`);
  }
  return response.json();
}

/** Best-effort browser language, so results come back localised. */
function language(): string {
  if (typeof navigator === "undefined") return "en";
  return navigator.language?.split("-")[0] || "en";
}

/**
 * Forward search. `proximity` biases results toward the current camera, which
 * matters a lot for ambiguous names like "Springfield" or "Santa Cruz".
 */
export async function searchLocations(
  query: string,
  options: { signal?: AbortSignal; proximity?: [number, number] } = {},
): Promise<LocationResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  if (!hasMapboxToken) throw new GeocodingError(GEOCODING_UNAVAILABLE);

  const params = new URLSearchParams({
    q: trimmed,
    access_token: MAPBOX_TOKEN,
    limit: "8",
    language: language(),
    types: SEARCH_TYPES,
  });
  if (options.proximity) {
    params.set("proximity", `${options.proximity[0]},${options.proximity[1]}`);
  }

  try {
    const payload = await fetchJson(`${SEARCH_BOX}/forward?${params}`, options.signal);
    const results = parseCollection(payload);
    if (results.length > 0) return results;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    // Fall through to the geocoder below.
  }

  const fallbackParams = new URLSearchParams({
    q: trimmed,
    access_token: MAPBOX_TOKEN,
    limit: "8",
    language: language(),
  });
  if (options.proximity) {
    fallbackParams.set("proximity", `${options.proximity[0]},${options.proximity[1]}`);
  }

  try {
    const payload = await fetchJson(`${GEOCODE_V6}/forward?${fallbackParams}`, options.signal);
    return parseCollection(payload);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new GeocodingError("Location search isn’t responding right now.", error);
  }
}

/**
 * Reverse lookup for a point dropped on the globe. Returns `null` rather than
 * throwing when the point is in open ocean or the service is unreachable — the
 * user can always name the place themselves.
 */
export async function reverseGeocode(
  longitude: number,
  latitude: number,
  options: { signal?: AbortSignal } = {},
): Promise<LocationResult | null> {
  if (!hasMapboxToken) return null;

  const base = {
    longitude: longitude.toFixed(6),
    latitude: latitude.toFixed(6),
    access_token: MAPBOX_TOKEN,
    language: language(),
  };

  try {
    const params = new URLSearchParams({ ...base, limit: "1" });
    const payload = await fetchJson(`${SEARCH_BOX}/reverse?${params}`, options.signal);
    const [first] = parseCollection(payload);
    if (first) return first;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
  }

  try {
    const params = new URLSearchParams({
      ...base,
      types: "place,locality,region,country",
    });
    const payload = await fetchJson(`${GEOCODE_V6}/reverse?${params}`, options.signal);
    const [first] = parseCollection(payload);
    return first ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return null;
  }
}
