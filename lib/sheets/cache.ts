import type { PlaceVisit, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";
import type { MediaLink } from "@/lib/sheets/mapping";

/**
 * A copy of the last good load from the sheet.
 *
 * Only ever a cache: the sheet is the truth, and a successful startup load
 * overwrites this wholesale rather than merging into it. Its one job is that
 * opening the app on a train shows the travel history instead of a blank
 * screen with an error on it.
 */

const KEY = "travel-globe.sheet-cache.v1";

export type CachedSnapshot = {
  places: VisitedPlace[];
  /**
   * Absent from caches written before trips existed, which is why it is read
   * defensively below rather than versioning the key: a returning browser
   * should still open on its travel history, not on a blank screen.
   */
  trips: Trip[];
  /** Absent from older caches, read defensively for the same reason as trips. */
  visits: PlaceVisit[];
  /** Photo rows from Media_Links, so uploads still show offline. */
  media: MediaLink[];
  /**
   * The Dates_Visits headers seen at the last load, so a visit queued offline
   * is still trimmed to the columns this particular sheet actually has.
   */
  visitHeaders: string[];
  lookups: Record<string, string[]>;
  settings: Record<string, string>;
  cachedAt: string;
};

export function loadCache(): CachedSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedSnapshot>;
    if (!Array.isArray(parsed.places)) return null;

    return {
      places: parsed.places as VisitedPlace[],
      trips: Array.isArray(parsed.trips) ? (parsed.trips as Trip[]) : [],
      visits: Array.isArray(parsed.visits) ? (parsed.visits as PlaceVisit[]) : [],
      media: Array.isArray(parsed.media) ? (parsed.media as MediaLink[]) : [],
      visitHeaders: Array.isArray(parsed.visitHeaders)
        ? (parsed.visitHeaders as string[])
        : [],
      lookups: (parsed.lookups ?? {}) as Record<string, string[]>,
      settings: (parsed.settings ?? {}) as Record<string, string>,
      cachedAt: typeof parsed.cachedAt === "string" ? parsed.cachedAt : "",
    };
  } catch {
    return null;
  }
}

export function saveCache(snapshot: Omit<CachedSnapshot, "cachedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...snapshot, cachedAt: new Date().toISOString() }),
    );
  } catch {
    // The cache is an optimisation. Failing to write it must never fail a save.
  }
}

export function clearCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do here.
  }
}
