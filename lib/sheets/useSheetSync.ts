"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { SheetConnection } from "@/lib/sheets/connection";
import {
  INITIAL_STATUS,
  NO_PLACES,
  NO_TRIPS,
  sheetPlaceRepository,
  type SheetStatus,
} from "@/lib/storage/sheetPlaceRepository";
import type { VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * Wires the sheet-backed repository into React.
 *
 * The repository is deliberately not a hook: it owns the write queue, the
 * retry timer and the in-memory collection, none of which can be torn down and
 * rebuilt with a component. React subscribes to it as an external store, which
 * is exactly what it is — the alternative, mirroring it into component state,
 * gives two copies that can disagree.
 */

export type SheetSync = {
  places: VisitedPlace[];
  trips: Trip[];
  state: SheetStatus;
  connection: SheetConnection | null;
  lookups: Record<string, string[]>;
  connect: (connection: SheetConnection) => void;
  disconnect: () => void;
  /** Re-reads the sheet and pushes anything still queued. */
  syncNow: () => void;
};

/** Module-level so the identity is stable; a new function would resubscribe. */
const subscribe = (listener: () => void) => sheetPlaceRepository.subscribe(listener);

const NO_LOOKUPS: Record<string, string[]> = {};

export function useSheetSync(): SheetSync {
  const places = useSyncExternalStore(
    subscribe,
    () => sheetPlaceRepository.getVisible(),
    () => NO_PLACES,
  );
  const trips = useSyncExternalStore(
    subscribe,
    () => sheetPlaceRepository.getVisibleTrips(),
    () => NO_TRIPS,
  );
  const state = useSyncExternalStore(
    subscribe,
    () => sheetPlaceRepository.getStatus(),
    () => INITIAL_STATUS,
  );
  const connection = useSyncExternalStore(
    subscribe,
    () => sheetPlaceRepository.getConnection(),
    () => null,
  );
  const lookups = useSyncExternalStore(
    subscribe,
    () => sheetPlaceRepository.getLookups(),
    () => NO_LOOKUPS,
  );

  /**
   * Reading this browser's saved state, and the sheet, happens here rather
   * than at import time: the module is evaluated during the static build,
   * where there is no localStorage and no reason to fetch anything.
   */
  useEffect(() => {
    sheetPlaceRepository.hydrate();
    void sheetPlaceRepository.load();
  }, []);

  /**
   * A device that went offline mid-edit gets its queue drained the moment it
   * is back, without the person having to think about it.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const retry = () => sheetPlaceRepository.retryNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };

    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const connect = useCallback((next: SheetConnection) => {
    sheetPlaceRepository.connect(next);
    void sheetPlaceRepository.load();
  }, []);

  const disconnect = useCallback(() => {
    sheetPlaceRepository.disconnect();
  }, []);

  const syncNow = useCallback(() => {
    sheetPlaceRepository.retryNow();
    void sheetPlaceRepository.load();
  }, []);

  return { places, trips, state, connection, lookups, connect, disconnect, syncNow };
}
