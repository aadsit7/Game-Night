import type { PlaceVisit } from "@/types/place";
import type { GooglePickedMedia, PhotoContext, TravelPhoto } from "@/types/travelPhoto";

/**
 * The date reasoning and bookkeeping behind the cloud gallery, kept pure so
 * every rule here can be tested without a browser, a sheet, or Google.
 */

/**
 * The calendar date a photo was taken on, straight off the timestamp's own
 * digits. Deliberately not parsed through `Date`: Google reports capture time
 * in UTC, the camera's local day is unknowable from here, and shifting the
 * digits through this device's timezone would move a border-line photo across
 * midnight differently on every device that looks at it. The dates are
 * guidance, never a rejection rule, so stable beats clever.
 */
export function takenOnDate(takenAt: string | undefined): string | null {
  if (!takenAt) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(takenAt.trim());
  return match ? match[1] : null;
}

/**
 * Whether a capture date sits inside a visit's range, both ends inclusive —
 * a photo taken on the last evening of the trip is a photo from the trip.
 * A photo with no readable date, or a context with no dates, is never
 * "outside": there is nothing to be outside of.
 */
export function isWithinDates(
  takenAt: string | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
): boolean {
  const taken = takenOnDate(takenAt);
  if (!taken) return true;
  if (startDate && taken < startDate) return false;
  const end = endDate ?? startDate;
  if (end && taken > end) return false;
  return true;
}

export type ReviewedMedia = {
  media: GooglePickedMedia;
  /** Inside the context's dates (or the context has none). */
  withinDates: boolean;
  /** A video: importable like a photo, stored with poster frames + clip. */
  isVideo: boolean;
  /** Already imported — into this same context, or elsewhere in the library. */
  duplicate: "none" | "sameContext" | "elsewhere";
};

/** Whether a stored travel photo is a video, by its own metadata. */
export function isVideoTravelPhoto(
  photo: Pick<TravelPhoto, "mimeType" | "videoDriveFileId">,
): boolean {
  return Boolean(photo.videoDriveFileId) || (photo.mimeType ?? "").startsWith("video/");
}

/**
 * The review screen's model: every selected item, labelled with what the
 * import will do with it. Nothing is discarded here — an outside-date photo
 * is flagged and stays selected, because airport photos, travel-day photos
 * and wrong camera clocks are all real life.
 */
export function reviewSelection(
  selection: GooglePickedMedia[],
  context: Pick<PhotoContext, "startDate" | "endDate" | "visitId" | "tripId" | "placeId">,
  existing: TravelPhoto[],
): ReviewedMedia[] {
  const live = existing.filter((photo) => !photo.deletedAt && photo.googlePhotosItemId);
  const byItemId = new Map<string, TravelPhoto[]>();
  for (const photo of live) {
    const list = byItemId.get(photo.googlePhotosItemId as string) ?? [];
    list.push(photo);
    byItemId.set(photo.googlePhotosItemId as string, list);
  }

  return selection.map((media) => {
    const twins = byItemId.get(media.id) ?? [];
    const sameContext = twins.some((photo) => isSameContext(photo, context));
    return {
      media,
      withinDates: isWithinDates(media.createTime, context.startDate, context.endDate),
      isVideo: (media.type ?? "").toUpperCase() === "VIDEO",
      duplicate: sameContext ? "sameContext" : twins.length > 0 ? "elsewhere" : "none",
    };
  });
}

/** Whether an existing photo already lives where this import is pointed. */
function isSameContext(
  photo: TravelPhoto,
  context: Pick<PhotoContext, "visitId" | "tripId" | "placeId">,
): boolean {
  if (context.visitId) return photo.visitId === context.visitId;
  if (context.tripId) return photo.tripId === context.tripId && !photo.visitId;
  if (context.placeId) return photo.placeId === context.placeId && !photo.visitId && !photo.tripId;
  return false;
}

/** "21 within Feb 7–10 · 3 outside" — the counts the review leads with.
 * Videos count toward within/outside like any capture; `videos` is the
 * informational tally alongside. */
