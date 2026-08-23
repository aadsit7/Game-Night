import { loadMediaCode } from "@/lib/photos/mediaCode";
import { SheetError, getTravelPhoto } from "@/lib/sheets/sheetsClient";
import { cachePhoto, getCachedPhoto } from "@/lib/storage/cloudPhotoCache";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import type { TravelPhoto, TravelPhotoSize } from "@/types/travelPhoto";

/**
 * Where a gallery gets its pixels.
 *
 * Cache first, then the Apps Script, then the cache again for next time.
 * Every image on screen funnels through here, so this is also where the
 * download concurrency is capped: an iPhone opening a 30-photo gallery asks
 * politely four at a time instead of firing thirty requests at a script
 * with an execution quota.
 */

export type PhotoLoadFailure =
  /** No media access code is stored on this device yet. */
  | "code-missing"
  /** The script rejected the stored code. */
  | "code-rejected"
  | "offline"
  | "failed";

export class PhotoSourceError extends Error {
  readonly reason: PhotoLoadFailure;
  constructor(reason: PhotoLoadFailure, message: string) {
    super(message);
    this.name = "PhotoSourceError";
    this.reason = reason;
  }
}

const MAX_CONCURRENT_DOWNLOADS = 4;

let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_DOWNLOADS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/** Base64 (no data-URL prefix) to a Blob, the reverse of the upload path. */
function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "image/jpeg" });
}

/** The version half of the cache key: the row's last change, not a guess. */
export function photoVersion(photo: Pick<TravelPhoto, "updatedAt">): string {
  return photo.updatedAt ?? "";
}

/**
 * The bytes of one rendition, as a Blob the caller turns into an object
 * URL. Cached bytes come back without touching the network — which is the
 * whole cross-device promise: on the second open, an iPad shows the gallery
 * from its own disk.
 */
export async function loadTravelPhotoBlob(
  photo: Pick<TravelPhoto, "id" | "updatedAt">,
  size: TravelPhotoSize,
): Promise<Blob> {
  const version = photoVersion(photo);
  const cached = await getCachedPhoto(photo.id, size, version);
  if (cached) return cached;

  const connection = sheetPlaceRepository.getConnection();
  if (!connection) throw new PhotoSourceError("failed", "Not connected to the sheet.");

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new PhotoSourceError("offline", "This photo isn’t cached yet, and you’re offline.");
  }

  const mediaCode = loadMediaCode();
  if (!mediaCode) {
    throw new PhotoSourceError(
      "code-missing",
      "Enter your media access code once to view photos on this device.",
    );
  }

  return withSlot(async () => {
    // Re-check inside the slot: the wait may have outlived the miss.
    const again = await getCachedPhoto(photo.id, size, version);
    if (again) return again;

    try {
      // A video's bytes are megabytes where a thumb is kilobytes; give the
      // transfer the time it actually needs.
      const deadline =
        size === "video" &&
        typeof AbortSignal !== "undefined" &&
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(180_000)
          : undefined;
      const result = await getTravelPhoto(
        connection,
        { photoId: photo.id, size, mediaCode },
        deadline,
      );
      const blob = base64ToBlob(result.data, result.mimeType);
      if (blob.size === 0) throw new PhotoSourceError("failed", "The photo arrived empty.");
      void cachePhoto(photo.id, size, version, blob);
      return blob;
    } catch (error) {
      if (error instanceof PhotoSourceError) throw error;
      if (error instanceof SheetError) {
        if (/media access code/i.test(error.message)) {
          throw new PhotoSourceError("code-rejected", error.message);
        }
        if (error.kind === "network" || error.kind === "timeout") {
          throw new PhotoSourceError("offline", "The photo couldn’t be reached. Check the connection.");
        }
        throw new PhotoSourceError("failed", error.message);
      }
      throw new PhotoSourceError("failed", "That photo couldn’t be loaded.");
    }
  });
}
