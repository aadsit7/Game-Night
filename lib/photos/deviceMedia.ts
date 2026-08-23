import type { TravelPhotoSource } from "@/types/travelPhoto";

/**
 * Media picked straight from the device — the iPhone photo library, the
 * Files app, a Drive folder — turned into the same shape the Google Photos
 * import produces: JPEG renditions plus, for a video small enough to move,
 * the clip itself. The pure decisions live at the top so they can be tested
 * without a browser; everything that needs a canvas or a <video> element is
 * below and only ever runs in one.
 *
 * Videos never pass through a resize: the browser cannot re-encode a clip
 * worth keeping, so a small clip travels as its own bytes and a large one
 * honestly becomes its poster frame — exactly the deal the picker import
 * already offers when a clip is beyond the script's limits.
 */

export class DeviceMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceMediaError";
  }
}

/**
 * The largest clip sent in full. An Apps Script request bears ~50 MB and
 * base64 costs a third again, so 25 MB of video leaves comfortable room for
 * the JSON around it. Beyond this, the poster frames still upload and the
 * show plays the labelled preview.
 */
export const MAX_DEVICE_CLIP_BYTES = 25 * 1024 * 1024;

/** One picking session's worth. A cap with a message beats a silent hang. */
export const DEVICE_MEDIA_BATCH_LIMIT = 12;

/** Matches the picker import's renditions, so galleries can't tell them apart. */
const THUMB_EDGE = 512;
const DISPLAY_EDGE = 2048;
const JPEG_QUALITY = 0.82;

export type DeviceMediaKind = "photo" | "video";

const PHOTO_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp", "hevc"]);

/**
 * What one picked file is, by MIME type first and extension as the fallback
 * — a file handed over by a Drive folder sometimes arrives typeless. Null
 * means neither: a PDF, a zip, something the galleries have no business with.
 */
export function classifyPickedFile(name: string, mimeType: string): DeviceMediaKind | null {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";

  const extension = /\.([a-z0-9]+)$/i.exec((name || "").toLowerCase())?.[1] ?? "";
  if (PHOTO_EXTENSIONS.has(extension)) return "photo";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

/** Whether a clip's own bytes ride along, or only its poster frames. */
export function shouldInlineClip(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_DEVICE_CLIP_BYTES;
}

/**
 * The durable identity of a device file, playing the role the Google Photos
 * item id plays for picked media: what "already added" means. Prefixed so
 * the two id spaces can never collide in the same column.
 */
export function deviceItemId(digestHex: string): string {
  return `device-${digestHex}`;
}

/**
 * The capture time the file system offers. Files coming out of Drive carry
 * their modified time — not the shutter moment, but the honest nearest
 * thing, and enough to place the file in a show's chronology.
 */
export function takenAtFrom(lastModified: number): string | undefined {
  if (!Number.isFinite(lastModified) || lastModified <= 0) return undefined;
  try {
    return new Date(lastModified).toISOString();
  } catch {
    return undefined;
  }
}

export type PreparedDeviceMedia = {
  kind: DeviceMediaKind;
  filename: string;
  mimeType: string;
  takenAt?: string;
  width?: number;
  height?: number;
  /** `device-<hash>`, when this browser can hash; absent skips deduplication. */
  itemId?: string;
  /** JPEG renditions, generated here so every row is guaranteed to have them. */
  thumb: Blob;
  display: Blob;
  /** The clip's own bytes — only for a video within the transfer limit. */
  clip?: Blob;
  /** True when a video stays behind as its poster because of its size. */
  clipTooLarge: boolean;
  source: TravelPhotoSource;
};

/* ------------------------------------------------------------------ *
 * Browser-only below: canvases, <video> elements, crypto.subtle.
 * ------------------------------------------------------------------ */

/**
 * SHA-256 over the file's size and first two megabytes — cheap enough for a
 * phone, stable enough to answer "did I add this exact file already". A
 * browser without subtle crypto simply skips deduplication.
 */
export async function fileIdentity(file: File): Promise<string | undefined> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
    const head = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
    const sized = new Uint8Array(head.byteLength + 8);
    sized.set(new Uint8Array(head), 0);
    new DataView(sized.buffer).setFloat64(head.byteLength, file.size);
    const digest = await crypto.subtle.digest("SHA-256", sized);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

/** One JPEG rendition of anything a canvas can draw. */
async function rendition(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight, 1));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new DeviceMediaError("This browser couldn’t draw the preview image.");
  context.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob || blob.size === 0) {
    throw new DeviceMediaError("This browser couldn’t draw the preview image.");
  }
  return blob;
}

