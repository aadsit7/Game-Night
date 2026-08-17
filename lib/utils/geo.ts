import type { VisitedPlace } from "@/types/place";

export type LngLat = { longitude: number; latitude: number };

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function hasValidCoordinates(place: {
  latitude?: unknown;
  longitude?: unknown;
}): boolean {
  return isValidLatitude(place.latitude) && isValidLongitude(place.longitude);
}

/** Wrap a longitude into [-180, 180] so panning past the seam stays valid. */
export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return 0;
  let value = ((longitude + 180) % 360 + 360) % 360 - 180;
  // `-180` and `180` are the same meridian; prefer the positive form.
  if (value === -180) value = 180;
  return value;
}

export function clampLatitude(latitude: number): number {
  if (!Number.isFinite(latitude)) return 0;
  return Math.min(90, Math.max(-90, latitude));
}

/** Human-readable coordinates, only ever shown as supporting detail. */
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lng}`;
}

/** Regional-indicator flag from an ISO 3166-1 alpha-2 code. */
export function countryFlag(countryCode?: string): string | null {
  if (!countryCode || countryCode.length !== 2 || !/^[a-z]{2}$/i.test(countryCode)) {
    return null;
  }
  const base = 0x1f1e6;
  const upper = countryCode.toUpperCase();
  return String.fromCodePoint(
    base + (upper.charCodeAt(0) - 65),
    base + (upper.charCodeAt(1) - 65),
  );
}

/** The one-line subtitle used everywhere a place is listed. */
export function placeSubtitle(place: VisitedPlace): string {
  const parts = [place.city, place.country].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  // Avoid "Tokyo · Tokyo" when the place *is* the city.
  const unique = parts.filter(
    (part, index) => parts.indexOf(part) === index && part !== place.name,
  );
  return unique.join(", ");
}

type Bounds = [[number, number], [number, number]];

/**
 * Frame the traveller's world. Longitudes are clustered around the shortest
 * arc that contains every place, so a Tokyo + San Francisco pair frames across
 * the Pacific rather than zooming out to the whole planet.
 */
export function boundsForPlaces(places: VisitedPlace[]): Bounds | null {
  const points = places.filter(hasValidCoordinates);
  if (points.length === 0) return null;

  const lats = points.map((p) => p.latitude);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  const longitudes = points.map((p) => normalizeLongitude(p.longitude)).sort((a, b) => a - b);

  // Find the widest gap between consecutive longitudes (wrapping around the
  // antimeridian); the complement of that gap is the tightest containing arc.
  let gapStart = longitudes[longitudes.length - 1];
  let gapEnd = longitudes[0] + 360;
  let widest = gapEnd - gapStart;

  for (let i = 0; i < longitudes.length - 1; i += 1) {
    const gap = longitudes[i + 1] - longitudes[i];
    if (gap > widest) {
      widest = gap;
      gapStart = longitudes[i];
      gapEnd = longitudes[i + 1];
    }
  }

  let west = gapEnd;
  let east = gapStart + 360;

  // Shift the arc back into a sane range; it may still cross the antimeridian
  // (east > 180), which is exactly what `fitBounds` expects in that case.
  while (west > 180) {
    west -= 360;
    east -= 360;
  }

  return [
    [west, south],
    [east, north],
  ];
}
