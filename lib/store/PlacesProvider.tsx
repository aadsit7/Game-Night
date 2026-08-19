"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { buildSamplePlaces } from "@/data/samplePlaces";
import { PersistenceError, placeRepository } from "@/lib/storage/placeRepository";
import { deletePhotos } from "@/lib/storage/photoStore";
import { useGithubSync, type SyncState } from "@/lib/sync/useGithubSync";
import type { SyncSettings } from "@/lib/sync/syncSettings";
import type { NewPlaceInput, PlaceChanges, VisitedPlace } from "@/types/place";

/**
 * The single source of truth.
 *
 * Both the globe and the list read from `places` here; neither keeps its own
 * copy, so they cannot drift. Writes are applied to state first and persisted
 * immediately after — a localStorage round-trip is sub-millisecond, so the UI
 * updates on the same frame as the tap, and a persistence failure reconciles
 * state back to whatever is actually on disk.
 */

type Status = "loading" | "ready" | "error";

type PlacesContextValue = {
  places: VisitedPlace[];
  status: Status;
  /** Set when the collection itself could not be loaded. */
  loadError: string | null;
  getPlace: (id: string | null | undefined) => VisitedPlace | undefined;
  stats: { places: number; countries: number };
  countries: Array<{ key: string; label: string; code?: string; count: number }>;
  createPlace: (input: NewPlaceInput) => Promise<VisitedPlace>;
  updatePlace: (id: string, changes: PlaceChanges) => Promise<VisitedPlace>;
  movePlace: (id: string, latitude: number, longitude: number) => Promise<VisitedPlace>;
  /** Removes the place and hands back the record so it can be restored. */
  deletePlace: (id: string) => Promise<VisitedPlace | null>;
  restorePlace: (place: VisitedPlace) => Promise<void>;
  /** Called once an undo window closes, to release the record's photo blobs. */
  discardPlacePhotos: (place: VisitedPlace) => void;
  reload: () => Promise<void>;
  /** Cross-device sync through the GitHub repository. */
  sync: {
    state: SyncState;
    settings: SyncSettings | null;
    updateSettings: (settings: SyncSettings) => void;
    syncNow: () => void;
  };
};

const PlacesContext = createContext<PlacesContextValue | null>(null);

const SEED_ENABLED = process.env.NEXT_PUBLIC_SEED_SAMPLE_DATA !== "false";

function friendlyMessage(error: unknown, fallback: string): string {
  if (error instanceof PersistenceError) return error.message;
  return fallback;
}

function photoRefs(place: VisitedPlace | undefined): string[] {
  if (!place) return [];
  return [place.coverImage, ...(place.photos ?? [])].filter(
    (ref): ref is string => typeof ref === "string" && ref.length > 0,
  );
}

