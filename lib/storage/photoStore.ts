/**
 * Photos live in IndexedDB, not localStorage.
 *
 * A place record is a few hundred bytes; a photo is a few hundred kilobytes.
 * Keeping images out of the JSON collection means the travel data itself never
 * bumps into the 5 MB localStorage ceiling, and it mirrors the shape a cloud
 * backend would take later: rows in one store, binaries in another.
 */

const DB_NAME = "travel-globe";
const DB_VERSION = 1;
const STORE = "photos";
const REF_PREFIX = "photo:";

/** Long edge, in CSS pixels, that uploads are resized down to before storing. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export class PhotoStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PhotoStoreError";
  }
}

export function isLocalPhotoRef(ref: string | undefined | null): boolean {
  return typeof ref === "string" && ref.startsWith(REF_PREFIX);
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new PhotoStoreError("Photo storage isn’t available in this browser."));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new PhotoStoreError("Photo storage couldn’t be opened.", error));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new PhotoStoreError("Photo storage couldn’t be opened.", request.error));
    request.onblocked = () =>
      reject(new PhotoStoreError("Photo storage is busy in another tab."));
  }).catch((error) => {
    // Allow a later attempt to retry rather than caching the rejection forever.
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(new PhotoStoreError("That photo couldn’t be saved.", request.error));
        tx.onabort = () =>
          reject(new PhotoStoreError("That photo couldn’t be saved.", tx.error));
      }),
  );
}

/**
 * Resize on the way in. A modern phone photo is 3–8 MB; at 1600px/JPEG 0.82 the
 * same image is 150–400 KB and indistinguishable at the sizes we render.
 */
async function compress(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // HEIC and friends: store the original rather than failing.
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 600_000) return file;

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    return blob && blob.size > 0 ? blob : file;
  } finally {
    bitmap.close();
  }
}

export async function savePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new PhotoStoreError("That file isn’t an image.");
  }
  const blob = await compress(file);
  const key = `${REF_PREFIX}${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  await run("readwrite", (store) => store.put(blob, key) as IDBRequest<IDBValidKey>);
  return key;
}

export async function getPhoto(ref: string): Promise<Blob | null> {
  if (!isLocalPhotoRef(ref)) return null;
  try {
    const value = await run<Blob | undefined>("readonly", (store) => store.get(ref));
    return value ?? null;
  } catch {
    return null;
  }
}

export async function deletePhoto(ref: string): Promise<void> {
  if (!isLocalPhotoRef(ref)) return;
  try {
    await run("readwrite", (store) => store.delete(ref) as IDBRequest<undefined>);
  } catch {
    // An orphaned blob is harmless; never block a delete on cleanup.
  }
}

export async function deletePhotos(refs: Array<string | undefined>): Promise<void> {
  await Promise.all(refs.filter(Boolean).map((ref) => deletePhoto(ref as string)));
}

/**
 * Resolve a stored reference to something an `<img>` can use. Remote URLs pass
 * through untouched; local refs become object URLs the caller must revoke.
 */
export async function resolvePhotoUrl(ref: string): Promise<string | null> {
  if (!isLocalPhotoRef(ref)) return ref;
  const blob = await getPhoto(ref);
  return blob ? URL.createObjectURL(blob) : null;
}