export function reviewCounts(reviewed: ReviewedMedia[]): {
  within: number;
  outside: number;
  videos: number;
  duplicates: number;
} {
  let within = 0;
  let outside = 0;
  let videos = 0;
  let duplicates = 0;
  for (const item of reviewed) {
    if (item.isVideo) videos += 1;
    if (item.duplicate === "sameContext") duplicates += 1;
    else if (item.withinDates) within += 1;
    else outside += 1;
  }
  return { within, outside, videos, duplicates };
}

/* ------------------------------------------------------------------ *
 * Association rules
 * ------------------------------------------------------------------ */

export type AssociationProblem =
  | "missingVisit"
  | "deletedVisit"
  | "placeMismatch"
  | "tripMismatch"
  | "noAssociation";

/**
 * Whether a photo's claimed associations describe records that actually
 * exist and agree with each other. The Apps Script enforces the same rules
 * server-side — this mirror is what makes them testable, and what lets the
 * app refuse an impossible import before any bytes move.
 */
export function validateAssociation(
  association: { placeId?: string; visitId?: string; tripId?: string },
  visits: PlaceVisit[],
): AssociationProblem | null {
  const { placeId, visitId, tripId } = association;
  if (!placeId && !visitId && !tripId) return "noAssociation";

  if (visitId) {
    const visit = visits.find((candidate) => candidate.id === visitId);
    if (!visit) return "missingVisit";
    if (visit.deletedAt) return "deletedVisit";
    if (placeId && visit.placeId !== placeId) return "placeMismatch";
    if (tripId && visit.tripId && visit.tripId !== tripId) return "tripMismatch";
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Reading the gallery
 * ------------------------------------------------------------------ */

/** Oldest first — a gallery reads left to right the way the trip happened. */
export function sortTravelPhotos(photos: TravelPhoto[]): TravelPhoto[] {
  return [...photos].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aTaken = a.takenAt ?? "";
    const bTaken = b.takenAt ?? "";
    if (aTaken !== bTaken) return aTaken.localeCompare(bTaken);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function photosForVisit(photos: TravelPhoto[], visitId: string): TravelPhoto[] {
  return sortTravelPhotos(photos.filter((photo) => !photo.deletedAt && photo.visitId === visitId));
}

/** Journey-level photos only: attached to the trip and to no particular visit. */
export function photosForTripOnly(photos: TravelPhoto[], tripId: string): TravelPhoto[] {
  return sortTravelPhotos(
    photos.filter((photo) => !photo.deletedAt && photo.tripId === tripId && !photo.visitId),
  );
}

/** Everything under a trip: its own photos and every member visit's. */
export function photosForTrip(photos: TravelPhoto[], tripId: string): TravelPhoto[] {
  return sortTravelPhotos(photos.filter((photo) => !photo.deletedAt && photo.tripId === tripId));
}

/** Every photo at a place, across all of its visits and residence periods. */
export function photosForPlace(photos: TravelPhoto[], placeId: string): TravelPhoto[] {
  return sortTravelPhotos(photos.filter((photo) => !photo.deletedAt && photo.placeId === placeId));
}

/**
 * When photos land at trip level, each one can often name its own visit: a
 * capture date inside exactly one member visit's range is that visit. Two
 * overlapping candidates, or none, answer null — the photo stays at trip
 * level rather than being guessed onto a place.
 */
export function suggestVisitForPhoto(
  media: Pick<GooglePickedMedia, "createTime">,
  tripVisits: PlaceVisit[],
): PlaceVisit | null {
  const taken = takenOnDate(media.createTime);
  if (!taken) return null;

  const matches = tripVisits.filter((visit) => {
    if (visit.deletedAt || !visit.startDate) return false;
    const end = visit.endDate ?? visit.startDate;
    return taken >= visit.startDate && taken <= end;
  });
  return matches.length === 1 ? matches[0] : null;
}

