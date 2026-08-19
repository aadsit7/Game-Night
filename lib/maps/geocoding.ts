import type { LocationResult } from "@/types/place";

/**
 * Real-world location lookup, without an API key.
 *
 * Photon is Komoot's open geocoder over OpenStreetMap data. It needs no
 * account and no token, which keeps the promise that opening the URL is all
 * the setup there is. It searches cities, countries, neighbourhoods, addresses
 * and points of interest, so "Sagrada Família" and "Florence" both resolve.
 *
 * OpenStreetMap ranking is blunter than a commercial geocoder's, so results
 * are biased toward the current view and re-ordered to favour the kinds of
 * place a travel journal is actually about.
 */

const PHOTON = "https://photon.komoot.io";

export class GeocodingError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GeocodingError";
    this.cause = cause;
  }
}

export const GEOCODING_UNAVAILABLE =
  "Location search isn’t responding. You can still add a place by name.";

/** Photon returns OSM tags; these map onto the icon and ranking we want. */
type PhotonProperties = {
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  postcode?: string;
};

type PhotonFeature = {
  properties?: PhotonProperties;
  geometry?: { coordinates?: [number, number] };
};

/** Broad category, used only to pick an icon and to rank results. */
function kindOf(props: PhotonProperties): string {
  const type = props.type;
  if (type === "country") return "country";
  if (type === "state") return "region";
  if (type === "city" || type === "district" || type === "locality") return "place";
  if (type === "street" || type === "house") return "address";
  if (props.osm_key === "tourism" || props.osm_key === "historic") return "poi";
  if (props.osm_key === "amenity" || props.osm_key === "leisure") return "poi";
  return type ?? "place";
}

/**
 * A travel journal is mostly about cities, countries and landmarks, so those
 * come first; house numbers and postcodes are almost never what was meant.
 */
const RANK: Record<string, number> = {
  city: 0,
  place: 0,
  country: 1,
  region: 2,
  poi: 1,
  address: 4,
};

function toResult(feature: PhotonFeature, index: number): LocationResult | null {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;

  const [longitude, latitude] = coords;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const kind = kindOf(props);
  const street = props.street
    ? [props.housenumber, props.street].filter(Boolean).join(" ")
    : undefined;

  const name = props.name ?? street ?? props.city ?? props.country;
  if (!name) return null;

  const city = props.city ?? (kind === "place" ? props.name : undefined);
  const region = props.state;
  const country = props.country;

  // "Barcelona, Catalonia, Spain" — skipping anything that repeats the name.
  const context = [city, region, country]
    .filter((part, position, all): part is string =>
      Boolean(part) && part !== name && all.indexOf(part) === position,
    )
    .join(", ");

  return {
    id: `${props.osm_type ?? "x"}${props.osm_id ?? index}`,
    name,
    context,
    city,
    region,
    country,
    countryCode: props.countrycode?.toUpperCase(),
    latitude,
    longitude,
    kind,
  };
}

function parse(payload: unknown): LocationResult[] {
  const features = (payload as { features?: PhotonFeature[] })?.features;
  if (!Array.isArray(features)) return [];

  const results = features
    .map(toResult)
    .filter((result): result is LocationResult => result !== null);

  // Stable sort: keep the geocoder's own ordering within each rank band.
  return results
    .map((result, index) => ({ result, index }))
    .sort(
      (a, b) =>
        (RANK[a.result.kind ?? ""] ?? 3) - (RANK[b.result.kind ?? ""] ?? 3) ||
        a.index - b.index,
    )
    .map((entry) => entry.result);
}

function language(): string {
  if (typeof navigator === "undefined") return "en";
  const code = navigator.language?.split("-")[0] ?? "en";
  // Photon only carries a handful of localisations; anything else falls back.
  return ["en", "de", "fr", "it"].includes(code) ? code : "en";
}

const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Search must never spin forever. A request that hangs — a captive portal, a
 * network that vanished mid-flight — is abandoned on its own deadline, which
 * surfaces as "isn't responding" rather than an endless spinner. The caller's
 * signal still wins immediately, so a fresh keystroke supersedes the old query.
 */
async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);
  const relay = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", relay);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new GeocodingError(`Search failed with ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

export async function searchLocations(
  query: string,
  options: { signal?: AbortSignal; proximity?: [number, number] } = {},
): Promise<LocationResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({ q: trimmed, limit: "10", lang: language() });
  // Biasing toward the current view is what separates "Springfield" the one
  // you meant from the eleven you didn't.
  if (options.proximity) {
    params.set("lon", options.proximity[0].toFixed(4));
    params.set("lat", options.proximity[1].toFixed(4));
  }

  try {
    const payload = await fetchJson(`${PHOTON}/api/?${params}`, options.signal);
    return parse(payload).slice(0, 8);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new GeocodingError("Location search isn’t responding right now.", error);
  }
}

/**
 * Reverse lookup for a point dropped on the globe. Returns `null` rather than
 * throwing when the point is in open ocean or the service is unreachable — the
 * place can always be named by hand.
 */
export async function reverseGeocode(
  longitude: number,
  latitude: number,
  options: { signal?: AbortSignal } = {},
): Promise<LocationResult | null> {
  const params = new URLSearchParams({
    lon: longitude.toFixed(6),
    lat: latitude.toFixed(6),
    limit: "1",
    lang: language(),
  });

  try {
    const payload = await fetchJson(`${PHOTON}/reverse?${params}`, options.signal);
    return parse(payload)[0] ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return null;
  }
}
