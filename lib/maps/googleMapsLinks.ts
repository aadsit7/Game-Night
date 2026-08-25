import type { VisitedPlace } from "@/types/place";

/**
 * Official Google Maps URLs for a saved place.
 *
 * These are the documented cross-platform links (`google.com/maps/…?api=1`):
 * on a phone they open the Google Maps app when it is installed, in a browser
 * they open the site, and they need no API key — which matters here, because
 * this is a public static bundle and a key compiled into it would be public
 * too. The key stays where it already lives, in the Apps Script, powering the
 * search that captures each place's listing id in the first place.
 *
 * When a place carries a `googlePlaceId`, the link opens the actual listing —
 * hours, photos, reviews. The coordinates always ride along as the query, so
 * a stale or missing id degrades to a pin on the right spot rather than an
 * error page.
 */

/** Six decimals, matching the sheet's own derived Map URL column. */
function point(place: Pick<VisitedPlace, "latitude" | "longitude">): string {
  return `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
}

type Linkable = Pick<VisitedPlace, "latitude" | "longitude" | "googlePlaceId">;

/** The place itself on Google Maps — the listing when known, the spot always. */
export function googleMapsUrl(place: Linkable): string {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point(place))}`;
  const id = place.googlePlaceId?.trim();
  return id ? `${url}&query_place_id=${encodeURIComponent(id)}` : url;
}

/** Directions there from wherever the person is standing. */
export function googleMapsDirectionsUrl(place: Linkable): string {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point(place))}`;
  const id = place.googlePlaceId?.trim();
  return id ? `${url}&destination_place_id=${encodeURIComponent(id)}` : url;
}

/**
 * The spot at eye level. `map_action=pano` opens Street View aimed at the
 * coordinates; where no panorama exists nearby, Google shows its own gentle
 * empty state, so the link is safe to offer for every place.
 */
export function googleStreetViewUrl(place: Pick<VisitedPlace, "latitude" | "longitude">): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(point(place))}`;
}

/** The most stops Google's directions URL accepts between the two ends. */
const MAX_WAYPOINTS = 9;

/**
 * The whole trip as one route: first stop to last, everywhere else between.
 *
 * Google's URL takes at most nine waypoints, so a longer trip is thinned
 * evenly — the ends of the middle leg survive and the rest keep their
 * spacing, which preserves the shape of the journey rather than its first
 * nine mornings. Listing ids ride along only when every waypoint has one,
 * because the parameter matches waypoints by position and a gap would pin
 * someone else's id to the wrong stop.
 */
export function googleMapsTripRouteUrl(stops: Linkable[]): string | null {
  if (stops.length < 2) return null;

  const origin = stops[0];
  const destination = stops[stops.length - 1];
  let middles = stops.slice(1, -1);
  if (middles.length > MAX_WAYPOINTS) {
    const last = middles.length - 1;
    middles = Array.from(
      { length: MAX_WAYPOINTS },
      (_, index) => middles[Math.round((index * last) / (MAX_WAYPOINTS - 1))],
    );
  }

  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(point(origin))}&destination=${encodeURIComponent(point(destination))}`;
  const originId = origin.googlePlaceId?.trim();
  if (originId) url += `&origin_place_id=${encodeURIComponent(originId)}`;
  const destinationId = destination.googlePlaceId?.trim();
  if (destinationId) url += `&destination_place_id=${encodeURIComponent(destinationId)}`;

  if (middles.length > 0) {
    url += `&waypoints=${encodeURIComponent(middles.map(point).join("|"))}`;
    const ids = middles.map((stop) => stop.googlePlaceId?.trim() ?? "");
    if (ids.every(Boolean)) {
      url += `&waypoint_place_ids=${encodeURIComponent(ids.join("|"))}`;
    }
  }

  return url;
}
