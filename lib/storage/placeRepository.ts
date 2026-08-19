import type { NewPlaceInput, PlaceChanges, VisitedPlace } from "@/types/place";
import { createId } from "@/lib/utils/id";
import { clampLatitude, isValidLatitude, isValidLongitude, normalizeLongitude } from "@/lib/utils/geo";

/**
 * The one seam between the app and where travel data lives.
 *
 * Every read and write in the UI goes through this interface, so swapping
 * localStorage for Supabase later is a matter of writing a second
 * implementation — no component changes, no scattered storage calls.
 */
export interface PlaceRepository {
  getAll(): Promise<VisitedPlace[]>;
  getById(id: string): Promise<VisitedPlace | null>;
  create(input: NewPlaceInput): Promise<VisitedPlace>;
  update(id: string, changes: PlaceChanges): Promise<VisitedPlace>;
  delete(id: string): Promise<void>;
  updateCoordinates(id: string, latitude: number, longitude: number): Promise<VisitedPlace>;
  /** Re-inserts a previously deleted record verbatim, preserving its id. */
  restore(place: VisitedPlace): Promise<VisitedPlace>;
  /** Tombstones included — what a sync layer needs to see. */
  getAllIncludingDeleted(): Promise<VisitedPlace[]>;
  /** Overwrites the collection wholesale, e.g. with a merged remote state. */
  replaceAll(places: VisitedPlace[]): Promise<VisitedPlace[]>;
}

export class PersistenceError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    this.cause = cause;
  }
}

export const STORAGE_KEY = "travel-globe.places.v1";
export const SEEDED_KEY = "travel-globe.seeded.v1";

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22)
  );
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
}

/**
 * Reading is defensive: a hand-edited or half-written localStorage entry
 * should degrade to "the records we can still understand", never to a crash.
 */
function sanitize(raw: unknown): VisitedPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const latitude = typeof value.latitude === "number" ? value.latitude : Number(value.latitude);
  const longitude = typeof value.longitude === "number" ? value.longitude : Number(value.longitude);
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

  const name = trimmed(value.name);
  if (!name) return null;

  const now = new Date().toISOString();
  const photos = Array.isArray(value.photos)
    ? value.photos.filter((photo): photo is string => typeof photo === "string" && photo.length > 0)
    : undefined;

  return {
    id: trimmed(value.id) ?? createId(),
    name,
    city: trimmed(value.city),
    region: trimmed(value.region),
    country: trimmed(value.country) ?? "",
    countryCode: trimmed(value.countryCode)?.toUpperCase(),
    latitude,
    longitude,
    visitedFrom: trimmed(value.visitedFrom),
    visitedTo: trimmed(value.visitedTo),
    notes: trimmed(value.notes),
    coverImage: trimmed(value.coverImage),
    photos: photos && photos.length > 0 ? photos : undefined,
    createdAt: trimmed(value.createdAt) ?? now,
    updatedAt: trimmed(value.updatedAt) ?? now,
    deletedAt: trimmed(value.deletedAt),
  };
}

function normalizeInput(input: NewPlaceInput): Omit<NewPlaceInput, "latitude" | "longitude"> & {
  latitude: number;
  longitude: number;
} {
  return {
    ...input,
    name: input.name.trim(),
    city: trimmed(input.city),
    region: trimmed(input.region),
    country: input.country.trim(),
    countryCode: trimmed(input.countryCode)?.toUpperCase(),
    notes: trimmed(input.notes),
    visitedFrom: trimmed(input.visitedFrom),
    visitedTo: trimmed(input.visitedTo),
    coverImage: trimmed(input.coverImage),
    photos: input.photos && input.photos.length > 0 ? input.photos : undefined,
    latitude: clampLatitude(input.latitude),
    longitude: normalizeLongitude(input.longitude),
  };
}

class LocalStoragePlaceRepository implements PlaceRepository {
  /**
   * Mirrors what is on disk. Kept because localStorage reads are synchronous
   * and repeated `JSON.parse` of the whole collection on every keystroke-driven
   * render would be wasteful.
   */
  private cache: VisitedPlace[] | null = null;

  private storage(): Storage {
    if (typeof window === "undefined" || !window.localStorage) {
      throw new PersistenceError("Storage is unavailable in this environment.");
    }
    return window.localStorage;
  }

  private read(): VisitedPlace[] {
    if (this.cache) return this.cache;

    let parsed: unknown;
    try {
      const raw = this.storage().getItem(STORAGE_KEY);
      if (!raw) {
        this.cache = [];
        return this.cache;
      }
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new PersistenceError("Your saved places could not be read.", error);
    }

    const list = Array.isArray(parsed) ? parsed : [];
    const places = list
      .map(sanitize)
      .filter((place): place is VisitedPlace => place !== null);

    // Drop duplicate ids rather than letting two records fight over one pin.
    const seen = new Set<string>();
    this.cache = places.filter((place) => {
      if (seen.has(place.id)) return false;
      seen.add(place.id);
      return true;
    });

    return this.cache;
  }

