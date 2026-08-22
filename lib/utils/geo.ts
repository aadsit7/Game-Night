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

/* -------------------------------------------------------------------------- */
/* Framing a sphere                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The mean direction of a set of points on a sphere.
 *
 * Averaging longitudes as numbers is wrong the moment a collection crosses the
 * antimeridian — Tokyo and San Francisco average to the middle of Kansas — so
 * each place becomes a unit vector, the vectors are summed, and the sum is
 * turned back into an angle. Places spread evenly over the whole planet sum to
 * nearly nothing, and that is the one case where any centre is as good as
 * another, so the first place is used.
 */
export function sphericalCentre(places: LngLat[]): LngLat | null {
  if (places.length === 0) return null;

  let x = 0;
  let y = 0;
  let z = 0;
  for (const place of places) {
    const lat = (clampLatitude(place.latitude) * Math.PI) / 180;
    const lng = (normalizeLongitude(place.longitude) * Math.PI) / 180;
    const cos = Math.cos(lat);
    x += cos * Math.cos(lng);
    y += cos * Math.sin(lng);
    z += Math.sin(lat);
  }

  const flat = Math.hypot(x, y);
  if (flat < 1e-9 && Math.abs(z) < 1e-9) {
    return { longitude: places[0].longitude, latitude: places[0].latitude };
  }

  return {
    longitude: (Math.atan2(y, x) * 180) / Math.PI,
    latitude: (Math.atan2(z, flat) * 180) / Math.PI,
  };
}

/** Great-circle angle between two points, in degrees. */
export function angularDistance(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const lat1 = clampLatitude(a.latitude) * toRad;
  const lat2 = clampLatitude(b.latitude) * toRad;
  const dLat = lat2 - lat1;
  const dLng = (normalizeLongitude(b.longitude) - normalizeLongitude(a.longitude)) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h))) * 180) / Math.PI;
}

/**
 * The point a given angular distance from `centre`, along a given bearing.
 *
 * Used to draw the horizon as a ring of points, which turns "how far back do I
 * stand to see the whole planet" into the same question as "how far back do I
 * stand to see these places" — one mechanism, one answer, no special case.
 */
export function pointAtBearing(
  centre: LngLat,
  bearingDegrees: number,
  distanceDegrees: number,
): LngLat {
  const toRad = Math.PI / 180;
  const lat0 = clampLatitude(centre.latitude) * toRad;
  const lon0 = normalizeLongitude(centre.longitude) * toRad;
  const bearing = bearingDegrees * toRad;
  const distance = distanceDegrees * toRad;

  const sinLat = Math.sin(lat0) * Math.cos(distance) +
    Math.cos(lat0) * Math.sin(distance) * Math.cos(bearing);
  const latitude = Math.asin(Math.min(1, Math.max(-1, sinLat)));
  const longitude = lon0 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(lat0),
      Math.cos(distance) - Math.sin(lat0) * sinLat,
    );

  return {
    latitude: latitude / toRad,
    longitude: normalizeLongitude(longitude / toRad),
  };
}

/** The horizon around a point, as places a camera can be asked to frame. */
export function horizonRing(centre: LngLat, radiusDegrees: number, count = 16): LngLat[] {
  return Array.from({ length: count }, (_, index) =>
    pointAtBearing(centre, (index * 360) / count, radiusDegrees),
  );
}

/**
 * The largest value in `[low, high]` for which `fits` is true.
 *
 * Zoom is the one part of framing a globe that cannot be derived on paper.
 * MapLibre's globe is not an orthographic projection of a Mercator plane —
 * measured against the renderer, the sphere's radius runs about 8% under
 * `512·2^zoom/2π` at zoom 1 and half of it by zoom 4, because the camera sits
 * at a finite distance and the projection eases towards Mercator as you
 * descend. Any closed form for "how far out do I have to be" is therefore an
 * approximation of someone else's implementation detail, and the one thing it
 * cannot survive is that implementation changing.
 *
 * So the renderer is asked instead: `fits` projects every place at a candidate
 * zoom and reports whether they all landed on screen, and this narrows the
 * range around the answer. Monotonic by construction — pulling further back
 * never hides a place that was already visible — which is what makes bisection
 * valid here.
 */
export function largestZoomThatFits(
  fits: (zoom: number) => boolean,
  low: number,
  high: number,
  steps = 14,
): number {
  // Nothing fits even from as far back as the camera goes: take the widest
  // view there is and accept that something is over the horizon.
  if (!fits(low)) return low;
  if (fits(high)) return high;

  let lo = low;
  let hi = high;
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
