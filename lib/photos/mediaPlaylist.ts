import { isVideoTravelPhoto, sortTravelPhotos } from "@/lib/photos/travelPhotos";
import { placesInTrip } from "@/lib/trips/tripDays";
import type { PlaceVisit, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";
import type { TravelPhoto } from "@/types/travelPhoto";

/**
 * The playlists behind "Play Memories", kept pure so every rule here is
 * testable without a browser.
 *
 * The player works at exactly two levels — a place, or a trip — and neither
 * one copies anything. A playlist is a selection over the same Travel_Photos
 * records every gallery reads: a photo attached to Kyoto stays attached to
 * Kyoto, and the Japan trip's playlist includes it because Kyoto is one of
 * that trip's places. Nothing here ever writes; playback is a way of looking
 * at the records, and Google Photos originals are not so much read-only to
 * this module as invisible — the ids below are the app's own rows, resolved
 * to the app's own stored copies in Drive.
 */

/**
 * How the player treats one item.
 *
 * - `photo` shows for the photo duration, then advances.
 * - `video` plays its stored clip and advances on the clip's `ended` event.
 * - `poster` is a video whose full clip was too large for the script to
 *   store: its preview frame shows like a photo, honestly labelled, so the
 *   playlist flows on instead of freezing at a clip that cannot exist.
 */
export type PlaybackKind = "photo" | "video" | "poster";

export function playbackKind(
  photo: Pick<TravelPhoto, "mimeType" | "videoDriveFileId">,
): PlaybackKind {
  if (!isVideoTravelPhoto(photo)) return "photo";
  return photo.videoDriveFileId ? "video" : "poster";
}

/**
 * Default playback order: capture time, with the stable media id as the
 * tie-breaker so the same playlist comes out in the same order on every
 * device. Items with no capture time cannot join the chronology, so they
 * follow it in the saved gallery order (import order, then id).
 *
 * A `sortOrder` anywhere in the set means a custom order has been saved, and
 * a saved order outranks the default — that column is the seam a manual
 * "arrange my playlist" feature slots into later without touching this
 * module's callers. `sortTravelPhotos` already ranks by it.
 */
export function playbackOrder(photos: TravelPhoto[]): TravelPhoto[] {
  const live = photos.filter((photo) => !photo.deletedAt);
  if (live.some((photo) => typeof photo.sortOrder === "number")) {
    return sortTravelPhotos(live);
  }
  return [...live].sort((a, b) => {
    const aTaken = a.takenAt ?? "";
    const bTaken = b.takenAt ?? "";
    if (aTaken && bTaken) {
      if (aTaken !== bTaken) return aTaken.localeCompare(bTaken);
      return a.id.localeCompare(b.id);
    }
    if (aTaken) return -1;
    if (bTaken) return 1;
    const created = a.createdAt.localeCompare(b.createdAt);
    if (created !== 0) return created;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Everything attached to one place, across all of its visits and residence
 * periods, in playback order. Visit-level photos carry their place's id, so
 * one filter is the whole rule — and media on another place, another visit's
 * place or nothing at all never leaks in.
 */
export function playlistForPlace(photos: TravelPhoto[], placeId: string): TravelPhoto[] {
  return playbackOrder(
    photos.filter((photo) => !photo.deletedAt && photo.placeId === placeId),
  );
}

/**
 * One trip's combined playlist: media attached to the trip itself, plus the
 * media of every place that belongs to the trip — membership decided by
 * `placesInTrip`, the same rule the trip screen itself uses. The two routes
 * can reach the same record (a visit photo carries both its trip and its
 * place), so items are deduplicated by the app's own media id: each record
 * plays once, however many ways it is reachable.
 */
export function playlistForTrip(
  photos: TravelPhoto[],
  trip: Trip,
  places: VisitedPlace[],
  visits: PlaceVisit[],
): TravelPhoto[] {
  const memberPlaceIds = new Set(placesInTrip(trip, places, visits).map((place) => place.id));

  const seen = new Set<string>();
  const combined: TravelPhoto[] = [];
  for (const photo of photos) {
    if (photo.deletedAt) continue;
    const direct = photo.tripId === trip.id;
    const viaPlace = Boolean(photo.placeId && memberPlaceIds.has(photo.placeId));
    if (!direct && !viaPlace) continue;
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    combined.push(photo);
  }
  return playbackOrder(combined);
}

export type MediaCounts = { photos: number; videos: number };

/** How many of each kind a playlist holds — the "65 photos · 7 videos" line. */
export function mediaCounts(photos: TravelPhoto[]): MediaCounts {
  let stills = 0;
  let videos = 0;
  for (const photo of photos) {
    if (photo.deletedAt) continue;
    if (isVideoTravelPhoto(photo)) videos += 1;
    else stills += 1;
  }
  return { photos: stills, videos };
}

/** "12 photos · 3 videos", "1 photo", "2 videos" — empty when there is nothing. */
export function formatMediaCounts(counts: MediaCounts): string {
  const parts: string[] = [];
  if (counts.photos > 0) parts.push(counts.photos === 1 ? "1 photo" : `${counts.photos} photos`);
  if (counts.videos > 0) parts.push(counts.videos === 1 ? "1 video" : `${counts.videos} videos`);
  return parts.join(" · ");
}
