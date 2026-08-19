import { isRemotePhoto } from "@/lib/sheets/mapping";
import type { VisitedPlace } from "@/types/place";

/**
 * Photo references that only mean something in this browser.
 *
 * An uploaded photo is a blob in IndexedDB, referenced as `photo:<uuid>`. A
 * spreadsheet cell holds text, and that text would be meaningless on another
 * device, so uploads stay local and only real links go into the Photo URL
 * column. Without this side table, the first reload from the sheet would drop
 * every uploaded photo from view — the blob would still be there, with nothing
 * left pointing at it.
 */

const KEY = "travel-globe.local-photos.v1";

type LocalPhotos = Record<string, { coverImage?: string; photos?: string[] }>;

function read(): LocalPhotos {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LocalPhotos) : {};
  } catch {
    return {};
  }
}

function write(value: LocalPhotos): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // The photo itself is safe in IndexedDB either way.
  }
}

function localOnly(refs: string[] | undefined): string[] {
  return (refs ?? []).filter((ref) => typeof ref === "string" && ref && !isRemotePhoto(ref));
}

/** Records what a place holds locally. Called after every successful edit. */
export function rememberLocalPhotos(place: VisitedPlace): void {
  const store = read();
  const cover = isRemotePhoto(place.coverImage) ? undefined : place.coverImage;
  const photos = localOnly(place.photos);

  if (!cover && photos.length === 0) {
    if (!(place.id in store)) return;
    delete store[place.id];
  } else {
    store[place.id] = { coverImage: cover, photos: photos.length > 0 ? photos : undefined };
  }
  write(store);
}

/** Moves a record's photos across when the sheet assigns it a real id. */
export function renameLocalPhotos(fromId: string, toId: string): void {
  const store = read();
  if (!(fromId in store)) return;
  store[toId] = store[fromId];
  delete store[fromId];
  write(store);
}

export function forgetLocalPhotos(id: string): void {
  const store = read();
  if (!(id in store)) return;
  delete store[id];
  write(store);
}

/**
 * Puts local photos back onto places loaded from the sheet.
 *
 * A link in the Photo URL column wins as the cover, because that is the value
 * the sheet actually holds and the one every device can see.
 */
export function applyLocalPhotos(places: VisitedPlace[]): VisitedPlace[] {
  const store = read();
  if (Object.keys(store).length === 0) return places;

  return places.map((place) => {
    const local = store[place.id];
    if (!local) return place;

    const photos = [...(place.photos ?? []), ...(local.photos ?? [])];
    return {
      ...place,
      coverImage: place.coverImage ?? local.coverImage,
      photos: photos.length > 0 ? [...new Set(photos)] : undefined,
    };
  });
}
