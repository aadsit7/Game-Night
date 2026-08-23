import {
  mediaCounts,
  playlistForPlace,
  playlistForTrip,
  type MediaCounts,
} from "@/lib/photos/mediaPlaylist";
import type { PlaceVisit, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";
import type { TravelPhoto } from "@/types/travelPhoto";

/**
 * What the Player tab lists: every trip and every place with anything to
 * play, each carrying the same playlist the player itself would run.
 *
 * Nothing is stored and nothing is copied — an entry is a view over the same
 * Travel_Photos records the galleries and the player read, assembled through
 * the same `mediaPlaylist` selectors. A place or trip with no live media has
 * no entry: the tab answers "what can I watch?", and an empty playlist is
 * not an answer.
 */

export type TripPlayerEntry = {
  kind: "trip";
  trip: Trip;
  playlist: TravelPhoto[];
  counts: MediaCounts;
};

export type PlacePlayerEntry = {
  kind: "place";
  place: VisitedPlace;
  playlist: TravelPhoto[];
  counts: MediaCounts;
};

export type PlayerLibrary = {
  trips: TripPlayerEntry[];
  places: PlacePlayerEntry[];
};

/**
 * The playlist's most recent moment: capture time where the camera said,
 * import time where it didn't. What "newest first" means for a whole entry.
 */
export function latestMediaMoment(playlist: TravelPhoto[]): string {
  let latest = "";
  for (const photo of playlist) {
    if (photo.deletedAt) continue;
    const moment = photo.takenAt ?? photo.createdAt;
    if (moment > latest) latest = moment;
  }
  return latest;
}

/**
 * Both sections, newest memories first, ties broken by name so the same
 * library renders in the same order on every device. Tombstoned trips and
 * places are skipped here even though the stores already filter them —
 * this module is pure and has to hold its own promise.
 */
export function buildPlayerLibrary(
  photos: TravelPhoto[],
  trips: Trip[],
  places: VisitedPlace[],
  visits: PlaceVisit[],
): PlayerLibrary {
  const tripEntries: TripPlayerEntry[] = [];
  for (const trip of trips) {
    if (trip.deletedAt) continue;
    const playlist = playlistForTrip(photos, trip, places, visits);
    if (playlist.length === 0) continue;
    tripEntries.push({ kind: "trip", trip, playlist, counts: mediaCounts(playlist) });
  }

  const placeEntries: PlacePlayerEntry[] = [];
  for (const place of places) {
    if (place.deletedAt) continue;
    const playlist = playlistForPlace(photos, place.id);
    if (playlist.length === 0) continue;
    placeEntries.push({ kind: "place", place, playlist, counts: mediaCounts(playlist) });
  }

  tripEntries.sort(
    (a, b) =>
      latestMediaMoment(b.playlist).localeCompare(latestMediaMoment(a.playlist)) ||
      a.trip.name.localeCompare(b.trip.name),
  );
  placeEntries.sort(
    (a, b) =>
      latestMediaMoment(b.playlist).localeCompare(latestMediaMoment(a.playlist)) ||
      a.place.name.localeCompare(b.place.name),
  );

  return { trips: tripEntries, places: placeEntries };
}

/** "1 trip · 3 places" — the header's count of what there is to watch. */
export function formatLibrarySummary(library: PlayerLibrary): string {
  const parts: string[] = [];
  if (library.trips.length > 0) {
    parts.push(library.trips.length === 1 ? "1 trip" : `${library.trips.length} trips`);
  }
  if (library.places.length > 0) {
    parts.push(library.places.length === 1 ? "1 place" : `${library.places.length} places`);
  }
  return parts.join(" · ");
}