  private write(places: VisitedPlace[]): void {
    try {
      this.storage().setItem(STORAGE_KEY, JSON.stringify(places));
      this.cache = places;
    } catch (error) {
      // Leave the cache untouched so the UI can be reconciled from disk.
      this.cache = null;
      if (isQuotaError(error)) {
        throw new PersistenceError(
          "There isn’t enough space left to save. Try removing a few photos.",
          error,
        );
      }
      throw new PersistenceError("Your change could not be saved.", error);
    }
  }

  async getAll(): Promise<VisitedPlace[]> {
    return this.read().filter((place) => !place.deletedAt);
  }

  async getAllIncludingDeleted(): Promise<VisitedPlace[]> {
    return [...this.read()];
  }

  async replaceAll(places: VisitedPlace[]): Promise<VisitedPlace[]> {
    const clean = places
      .map(sanitize)
      .filter((place): place is VisitedPlace => place !== null);
    this.write(clean);
    return clean.filter((place) => !place.deletedAt);
  }

  async getById(id: string): Promise<VisitedPlace | null> {
    const found = this.read().find((place) => place.id === id);
    return found && !found.deletedAt ? found : null;
  }

  async create(input: NewPlaceInput): Promise<VisitedPlace> {
    const now = new Date().toISOString();
    const place: VisitedPlace = {
      ...normalizeInput(input),
      id: createId(),
      createdAt: now,
      updatedAt: now,
    };
    this.write([place, ...this.read()]);
    return place;
  }

  async update(id: string, changes: PlaceChanges): Promise<VisitedPlace> {
    const places = this.read();
    const index = places.findIndex((place) => place.id === id);
    if (index === -1 || places[index].deletedAt) {
      throw new PersistenceError("That place no longer exists.");
    }

    const merged: VisitedPlace = {
      ...places[index],
      ...changes,
      id,
      createdAt: places[index].createdAt,
      updatedAt: new Date().toISOString(),
    };

    const normalized = sanitize(merged);
    if (!normalized) {
      throw new PersistenceError("Those details couldn’t be saved. Check the name and location.");
    }
    // `sanitize` regenerates missing ids; keep the original.
    normalized.id = id;
    normalized.createdAt = places[index].createdAt;
    normalized.longitude = normalizeLongitude(normalized.longitude);
    normalized.latitude = clampLatitude(normalized.latitude);

    const next = [...places];
    next[index] = normalized;
    this.write(next);
    return normalized;
  }

  /**
   * Marks rather than removes. A row that simply vanished locally would be
   * resurrected by the next sync from a device that still had it.
   */
  async delete(id: string): Promise<void> {
    const places = this.read();
    const index = places.findIndex((place) => place.id === id);
    if (index === -1 || places[index].deletedAt) return;
    const now = new Date().toISOString();
    const next = [...places];
    next[index] = { ...next[index], deletedAt: now, updatedAt: now };
    this.write(next);
  }

  async updateCoordinates(id: string, latitude: number, longitude: number): Promise<VisitedPlace> {
    if (!isValidLatitude(latitude) || !isValidLongitude(normalizeLongitude(longitude))) {
      throw new PersistenceError("That location isn’t valid.");
    }
    return this.update(id, { latitude, longitude });
  }

  async restore(place: VisitedPlace): Promise<VisitedPlace> {
    const revived: VisitedPlace = {
      ...place,
      deletedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    const places = this.read();
    const index = places.findIndex((existing) => existing.id === place.id);

    const next = [...places];
    if (index === -1) {
      next.unshift(revived);
    } else {
      next[index] = revived;
    }
    // Newest-first ordering is by creation time.
    next.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    this.write(next);
    return revived;
  }

  /** Used once, on first run, to lay down sample data. */
  async seed(places: VisitedPlace[]): Promise<VisitedPlace[]> {
    this.write(places);
    try {
      this.storage().setItem(SEEDED_KEY, new Date().toISOString());
    } catch {
      // A failed bookkeeping write is not worth failing the seed over.
    }
    return places;
  }

  hasSeeded(): boolean {
    try {
      return this.storage().getItem(SEEDED_KEY) !== null;
    } catch {
      return false;
    }
  }

  hasStoredData(): boolean {
    try {
      return this.storage().getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }
}

export const placeRepository = new LocalStoragePlaceRepository();