export function PlacesProvider({ children }: { children: ReactNode }) {
  const [places, setPlaces] = useState<VisitedPlace[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const mounted = useRef(true);
  const pendingSeed = useRef(false);
  const schedulePushRef = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      // Seeding is deferred until the first sync has settled. Laying sample
      // places down first would merge them into a real travel history the
      // moment a new device pulled it — and then push them back up.
      pendingSeed.current =
        SEED_ENABLED && !placeRepository.hasStoredData() && !placeRepository.hasSeeded();
      const stored = await placeRepository.getAll();
      if (!mounted.current) return;
      setPlaces(stored);
      setLoadError(null);
      setStatus("ready");
    } catch (error) {
      if (!mounted.current) return;
      setPlaces([]);
      setLoadError(
        friendlyMessage(error, "Your travel history couldn’t be opened on this device."),
      );
      setStatus("error");
    }
  }, []);

  // Reading the collection out of the browser's storage is precisely the
  // "synchronise with an external system" case effects exist for; `load`
  // resolves asynchronously, so no state is set during the effect itself.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * The repository is also the storage: another device's changes arrive here,
   * and this device's go back the same way. Reading needs no credentials;
   * writing needs a token the owner has pasted into this browser.
   */
  /**
   * Sample data only lands on a device whose repository is genuinely empty —
   * never on top of a real history someone has already built.
   */
  const seedIfStillEmpty = useCallback(async () => {
    if (!pendingSeed.current) return;
    pendingSeed.current = false;
    try {
      const current = await placeRepository.getAll();
      if (current.length > 0) return;
      const seeded = await placeRepository.seed(buildSamplePlaces());
      if (mounted.current) setPlaces(seeded);
      schedulePushRef.current();
    } catch {
      // Failing to seed sample data is never worth surfacing.
    }
  }, []);

  const { settings, updateSettings, syncState, schedulePush, syncNow } = useGithubSync({
    ready: status !== "loading",
    onMerged: useCallback((merged: VisitedPlace[]) => {
      if (mounted.current) setPlaces(merged);
    }, []),
    onFirstSyncSettled: () => void seedIfStillEmpty(),
  });

  useEffect(() => {
    schedulePushRef.current = schedulePush;
  }, [schedulePush]);

  /** Re-reads from disk after a failed write so the UI never shows a lie. */
  const reconcile = useCallback(async () => {
    try {
      const stored = await placeRepository.getAll();
      if (mounted.current) setPlaces(stored);
    } catch {
      // If even reading fails there is nothing useful left to do here.
    }
  }, []);

  const createPlace = useCallback(
    async (input: NewPlaceInput) => {
      try {
        const created = await placeRepository.create(input);
        setPlaces((current) => [created, ...current]);
        schedulePush();
        return created;
      } catch (error) {
        await reconcile();
        throw new Error(friendlyMessage(error, "That place couldn’t be saved."));
      }
    },
    [reconcile, schedulePush],
  );

  const updatePlace = useCallback(
    async (id: string, changes: PlaceChanges) => {
      const previous = places.find((place) => place.id === id);
      try {
        const updated = await placeRepository.update(id, changes);
        setPlaces((current) =>
          current.map((place) => (place.id === id ? updated : place)),
        );

        // Release blobs for photos the edit dropped.
        const removed = photoRefs(previous).filter((ref) => !photoRefs(updated).includes(ref));
        if (removed.length > 0) void deletePhotos(removed);

        schedulePush();
        return updated;
      } catch (error) {
        await reconcile();
        throw new Error(friendlyMessage(error, "Those changes couldn’t be saved."));
      }
    },
    [places, reconcile, schedulePush],
  );

  const movePlace = useCallback(
    async (id: string, latitude: number, longitude: number) => {
      try {
        const updated = await placeRepository.updateCoordinates(id, latitude, longitude);
        setPlaces((current) => current.map((place) => (place.id === id ? updated : place)));
        schedulePush();
        return updated;
      } catch (error) {
        await reconcile();
        throw new Error(friendlyMessage(error, "That pin couldn’t be moved."));
      }
    },
    [reconcile, schedulePush],
  );

  const deletePlace = useCallback(
    async (id: string) => {
      const removed = places.find((place) => place.id === id) ?? null;
      // Remove from view first: deletion must feel instant.
      setPlaces((current) => current.filter((place) => place.id !== id));
      try {
        await placeRepository.delete(id);
        schedulePush();
        return removed;
      } catch (error) {
        await reconcile();
        throw new Error(friendlyMessage(error, "That place couldn’t be deleted."));
      }
    },
    [places, reconcile, schedulePush],
  );

  const restorePlace = useCallback(
    async (place: VisitedPlace) => {
      try {
        await placeRepository.restore(place);
        await reconcile();
        schedulePush();
      } catch (error) {
        throw new Error(friendlyMessage(error, "That place couldn’t be restored."));
      }
    },
    [reconcile, schedulePush],
  );

  const discardPlacePhotos = useCallback((place: VisitedPlace) => {
    void deletePhotos(photoRefs(place));
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, VisitedPlace>();
    for (const place of places) map.set(place.id, place);
    return map;
  }, [places]);

  const getPlace = useCallback(
    (id: string | null | undefined) => (id ? byId.get(id) : undefined),
    [byId],
  );

  const countries = useMemo(() => {
    const map = new Map<string, { key: string; label: string; code?: string; count: number }>();
    for (const place of places) {
      const label = place.country?.trim();
      if (!label) continue;
      const key = (place.countryCode ?? label).toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { key, label, code: place.countryCode, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [places]);

  const stats = useMemo(
    () => ({ places: places.length, countries: countries.length }),
    [places.length, countries.length],
  );

  const value = useMemo<PlacesContextValue>(
    () => ({
      places,
      status,
      loadError,
      getPlace,
      stats,
      countries,
      createPlace,
      updatePlace,
      movePlace,
      deletePlace,
      restorePlace,
      discardPlacePhotos,
      reload: load,
      sync: { state: syncState, settings, updateSettings, syncNow },
    }),
    [
      places,
      status,
      loadError,
      getPlace,
      stats,
      countries,
      createPlace,
      updatePlace,
      movePlace,
      deletePlace,
      restorePlace,
      discardPlacePhotos,
      load,
      syncState,
      settings,
      updateSettings,
      syncNow,
    ],
  );

  return <PlacesContext.Provider value={value}>{children}</PlacesContext.Provider>;
}

export function usePlaces(): PlacesContextValue {
  const context = useContext(PlacesContext);
  if (!context) {
    throw new Error("usePlaces must be used inside <PlacesProvider>.");
  }
  return context;
}
