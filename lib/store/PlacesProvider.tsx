"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import type { SheetConnection } from "@/lib/sheets/connection";
import type { ImportItemResult, SheetCapabilities } from "@/lib/sheets/sheetsClient";
import { useSheetSync } from "@/lib/sheets/useSheetSync";
import { sortTrips } from "@/lib/trips/tripDays";
import { deletePhotos } from "@/lib/storage/photoStore";
import { PersistenceError } from "@/lib/storage/placeRepository";
import { sheetPlaceRepository, type SheetStatus } from "@/lib/storage/sheetPlaceRepository";
import { findDuplicatePlace } from "@/lib/places/dedupe";
import type {
  NewPlaceInput,
  NewVisitInput,
  PlaceChanges,
  PlaceVisit,
  VisitChanges,
  VisitedPlace,
} from "@/types/place";
import type { NewTripInput, Trip, TripChanges } from "@/types/trip";
import type { GooglePickedMedia, TravelPhoto } from "@/types/travelPhoto";

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
  /**
   * The coverage read-out. Counts only places actually visited: somewhere you
   * want to go is not a country you have seen, and letting a wishlist inflate
   * "% of world" would make the one number on the screen a lie.
   */
  stats: { saved: number; visited: number; countries: number };
  countries: Array<{ key: string; label: string; code?: string; count: number }>;
  createPlace: (input: NewPlaceInput) => Promise<VisitedPlace>;
  updatePlace: (id: string, changes: PlaceChanges) => Promise<VisitedPlace>;
  /**
   * The already-saved place a new entry would duplicate, or undefined. What
   * turns "add Salt Lake City again" into "log another visit to Salt Lake
   * City" instead of a second pin.
   */
  findExistingPlace: (input: NewPlaceInput) => VisitedPlace | undefined;
  /** Every logged visit, all places. Use getVisits for one place's. */
  visits: PlaceVisit[];
  getVisits: (placeId: string | null | undefined) => PlaceVisit[];
  addVisit: (
    placeId: string,
    input: NewVisitInput,
    options?: { materializeImplicit?: boolean },
  ) => Promise<PlaceVisit>;
  updateVisit: (id: string, changes: VisitChanges) => Promise<PlaceVisit>;
  deleteVisit: (id: string) => Promise<void>;
  /**
   * Removes the visit a place's old-style dates imply — clears the dates and
   * zeroes the sheet's summary columns, since no rows remain to derive from.
   */
  clearImplicitVisit: (placeId: string) => Promise<void>;
  movePlace: (id: string, latitude: number, longitude: number) => Promise<VisitedPlace>;
  /** Removes the place and hands back the record so it can be restored. */
  deletePlace: (id: string) => Promise<VisitedPlace | null>;
  restorePlace: (place: VisitedPlace) => Promise<void>;
  /** Called once an undo window closes, to release the record's photo blobs. */
  discardPlacePhotos: (place: VisitedPlace) => void;
  /** Trips, most recent first. An organising layer over the same places. */
  trips: Trip[];
  getTrip: (id: string | null | undefined) => Trip | undefined;
  createTrip: (input: NewTripInput) => Promise<Trip>;
  updateTrip: (id: string, changes: TripChanges) => Promise<Trip>;
  /**
   * Removes the trip. Every place that belonged to it keeps its place in the
   * history with its trip cell cleared.
   */
  deleteTrip: (id: string) => Promise<void>;
  /**
   * The id a trip ended up with. A trip created offline — or simply faster
   * than the network — carries a temporary id until the sheet assigns one, and
   * anything holding the old value needs this to catch up.
   */
  resolveTripId: (id: string) => string;
  /** Cloud photos: metadata for every imported photo, all contexts. */
  travelPhotos: TravelPhoto[];
  /** What this deployment of the Apps Script can do. */
  capabilities: SheetCapabilities;
  /** A real, sheet-known visit id for photo attachment — materialising the
   * implicit visit when that is what was tapped. */
  ensureRealVisit: (placeId: string, visit: PlaceVisit) => Promise<string>;
  importGooglePhotos: (request: {
    items: GooglePickedMedia[];
    placeId?: string;
    visitId?: string;
    tripId?: string;
  }) => Promise<ImportItemResult[]>;
  removeTravelPhoto: (id: string) => Promise<void>;
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
  const trips = useMemo(() => sortTrips(sync.trips), [sync.trips]);

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

  const findExistingPlace = useCallback(
    (input: NewPlaceInput) => findDuplicatePlace(input, places) ?? undefined,
    [places],
  );

  const addVisit = useCallback(
    async (
      placeId: string,
      input: NewVisitInput,
      options?: { materializeImplicit?: boolean },
    ) => {
      try {
        return await sheetPlaceRepository.addVisit(placeId, input, options);
      } catch (error) {
        throw new Error(friendlyMessage(error, "That visit couldn’t be saved."));
      }
    },
    [],
  );

  const updateVisit = useCallback(async (id: string, changes: VisitChanges) => {
    try {
      return await sheetPlaceRepository.updateVisit(id, changes);
    } catch (error) {
      throw new Error(friendlyMessage(error, "Those changes couldn’t be saved."));
    }
  }, []);

  const deleteVisit = useCallback(async (id: string) => {
    try {
      await sheetPlaceRepository.deleteVisit(id);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That visit couldn’t be removed."));
    }
  }, []);

  const clearImplicitVisit = useCallback(async (placeId: string) => {
    try {
      await sheetPlaceRepository.clearImplicitVisit(placeId);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That visit couldn’t be removed."));
    }
  }, []);

  const createTrip = useCallback(async (input: NewTripInput) => {
    try {
      return await sheetPlaceRepository.createTrip(input);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That trip couldn’t be saved."));
    }
  }, []);

  const updateTrip = useCallback(async (id: string, changes: TripChanges) => {
    try {
      return await sheetPlaceRepository.updateTrip(id, changes);
    } catch (error) {
      throw new Error(friendlyMessage(error, "Those changes couldn’t be saved."));
    }
  }, []);

  const deleteTrip = useCallback(async (id: string) => {
    try {
      await sheetPlaceRepository.deleteTrip(id);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That trip couldn’t be deleted."));
    }
  }, []);

  const resolveTripId = useCallback((id: string) => sheetPlaceRepository.resolveId(id), []);

  const ensureRealVisit = useCallback(async (placeId: string, visit: PlaceVisit) => {
    try {
      return await sheetPlaceRepository.ensureRealVisit(placeId, visit);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That visit couldn’t be prepared for photos."));
    }
  }, []);

  const importGooglePhotos = useCallback(
    async (request: {
      items: GooglePickedMedia[];
      placeId?: string;
      visitId?: string;
      tripId?: string;
    }) => {
      try {
        return await sheetPlaceRepository.importGooglePhotos(request);
      } catch (error) {
        if (error instanceof PersistenceError) throw new Error(error.message);
        throw error;
      }
    },
    [],
  );

  const removeTravelPhoto = useCallback(async (id: string) => {
    try {
      await sheetPlaceRepository.removeTravelPhoto(id);
    } catch (error) {
      throw new Error(friendlyMessage(error, "That photo couldn’t be removed."));
    }
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

  const visitsByPlace = useMemo(() => {
    const map = new Map<string, PlaceVisit[]>();
    for (const visit of sync.visits) {
      const list = map.get(visit.placeId);
      if (list) list.push(visit);
      else map.set(visit.placeId, [visit]);
    }
    return map;
  }, [sync.visits]);

  const NO_PLACE_VISITS = useMemo<PlaceVisit[]>(() => [], []);
  const getVisits = useCallback(
    (placeId: string | null | undefined) =>
      (placeId ? visitsByPlace.get(placeId) : undefined) ?? NO_PLACE_VISITS,
    [visitsByPlace, NO_PLACE_VISITS],
  );

  const tripsById = useMemo(() => {
    const map = new Map<string, Trip>();
    for (const trip of trips) map.set(trip.id, trip);
    return map;
  }, [trips]);

  const getTrip = useCallback(
    (id: string | null | undefined) => (id ? tripsById.get(id) : undefined),
    [tripsById],
  );

  const countries = useMemo(() => {
    const map = new Map<string, { key: string; label: string; code?: string; count: number }>();
    for (const place of places) {
      if (place.wantToGo) continue;
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
    () => ({
      saved: places.length,
      visited: places.filter((place) => !place.wantToGo).length,
      countries: countries.length,
    }),
    [places, countries.length],
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
      findExistingPlace,
      visits: sync.visits,
      getVisits,
      addVisit,
      updateVisit,
      deleteVisit,
      clearImplicitVisit,
      movePlace,
      deletePlace,
      restorePlace,
      discardPlacePhotos,
      trips,
      getTrip,
      createTrip,
      updateTrip,
      deleteTrip,
      resolveTripId,
      travelPhotos: sync.travelPhotos,
      capabilities: sync.capabilities,
      ensureRealVisit,
      importGooglePhotos,
      removeTravelPhoto,
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
      findExistingPlace,
      getVisits,
      addVisit,
      updateVisit,
      deleteVisit,
      clearImplicitVisit,
      movePlace,
      deletePlace,
      restorePlace,
      discardPlacePhotos,
      trips,
      getTrip,
      createTrip,
      updateTrip,
      deleteTrip,
      resolveTripId,
      ensureRealVisit,
      importGooglePhotos,
      removeTravelPhoto,
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
