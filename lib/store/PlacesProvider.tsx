"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import type { SheetConnection } from "@/lib/sheets/connection";
import { useSheetSync } from "@/lib/sheets/useSheetSync";
import { deletePhotos } from "@/lib/storage/photoStore";
import { PersistenceError } from "@/lib/storage/placeRepository";
import { sheetPlaceRepository, type SheetStatus } from "@/lib/storage/sheetPlaceRepository";
import type { NewPlaceInput, PlaceChanges, VisitedPlace } from "@/types/place";

/**
 * The single source of truth in the app, standing in front of the single
 * source of truth on the internet.
 *
 * Both the globe and the list read `places` from here; neither keeps its own
 * copy, so they cannot drift. Writes land in memory first and go to the sheet
 * immediately afterwards, so a tap never waits on a network round trip — and
 * if that round trip fails, the change is queued rather than lost.
 */

type Status = "loading" | "ready" | "error";

type PlacesContextValue = {
  places: VisitedPlace[];
  status: Status;
  /** Set when the collection itself could not be loaded. */
  loadError: string | null;
  /** True until this browser has been given the sheet address and code. */
  needsSetup: boolean;
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
  /** The Google Sheet this browser is pointed at. */
  sync: {
    state: SheetStatus;
    connection: SheetConnection | null;
    /** Dropdown values read from the sheet's Lookups tab at startup. */
    lookups: Record<string, string[]>;
    connect: (connection: SheetConnection) => void;
    disconnect: () => void;
    syncNow: () => void;
  };
};

const PlacesContext = createContext<PlacesContextValue | null>(null);

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
  // The repository is the store. Nothing is mirrored into component state, so
  // there is no second copy to fall out of step with it — every mutation below
  // commits there and React is told through the subscription.
  const sync = useSheetSync();
  const { places } = sync;

  const createPlace = useCallback(async (input: NewPlaceInput) => {
    try {
      return await sheetPlaceRepository.create(input);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That place couldn’t be saved."));
    }
  }, []);

  const updatePlace = useCallback(
    async (id: string, changes: PlaceChanges) => {
      const previous = places.find((place) => place.id === id);
      try {
        const updated = await sheetPlaceRepository.update(id, changes);

        // Release blobs for photos the edit dropped.
        const removed = photoRefs(previous).filter((ref) => !photoRefs(updated).includes(ref));
        if (removed.length > 0) void deletePhotos(removed);

        return updated;
      } catch (error) {
        throw new Error(friendlyMessage(error, "Those changes couldn’t be saved."));
      }
    },
    [places],
  );

  const movePlace = useCallback(async (id: string, latitude: number, longitude: number) => {
    try {
      return await sheetPlaceRepository.updateCoordinates(id, latitude, longitude);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That pin couldn’t be moved."));
    }
  }, []);

  const deletePlace = useCallback(
    async (id: string) => {
      const removed = places.find((place) => place.id === id) ?? null;
      try {
        await sheetPlaceRepository.delete(id);
        return removed;
      } catch (error) {
        throw new Error(friendlyMessage(error, "That place couldn’t be deleted."));
      }
    },
    [places],
  );

  const restorePlace = useCallback(async (place: VisitedPlace) => {
    try {
      await sheetPlaceRepository.restore(place);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That place couldn’t be restored."));
    }
  }, []);

  const discardPlacePhotos = useCallback((place: VisitedPlace) => {
    void deletePhotos(photoRefs(place));
  }, []);

  const reload = useCallback(async () => {
    await sheetPlaceRepository.load();
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

  /**
   * A cached copy on screen counts as ready even while the sheet is out of
   * reach — the alternative is a spinner over data the person can already
   * see. Only an empty screen waits or reports a failure.
   */
  const status: Status = useMemo(() => {
    if (places.length > 0) return "ready";
    if (sync.state.phase === "error") return "error";
    if (sync.state.phase === "loading" || sync.state.phase === "unconfigured") return "loading";
    return "ready";
  }, [places.length, sync.state.phase]);

  const value = useMemo<PlacesContextValue>(
    () => ({
      places,
      status,
      loadError: sync.state.phase === "error" ? sync.state.error : null,
      needsSetup: sync.state.phase === "unconfigured",
      getPlace,
      stats,
      countries,
      createPlace,
      updatePlace,
      movePlace,
      deletePlace,
      restorePlace,
      discardPlacePhotos,
      reload,
      sync: {
        state: sync.state,
        connection: sync.connection,
        lookups: sync.lookups,
        connect: sync.connect,
        disconnect: sync.disconnect,
        syncNow: sync.syncNow,
      },
    }),
    [
      places,
      status,
      getPlace,
      stats,
      countries,
      createPlace,
      updatePlace,
      movePlace,
      deletePlace,
      restorePlace,
      discardPlacePhotos,
      reload,
      sync,
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