/** Waits for one of the named events, or fails honestly after a timeout. */
function nextEvent(
  target: EventTarget,
  resolveOn: string[],
  rejectOn: string[],
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanups: Array<() => void> = [];
    const settle = (fn: () => void) => () => {
      for (const cleanup of cleanups) cleanup();
      fn();
    };
    const done = settle(resolve);
    const failed = settle(() => reject(new DeviceMediaError(timeoutMessage)));
    for (const name of resolveOn) {
      target.addEventListener(name, done);
      cleanups.push(() => target.removeEventListener(name, done));
    }
    for (const name of rejectOn) {
      target.addEventListener(name, failed);
      cleanups.push(() => target.removeEventListener(name, failed));
    }
    const timer = window.setTimeout(failed, timeoutMs);
    cleanups.push(() => window.clearTimeout(timer));
  });
}

async function preparePhoto(file: File, base: Omit<PreparedDeviceMedia, "thumb" | "display" | "kind" | "clipTooLarge">): Promise<PreparedDeviceMedia> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new DeviceMediaError(
      `“${file.name}” couldn’t be read as a picture on this device.`,
    );
  }
  try {
    const thumb = await rendition(bitmap, bitmap.width, bitmap.height, THUMB_EDGE);
    const display = await rendition(bitmap, bitmap.width, bitmap.height, DISPLAY_EDGE);
    return {
      ...base,
      kind: "photo",
      width: bitmap.width || undefined,
      height: bitmap.height || undefined,
      thumb,
      display,
      clipTooLarge: false,
    };
  } finally {
    bitmap.close();
  }
}

async function prepareVideo(file: File, base: Omit<PreparedDeviceMedia, "thumb" | "display" | "kind" | "clipTooLarge">): Promise<PreparedDeviceMedia> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    await nextEvent(
      video,
      ["loadeddata"],
      ["error"],
      20_000,
      `“${file.name}” couldn’t be played on this device, so no preview frame could be taken.`,
    );

    // A frame from just inside the clip: the first frame of a phone video is
    // often black or mid-shake, and half a second in is already the scene.
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const at = Math.min(0.5, duration > 0 ? duration / 4 : 0);
    if (at > 0 && Math.abs(video.currentTime - at) > 0.01) {
      video.currentTime = at;
      await nextEvent(video, ["seeked"], ["error"], 10_000,
        `A preview frame couldn’t be taken from “${file.name}”.`);
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new DeviceMediaError(`A preview frame couldn’t be taken from “${file.name}”.`);
    }

    const thumb = await rendition(video, width, height, THUMB_EDGE);
    const display = await rendition(video, width, height, DISPLAY_EDGE);
    const inline = shouldInlineClip(file.size);

    return {
      ...base,
      kind: "video",
      width,
      height,
      thumb,
      display,
      clip: inline ? file : undefined,
      clipTooLarge: !inline,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * One picked file, made uploadable: classified, hashed, rendered down to
 * gallery sizes, and — for a small enough video — carrying its own bytes.
 * Throws a `DeviceMediaError` whose message can face the person directly.
 */
export async function prepareDeviceMedia(file: File): Promise<PreparedDeviceMedia> {
  const kind = classifyPickedFile(file.name, file.type);
  if (!kind) {
    throw new DeviceMediaError(`“${file.name}” isn’t a photo or a video.`);
  }

  const hash = await fileIdentity(file);
  const base = {
    filename: file.name || (kind === "video" ? "video" : "photo"),
    mimeType: file.type || (kind === "video" ? "video/mp4" : "image/jpeg"),
    takenAt: takenAtFrom(file.lastModified),
    itemId: hash ? deviceItemId(hash) : undefined,
    source: "manual" as const,
  };

  return kind === "photo" ? preparePhoto(file, base) : prepareVideo(file, base);
}
