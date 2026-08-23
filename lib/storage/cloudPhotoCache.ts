/**
 * A device-local cache of cloud photo bytes.
 *
 * The durable copies live in Google Drive and are served through the Apps
 * Script; this cache is what makes the second look at a gallery instant and
 * the offline look possible at all. Its own IndexedDB database, separate
 * from the legacy `travel-globe` one, so the version-1 store holding old
 * `photo:` blobs is never touched by an upgrade here.
 *
 * Keys carry the photo's version: when a photo's row changes in the sheet,
 * its key changes with it, the fresh bytes are fetched once, and the stale
 * entry is deleted in passing rather than lingering forever.
 */

import type { TravelPhotoSize } from "@/types/travelPhoto";

const DB_NAME = "travel-globe-cloud";
const DB_VERSION = 1;
const STORE = "renditions";

/** One addressable cache entry. Pure, so the key scheme is testable. */
export function cacheKey(photoId: string, size: TravelPhotoSize, version: string): string {
  return `${photoId}|${size}|${version || "0"}`;
}

/** Every entry for one photo+size starts with this, whatever its version. */
export function cacheKeyPrefix(photoId: string, size: TravelPhotoSize): string {
  return `${photoId}|${size}|`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Photo caching isn’t available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Photo cache couldn’t be opened."));
    request.onblocked = () => reject(new Error("Photo cache is busy in another tab."));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** The cached rendition, or null. Never throws — a cache miss is normal. */
export async function getCachedPhoto(
  photoId: string,
  size: TravelPhotoSize,
  version: string,
): Promise<Blob | null> {
  try {
    const value = await run<Blob | undefined>("readonly", (store) =>
      store.get(cacheKey(photoId, size, version)),
    );
    return value instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

/** Stores a rendition and sweeps that photo+size's stale versions. */
export async function cachePhoto(
  photoId: string,
  size: TravelPhotoSize,
  version: string,
  blob: Blob,
): Promise<void> {
  try {
    await run("readwrite", (store) => store.put(blob, cacheKey(photoId, size, version)));
    const prefix = cacheKeyPrefix(photoId, size);
    const keys = await run<IDBValidKey[]>("readonly", (store) =>
      store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)),
    );
    const current = cacheKey(photoId, size, version);
    for (const key of keys) {
      if (typeof key === "string" && key !== current) {
        await run("readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
      }
    }
  } catch {
    // A cache that cannot write is a cache that misses; nothing to do.
  }
}

/** Forgets every rendition of a photo — called when the photo is deleted. */
export async function forgetCachedPhoto(photoId: string): Promise<void> {
  try {
    for (const size of ["thumb", "display", "video"] as const) {
      const prefix = cacheKeyPrefix(photoId, size);
      const keys = await run<IDBValidKey[]>("readonly", (store) =>
        store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)),
      );
      for (const key of keys) {
        await run("readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
      }
    }
  } catch {
    // Orphaned cache entries are storage, not correctness.
  }
}
