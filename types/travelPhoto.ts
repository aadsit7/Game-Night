/**
 * A photo that lives in the cloud rather than in one browser.
 *
 * The bytes are two files in the sheet owner's private Google Drive — a
 * thumbnail and a display rendition — and this record is the row of the
 * Travel_Photos tab that points at them. The row is what syncs, so a photo
 * imported on a phone appears on a tablet the same way a place does: by
 * reading the sheet.
 *
 * What is deliberately NOT here: any Google Photos `baseUrl`. Those links are
 * temporary — they expire within the hour — and persisting one would build a
 * gallery of broken images. The durable Google Photos identity is the item id
 * alone, kept for deduplication.
 */
export type TravelPhoto = {
  /** The sheet's own id, e.g. `TPHOTO-0001`. */
  id: string;
  /** Google Photos' durable media item id. What "already imported" means. */
  googlePhotosItemId?: string;
  /** The place this photo was taken at, when it belongs to one. */
  placeId?: string;
  /** The visit — or residence period — this photo belongs to. */
  visitId?: string;
  /** The trip, for journey-level photos or visits inside a trip. */
  tripId?: string;
  /** When the camera says it was taken. ISO timestamp from Google Photos. */
  takenAt?: string;
  filename?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  /** Drive file id of the ~512px rendition. Never exposed to the browser as a URL. */
  thumbDriveFileId?: string;
  /** Drive file id of the ~2048px rendition. For a video, a poster frame. */
  displayDriveFileId?: string;
  /**
   * Drive file id of the video bytes, for selections that were videos. May
   * be absent even for a video: a clip too large for the script to move
   * keeps its poster frames and plays from Google Photos another day.
   */
  videoDriveFileId?: string;
  /** Where the photo came from. */
  source: TravelPhotoSource;
  /** Order within its gallery; lower first. */
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  /** Tombstone, same rule as every other record. */
  deletedAt?: string;
};

export type TravelPhotoSource = "google-photos" | "manual";

/** The renditions the script stores and serves. `video` is the clip itself. */
export type TravelPhotoSize = "thumb" | "display" | "video";

/**
 * One media item as the Google Photos Picker hands it back.
 *
 * `id` is durable and safe to store; `baseUrl` is temporary, only valid for
 * about an hour and only with the current access token, and must never be
 * written to the sheet or used as a gallery URL. It exists to be downloaded
 * from once, server-side, during import.
 */
export type GooglePickedMedia = {
  id: string;
  /** ISO timestamp of capture, from the item's metadata. */
  createTime?: string;
  /** "PHOTO" | "VIDEO" — anything else is treated as unknown. */
  type?: string;
  /** Temporary. Never persisted. */
  baseUrl?: string;
  mimeType?: string;
  filename?: string;
  width?: number;
  height?: number;
};

/**
 * What a photo is being attached to. Carried from the button that launched
 * the picker all the way through review and import, so the selection can
 * never land on the wrong visit.
 */
export type PhotoContext = {
  kind: "visit" | "trip";
  /** Present for visit-level photos (and residence periods). */
  placeId?: string;
  /** Present for visit-level photos. May be a local id until the row syncs. */
  visitId?: string;
  /** Present for trip-level photos, and for visits that belong to a trip. */
  tripId?: string;
  /** The date range shown before the picker opens and checked after. */
  startDate?: string;
  endDate?: string;
  /** "Salt Lake City" or "Japan 2026" — the heading over the flow. */
  title: string;
  /** "Feb 7–10, 2024" — the subheading. */
  subtitle?: string;
};
