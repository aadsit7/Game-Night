"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Globe2, Heart, MapPin, Pencil, Trash2 } from "lucide-react";

import { AppTabBar, type AppMode } from "@/components/AppTabBar";
import { GlobeEmptyState, PickModeBanner } from "@/components/globe/GlobeOverlay";
import { GlobeSearch } from "@/components/globe/GlobeSearch";
import { MapViewToggle } from "@/components/globe/MapViewToggle";
import { PlacePreviewSheet } from "@/components/globe/PlacePreviewSheet";
import {
  TravelGlobe,
  type CameraRequest,
  type GlobePoint,
  type TravelGlobeHandle,
} from "@/components/globe/TravelGlobe";
import { AdjustPinBar } from "@/components/place/AdjustPinBar";
import { LocationSearchSheet } from "@/components/place/LocationSearchSheet";
import { PlaceDetailSheet } from "@/components/place/PlaceDetailSheet";
import { PlaceFormSheet } from "@/components/place/PlaceFormSheet";
import { PlacesView } from "@/components/places/PlacesView";
import { SheetSetupScreen } from "@/components/sync/SheetSetupScreen";
import { SyncSettingsSheet } from "@/components/sync/SyncSettingsSheet";
import { TimelineView } from "@/components/timeline/TimelineView";
import { TripDetailSheet } from "@/components/trips/TripDetailSheet";
import {
  TripFormSheet,
  emptyTripDraft,
  isTripDraftDirty,
  type TripDraft,
} from "@/components/trips/TripFormSheet";
import { TripsView } from "@/components/trips/TripsView";
import { ActionSheet } from "@/components/ui/ActionSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast, type ToastMessage } from "@/components/ui/Toast";
import { reverseGeocode } from "@/lib/maps/geocoding";
import type { MapView } from "@/lib/maps/basemap";
import { usePlaces } from "@/lib/store/PlacesProvider";
import {
  applyLocation,
  draftFromPlace,
  draftToInput,
  emptyDraft,
  isDraftDirty,
  type PlaceDraft,
} from "@/lib/store/draft";
import { boundsForPlaces } from "@/lib/utils/geo";
import { createId } from "@/lib/utils/id";
import type { LocationResult, VisitedPlace } from "@/types/place";

/**
 * The one place that knows what is on screen.
 *
 * The globe is mounted once, for the life of the session, and the Places view
 * slides over it — switching modes never tears down the map. Sheets stack:
 * a preview under a detail under a form, with the layer below receding the way
 * iOS presents one card over another.
 */

type Overlay =
  | { kind: "detail"; id: string }
  | { kind: "form"; mode: "create" | "edit" }
  | { kind: "search"; purpose: "create" | "replace" }
  | { kind: "trip"; id: string }
  | { kind: "tripForm"; mode: "create" | "edit"; id?: string };

type PinSession = {
  mode: "create" | "adjust";
  /** Present when correcting an existing place directly from its card. */
  placeId?: string;
  position: GlobePoint | null;
  /** Whether the flow should return to the form afterwards. */
  returnToForm: boolean;
};

const UNDO_WINDOW_MS = 6000;

/**
 * Picks the honest wording for a save that has only reached this device.
 *
 * A save resolves as soon as the change is safe locally — the write to the
 * sheet is queued behind it. Announcing "saved" with the network gone would
 * contradict the status chip and, more to the point, claim something that
 * hasn't happened yet. The queue means nothing is lost either way; the toast
 * just has to say which of the two it is.
 */
function whenOffline(online: string, queued: string): string {
  return typeof navigator !== "undefined" && navigator.onLine === false ? queued : online;
}

export function AppShell() {
  const {
    places,
    status,
    loadError,
    needsSetup,
    getPlace,
    stats,
    countries,
    createPlace,
    updatePlace,
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
    sync,
  } = usePlaces();

  const reduceMotion = useReducedMotion();

  const [mode, setMode] = useState<AppMode>("globe");
  const [mapView, setMapView] = useState<MapView>("cities");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [draft, setDraft] = useState<PlaceDraft>(emptyDraft);
  const [draftBaseline, setDraftBaseline] = useState<PlaceDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [tripDraft, setTripDraft] = useState<TripDraft>(emptyTripDraft);
  const [tripDraftBaseline, setTripDraftBaseline] = useState<TripDraft>(emptyTripDraft);
  const [tripSaving, setTripSaving] = useState(false);
  const [tripFormError, setTripFormError] = useState<string | null>(null);
  const [discardTripPrompt, setDiscardTripPrompt] = useState(false);
  const [confirmDeleteTripId, setConfirmDeleteTripId] = useState<string | null>(null);

  const [pinSession, setPinSession] = useState<PinSession | null>(null);
  const [pinLabel, setPinLabel] = useState<string | null>(null);
  const [pinResolving, setPinResolving] = useState(false);
  const pinResultRef = useRef<LocationResult | null>(null);

  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const [globeStatus, setGlobeStatus] = useState<"loading" | "ready" | "failed">("loading");
  /** Captured when the search sheet opens, to bias results toward the view. */
  const [proximity, setProximity] = useState<[number, number] | undefined>(undefined);
  const [tabBarHeight, setTabBarHeight] = useState(84);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const globeHandle = useRef<TravelGlobeHandle | null>(null);
  const undoTimer = useRef<number | null>(null);
  const pendingDelete = useRef<VisitedPlace | null>(null);

  /**
   * The draft, pointed at a trip that actually exists.
   *
   * A trip created from inside this form exists locally before the sheet has
   * named it, and the draft holds that temporary id. Records and queued writes
   * are re-pointed the moment the create lands; the draft is a copy React owns
   * and cannot be, so it is corrected here instead — otherwise the place would
   * be saved referring to a trip id that only ever existed in this browser.
   */
  const resolvedDraft = useMemo(() => {
    const id = draft.tripId;
    if (!id || trips.some((trip) => trip.id === id)) return draft;
    const resolved = resolveTripId(id);
    return resolved === id ? draft : { ...draft, tripId: resolved };
  }, [draft, trips, resolveTripId]);

  const selectedPlace = getPlace(selectedId);
  const topOverlay = overlays[overlays.length - 1] ?? null;
  const detailOverlay = overlays.find((overlay) => overlay.kind === "detail");
  const detailPlace = getPlace(detailOverlay?.kind === "detail" ? detailOverlay.id : null);
  const tripOverlay = overlays.find((overlay) => overlay.kind === "trip");
  const openTrip = getTrip(tripOverlay?.kind === "trip" ? tripOverlay.id : null);
  const tripFormOverlay = overlays.find((overlay) => overlay.kind === "tripForm");

  /* Measure the tab bar so sheets, toasts and camera padding all agree. */
  useEffect(() => {
    const element = tabBarRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setTabBarHeight(element.offsetHeight));
    observer.observe(element);
    setTabBarHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, []);

  /* Keep the map's attribution control above the tab bar. */
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--map-chrome-bottom",
      `${pinSession ? 128 : tabBarHeight - 8}px`,
    );
  }, [tabBarHeight, pinSession]);

  const showToast = useCallback(
    (text: string, options: { action?: ToastMessage["action"]; tone?: "neutral" | "error" } = {}) => {
      setToast({ id: createId(), text, ...options });
    },
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? UNDO_WINDOW_MS : 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  const flyTo = useCallback((place: VisitedPlace, zoom = 7.5) => {
    setCamera({
      token: Date.now(),
      longitude: place.longitude,
      latitude: place.latitude,
      zoom,
    });
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Overlay stack                                                            */
  /* ---------------------------------------------------------------------- */

  const pushOverlay = useCallback((overlay: Overlay) => {
    setOverlays((current) => [...current, overlay]);
  }, []);

  const popOverlay = useCallback(() => {
    setOverlays((current) => current.slice(0, -1));
  }, []);

  const closeAllOverlays = useCallback(() => setOverlays([]), []);

  /** Reads the camera in an event handler, where refs are fair game. */
  const captureProximity = useCallback(() => {
    const center = globeHandle.current?.getCenter();
    setProximity(center ? [center.longitude, center.latitude] : undefined);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Selecting on the globe                                                   */
  /* ---------------------------------------------------------------------- */

  const handleSelectPin = useCallback(
    (id: string) => {
      const place = getPlace(id);
      if (!place) return;
      setSelectedId(id);
      setPreviewOpen(true);
      flyTo(place, 6.5);
    },
    [getPlace, flyTo],
  );

  /**
   * Tapping a filled country is a request to see inside it: frame that
   * country's places and switch to the pin view, the way a travel map goes
   * from "where in the world" to "where exactly".
   */
  const handleCountryTap = useCallback(
    (code: string) => {
      const inCountry = places.filter(
        (place) => place.countryCode?.toUpperCase() === code.toUpperCase(),
      );
      if (inCountry.length === 0) return;

      setMapView("cities");
      const bounds = boundsForPlaces(inCountry);
      const centre = bounds
        ? {
            longitude: (bounds[0][0] + bounds[1][0]) / 2,
            latitude: (bounds[0][1] + bounds[1][1]) / 2,
          }
        : { longitude: inCountry[0].longitude, latitude: inCountry[0].latitude };

      setCamera({
        token: Date.now(),
        longitude: centre.longitude,
        latitude: centre.latitude,
        zoom: inCountry.length === 1 ? 6.5 : 4.2,
      });
    },
    [places],
  );

  const handleDeselect = useCallback(() => {
    setPreviewOpen(false);
    setSelectedId(null);
  }, []);

  const showOnGlobe = useCallback(
    (id: string) => {
      const place = getPlace(id);
      if (!place) return;
      closeAllOverlays();
      setMode("globe");
      setSelectedId(id);
      setPreviewOpen(true);
      // Let the mode transition settle before starting the flight.
      window.setTimeout(() => flyTo(place, 7.5), reduceMotion ? 0 : 180);
    },
    [getPlace, closeAllOverlays, flyTo, reduceMotion],
  );

  /* ---------------------------------------------------------------------- */
  /* Add & edit                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Starts a new place.
   *
   * `tripId` is how "Add Place" inside a trip pre-selects it, and the trip
   * sheet is left underneath the flow so saving returns there rather than
   * dumping the person back on the globe with the trip closed.
   */
  const startCreate = useCallback(
    (options: { tripId?: string; keepTripOpen?: boolean } = {}) => {
      const fresh = { ...emptyDraft(), tripId: options.tripId ?? "" };
      setDraft(fresh);
      setDraftBaseline(fresh);
      setFormError(null);
      setPreviewOpen(false);
      captureProximity();
      setOverlays((current) => {
        const beneath = options.keepTripOpen
          ? current.filter((overlay) => overlay.kind === "trip")
          : [];
        return [...beneath, { kind: "search", purpose: "create" }];
      });
    },
    [captureProximity],
  );

  const startEdit = useCallback(
    (id: string) => {
      const place = getPlace(id);
      if (!place) return;
      const next = draftFromPlace(place);
      setDraft(next);
      setDraftBaseline(next);
      setFormError(null);
      setOverlays((current) => {
        // Keep whatever is underneath — a detail sheet, and the trip it was
        // opened from — so closing the form returns to it rather than to the
        // globe.
        const base = current.filter(
          (overlay) => overlay.kind === "detail" || overlay.kind === "trip",
        );
        return [...base, { kind: "form", mode: "edit" }];
      });
    },
    [getPlace],
  );

  const openDetail = useCallback((id: string) => {
    setOverlays([{ kind: "detail", id }]);
  }, []);

  /** A place opened from inside a trip, with the trip left open beneath it. */
  const openDetailFromTrip = useCallback((id: string) => {
    setOverlays((current) => [
      ...current.filter((overlay) => overlay.kind === "trip"),
      { kind: "detail", id },
    ]);
  }, []);

  const openTripDetail = useCallback((id: string) => {
    setPreviewOpen(false);
    setOverlays([{ kind: "trip", id }]);
  }, []);

  const handleLocationChosen = useCallback(
    (result: LocationResult) => {
      setDraft((current) => applyLocation(current, result));
      setOverlays((current) => {
        const withoutSearch = current.filter((overlay) => overlay.kind !== "search");
        const hasForm = withoutSearch.some((overlay) => overlay.kind === "form");
        return hasForm
          ? withoutSearch
          : [...withoutSearch, { kind: "form", mode: draft.id ? "edit" : "create" }];
      });
      if (!draft.id) {
        // A brand-new place: baseline becomes the pre-filled draft so simply
        // backing out doesn't count as "unsaved changes".
        setDraftBaseline((current) => applyLocation(current, result));
      }
    },
    [draft.id],
  );

  const saveForm = useCallback(async () => {
    setSaving(true);
    setFormError(null);
    try {
      const input = draftToInput(resolvedDraft);
      if (resolvedDraft.id) {
        const updated = await updatePlace(resolvedDraft.id, input);
        setDraft(resolvedDraft);
        setDraftBaseline(resolvedDraft);
        popOverlay();
        showToast(whenOffline("Changes saved", "Saved here — it’ll sync when you’re back"));
        if (selectedId === updated.id) flyTo(updated, 7.5);
      } else {
        const created = await createPlace(input);
        setDraft(resolvedDraft);
        setDraftBaseline(resolvedDraft);

        // Added from inside a trip: go back to the trip, where the new place
        // has just appeared under its day, rather than to the globe.
        const beneath = overlays.find((overlay) => overlay.kind === "trip");
        if (beneath) {
          setOverlays([beneath]);
          showToast(
            whenOffline(
              `${created.name} added`,
              `${created.name} added — it’ll sync when you’re back`,
            ),
          );
        } else {
          setOverlays([]);
          setMode("globe");
          setSelectedId(created.id);
          setPreviewOpen(true);
          showToast(
            whenOffline(
              `${created.name} added to your globe`,
              `${created.name} added — it’ll sync when you’re back`,
            ),
          );
          window.setTimeout(() => flyTo(created, 7), reduceMotion ? 0 : 220);
        }
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "That couldn’t be saved.");
    } finally {
      setSaving(false);
    }
  }, [
    resolvedDraft,
    overlays,
    updatePlace,
    createPlace,
    popOverlay,
    showToast,
    selectedId,
    flyTo,
    reduceMotion,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Trips                                                                    */
  /* ---------------------------------------------------------------------- */

  const startCreateTrip = useCallback(() => {
    const fresh = emptyTripDraft();
    setTripDraft(fresh);
    setTripDraftBaseline(fresh);
    setTripFormError(null);
    setPreviewOpen(false);
    // Pushed rather than replacing: creating a trip from the middle of adding
    // a place must leave that half-typed place exactly where it was.
    pushOverlay({ kind: "tripForm", mode: "create" });
  }, [pushOverlay]);

  const startEditTrip = useCallback(
    (id: string) => {
      const trip = getTrip(id);
      if (!trip) return;
      const next: TripDraft = {
        id: trip.id,
        name: trip.name,
        startDate: trip.startDate ?? "",
        endDate: trip.endDate ?? "",
        description: trip.description ?? "",
      };
      setTripDraft(next);
      setTripDraftBaseline(next);
      setTripFormError(null);
      pushOverlay({ kind: "tripForm", mode: "edit", id });
    },
    [getTrip, pushOverlay],
  );

  const saveTripForm = useCallback(async () => {
    setTripSaving(true);
    setTripFormError(null);
    try {
      const input = {
        name: tripDraft.name.trim(),
        startDate: tripDraft.startDate || undefined,
        endDate: tripDraft.endDate || undefined,
        description: tripDraft.description.trim() || undefined,
      };

      if (tripDraft.id) {
        const updated = await updateTrip(tripDraft.id, input);
        setTripDraftBaseline(tripDraft);
        popOverlay();
        showToast(whenOffline("Trip saved", "Saved here — it’ll sync when you’re back"));
        return updated;
      }

      const created = await createTrip(input);
      setTripDraftBaseline(tripDraft);
      popOverlay();

      // Created from the place form: select it there. The rest of that form is
      // untouched — it has been sitting underneath this sheet the whole time.
      const fromPlaceForm = overlays.some((overlay) => overlay.kind === "form");
      if (fromPlaceForm) {
        setDraft((current) => ({ ...current, tripId: created.id }));
      } else {
        setOverlays([{ kind: "trip", id: created.id }]);
      }

      showToast(
        whenOffline(`${created.name} created`, `${created.name} created — it’ll sync when you’re back`),
      );
      return created;
    } catch (error) {
      // The draft is deliberately left as it was: a failed save must not cost
      // someone the words they typed.
      setTripFormError(error instanceof Error ? error.message : "That trip couldn’t be saved.");
      return null;
    } finally {
      setTripSaving(false);
    }
  }, [tripDraft, overlays, createTrip, updateTrip, popOverlay, showToast]);

  const guardTripFormClose = useCallback(() => {
    if (!isTripDraftDirty(tripDraft, tripDraftBaseline)) return true;
    setDiscardTripPrompt(true);
    return false;
  }, [tripDraft, tripDraftBaseline]);

  /**
   * Removes a trip and leaves every place it held exactly where it was.
   *
   * The repository clears the trip from each of them; nothing is deleted but
   * the trip row itself, which is the whole promise of the confirmation.
   */
  const performDeleteTrip = useCallback(
    async (id: string) => {
      setConfirmDeleteTripId(null);
      const trip = getTrip(id);
      try {
        await deleteTrip(id);
        setOverlays((current) =>
          current.filter(
            (overlay) =>
              !(overlay.kind === "trip" && overlay.id === id) && overlay.kind !== "tripForm",
          ),
        );
        showToast(
          whenOffline(
            `${trip?.name ?? "Trip"} deleted — your places are still here`,
            `${trip?.name ?? "Trip"} deleted — it’ll sync when you’re back`,
          ),
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : "That trip couldn’t be deleted.", {
          tone: "error",
        });
      }
    },
    [deleteTrip, getTrip, showToast],
  );

  /**
   * Saving a favourite, from wherever it is asked for.
   *
   * One tap and one write — no form, no confirmation. The toast names what
   * happened rather than just "saved", because the heart is small and the
   * change is easy to miss.
   */
  const toggleFavorite = useCallback(
    async (id: string) => {
      const place = getPlace(id);
      if (!place) return;
      const next = !place.favorite;
      try {
        await updatePlace(id, { favorite: next });
        showToast(
          next ? `${place.name} added to favorites` : `${place.name} removed from favorites`,
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : "That couldn’t be saved.", {
          tone: "error",
        });
      }
    },
    [getPlace, updatePlace, showToast],
  );

  /* Only warn when there is genuinely something to lose. */
  const guardFormClose = useCallback(() => {
    if (!isDraftDirty(draft, draftBaseline)) return true;
    setDiscardPrompt(true);
    return false;
  }, [draft, draftBaseline]);

  /* ---------------------------------------------------------------------- */
  /* Pin placement                                                            */
  /* ---------------------------------------------------------------------- */

  const resolvePinLabel = useCallback(async (point: GlobePoint) => {
    setPinResolving(true);
    setPinLabel(null);
    pinResultRef.current = null;
    try {
      const result = await reverseGeocode(point.longitude, point.latitude);
      pinResultRef.current = result;
      setPinLabel(result ? [result.name, result.context].filter(Boolean).join(" · ") : null);
    } catch {
      setPinLabel(null);
    } finally {
      setPinResolving(false);
    }
  }, []);

  const beginPinSession = useCallback(
    (session: PinSession) => {
      setPinSession(session);
      setPreviewOpen(false);
      setMode("globe");
      if (session.position) {
        void resolvePinLabel(session.position);
        setCamera({
          token: Date.now(),
          longitude: session.position.longitude,
          latitude: session.position.latitude,
          zoom: 9,
          duration: 1200,
        });
      } else {
        setPinLabel(null);
      }
    },
    [resolvePinLabel],
  );

  /** Long-press on the globe, or a tap while the picker is waiting for one. */
  const handlePointPicked = useCallback(
    (point: GlobePoint) => {
      if (pinSession) {
        setPinSession({ ...pinSession, position: point });
        void resolvePinLabel(point);
        return;
      }
      const fresh = emptyDraft();
      setDraft(fresh);
      setDraftBaseline(fresh);
      setFormError(null);
      setOverlays([]);
      beginPinSession({ mode: "create", position: point, returnToForm: true });
      void resolvePinLabel(point);
    },
    [pinSession, resolvePinLabel, beginPinSession],
  );

  const handlePickerChange = useCallback(
    (point: GlobePoint, final: boolean) => {
      setPinSession((current) => (current ? { ...current, position: point } : current));
      if (final) void resolvePinLabel(point);
    },
    [resolvePinLabel],
  );

  const cancelPinSession = useCallback(() => {
    const session = pinSession;
    setPinSession(null);
    setPinLabel(null);
    pinResultRef.current = null;
    if (session?.returnToForm && draft.name) {
      setOverlays([{ kind: "form", mode: draft.id ? "edit" : "create" }]);
    } else if (session?.mode === "adjust" && session.placeId) {
      setSelectedId(session.placeId);
      setPreviewOpen(true);
    }
  }, [pinSession, draft.id, draft.name]);

  const commitPinSession = useCallback(async () => {
    const session = pinSession;
    if (!session?.position) return;
    const { longitude, latitude } = session.position;
    const geocoded = pinResultRef.current;

    setPinSession(null);
    setPinLabel(null);
    pinResultRef.current = null;

    // Correcting a saved place writes through immediately — "Save Pin
    // Location" means saved, not "saved if you also remember to hit Save".
    if (session.placeId) {
      try {
        const updated = await movePlace(session.placeId, latitude, longitude);
        // Move the baseline too, so an already-persisted change never trips
        // the unsaved-changes guard on the way out of the form.
        setDraftBaseline((current) => ({ ...current, latitude, longitude }));
        showToast(whenOffline("Pin location saved", "Pin saved here — it’ll sync when you’re back"));

        if (session.returnToForm) {
          setDraft((current) => ({ ...current, latitude, longitude }));
          setOverlays([{ kind: "form", mode: "edit" }]);
        } else {
          setSelectedId(updated.id);
          setPreviewOpen(true);
          flyTo(updated, 9);
        }
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "That pin couldn’t be moved.",
          { tone: "error" },
        );
        if (session.returnToForm) setOverlays([{ kind: "form", mode: "edit" }]);
      }
      return;
    }

    // A new place: fold the position into the draft and return to the form.
    setDraft((current) => {
      const next: PlaceDraft = { ...current, latitude, longitude };
      if (geocoded) {
        return {
          ...next,
          name: current.name.trim() || geocoded.name,
          city: current.city || geocoded.city || "",
          region: current.region || geocoded.region || "",
          country: current.country || geocoded.country || "",
          countryCode: current.countryCode ?? geocoded.countryCode,
          locationLabel: geocoded.context || geocoded.name,
        };
      }
      return {
        ...next,
        locationLabel: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
      };
    });

    setOverlays([{ kind: "form", mode: "create" }]);
  }, [pinSession, movePlace, flyTo, showToast]);

  /* ---------------------------------------------------------------------- */
  /* Delete & undo                                                            */
  /* ---------------------------------------------------------------------- */

  const performDelete = useCallback(
    async (id: string) => {
      setConfirmDeleteId(null);
      closeAllOverlays();
      setPreviewOpen(false);
      setSelectedId(null);

      try {
        const removed = await deletePlace(id);
        if (!removed) return;

        // Hold the record — and its photos — for the length of the undo window.
        if (undoTimer.current) window.clearTimeout(undoTimer.current);
        const previous = pendingDelete.current;
        if (previous) discardPlacePhotos(previous);
        pendingDelete.current = removed;

        undoTimer.current = window.setTimeout(() => {
          if (pendingDelete.current) discardPlacePhotos(pendingDelete.current);
          pendingDelete.current = null;
          undoTimer.current = null;
        }, UNDO_WINDOW_MS);

        showToast("Place deleted", {
          action: {
            label: "Undo",
            onPress: () => {
              if (undoTimer.current) window.clearTimeout(undoTimer.current);
              undoTimer.current = null;
              const record = pendingDelete.current;
              pendingDelete.current = null;
              if (!record) return;
              void restorePlace(record)
                .then(() => {
                  setSelectedId(record.id);
                  setPreviewOpen(true);
                  setMode("globe");
                })
                .catch((error: Error) => showToast(error.message, { tone: "error" }));
            },
          },
        });
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "That place couldn’t be deleted.",
          { tone: "error" },
        );
      }
    },
    [deletePlace, restorePlace, discardPlacePhotos, showToast, closeAllOverlays],
  );

  /* ---------------------------------------------------------------------- */
  /* Derived layout values                                                    */
  /* ---------------------------------------------------------------------- */

  const previewVisible =
    mode === "globe" && previewOpen && Boolean(selectedPlace) && !pinSession && overlays.length === 0;

  const bottomInset = useMemo(() => {
    if (pinSession) return 220;
    if (previewVisible) return tabBarHeight + 190;
    return tabBarHeight;
  }, [pinSession, previewVisible, tabBarHeight]);

  const tabBarHidden = Boolean(pinSession);
  const actionsPlace = getPlace(actionsFor);
  const confirmPlace = getPlace(confirmDeleteId);
  const searchOverlay = topOverlay?.kind === "search" ? topOverlay : null;
  const formOverlay = overlays.find((overlay) => overlay.kind === "form");

  // Everything below reads from the sheet, so on a browser that hasn't been
  // told where the sheet is there is nothing honest to draw yet. Placed after
  // every hook above so the hook order never changes between renders.
  if (needsSetup) {
    return <SheetSetupScreen onConnected={sync.connect} />;
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg">
      {/* The globe is mounted for the whole session and never torn down. */}
      <div className="absolute inset-0">
        <TravelGlobe
          places={places}
          dataReady={status !== "loading"}
          selectedId={selectedId}
          onSelect={handleSelectPin}
          onDeselect={handleDeselect}
          onPointPicked={handlePointPicked}
          pickMode={Boolean(pinSession)}
          pickerPosition={pinSession?.position ?? null}
          onPickerChange={handlePickerChange}
          mapView={mapView}
          onCountryTap={handleCountryTap}
          cameraRequest={camera}
          bottomInset={bottomInset}
          onStatusChange={setGlobeStatus}
          handleRef={globeHandle}
        />
      </div>

      <GlobeSearch
        places={places}
        // Searching saved places is local, so this stays available even when
        // the map itself can't load.
        visible={mode === "globe" && !pinSession && overlays.length === 0 && !loadError}
        onSelect={showOnGlobe}
        onOpenSettings={() => setSyncOpen(true)}
      />

      {loadError ? (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-4"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 10px)" }}
        >
          <p className="glass mt-2 max-w-[440px] rounded-[18px] border border-glass-border px-4 py-3 text-center text-[14px] leading-relaxed text-ink shadow-soft">
            {loadError}
          </p>
        </div>
      ) : null}

      <GlobeEmptyState
        visible={
          mode === "globe" &&
          status === "ready" &&
          globeStatus !== "failed" &&
          places.length === 0 &&
          !pinSession &&
          overlays.length === 0
        }
        onAdd={() => startCreate()}
        bottomOffset={tabBarHeight + 12}
      />

      <PickModeBanner
        visible={Boolean(pinSession)}
        title={pinSession?.mode === "adjust" ? "Move the pin" : "Choose the spot"}
        message="Drag the pin, or tap anywhere on the map"
        onCancel={cancelPinSession}
      />

      {/* Places slides over the globe rather than replacing it. */}
      <AnimatePresence>
        {mode === "places" ? (
          <motion.div
            key="places"
            className="absolute inset-0 z-20"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] }
            }
          >
            <PlacesView
              places={places}
              countries={countries}
              stats={stats}
              loading={status === "loading"}
              bottomInset={tabBarHeight + 16}
              onOpenPlace={openDetail}
              onPlaceActions={setActionsFor}
              onAdd={() => startCreate()}
              onShowGlobe={() => setMode("globe")}
              syncState={sync.state}
              onOpenSync={() => setSyncOpen(true)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The timeline slides over the globe the same way Places does. */}
      <AnimatePresence>
        {mode === "timeline" ? (
          <motion.div
            key="timeline"
            className="absolute inset-0 z-20"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] }
            }
          >
            <TimelineView
              places={places}
              trips={trips}
              loading={status === "loading"}
              bottomInset={tabBarHeight + 16}
              onOpenPlace={openDetail}
              onOpenTrip={openTripDetail}
              onAdd={() => startCreate()}
              onShowGlobe={() => setMode("globe")}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Trips slides over the globe the same way Places and Timeline do. */}
      <AnimatePresence>
        {mode === "trips" ? (
          <motion.div
            key="trips"
            className="absolute inset-0 z-20"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] }
            }
          >
            <TripsView
              trips={trips}
              places={places}
              loading={status === "loading"}
              bottomInset={tabBarHeight + 16}
              onOpenTrip={openTripDetail}
              onCreateTrip={startCreateTrip}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <MapViewToggle
        value={mapView}
        onChange={setMapView}
        visible={
          mode === "globe" &&
          globeStatus !== "failed" &&
          !pinSession &&
          overlays.length === 0 &&
          places.length > 0
        }
        bottomOffset={tabBarHeight + (previewVisible ? 176 : 8)}
      />

      <AppTabBar
        ref={tabBarRef}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          if (next !== "globe") setPreviewOpen(false);
        }}
        onAdd={() => startCreate()}
        hidden={tabBarHidden}
      />

      <PlacePreviewSheet
        place={selectedPlace ?? null}
        open={previewVisible}
        onClose={handleDeselect}
        onViewDetails={() => selectedId && openDetail(selectedId)}
        onEdit={() => selectedId && startEdit(selectedId)}
        bottomOffset={tabBarHeight + 6}
      />

      <PlaceDetailSheet
        place={detailPlace ?? null}
        open={Boolean(detailOverlay)}
        recessed={topOverlay?.kind !== "detail"}
        trip={getTrip(detailPlace?.tripId) ?? null}
        onOpenTrip={() => detailPlace?.tripId && openTripDetail(detailPlace.tripId)}
        onToggleFavorite={() => detailPlace && void toggleFavorite(detailPlace.id)}
        // Closing a place opened from a trip returns to the trip; opened on
        // its own, it closes the stack.
        onClose={() => (overlays.length > 1 ? popOverlay() : closeAllOverlays())}
        onEdit={() => detailOverlay?.kind === "detail" && startEdit(detailOverlay.id)}
        onShowOnGlobe={() =>
          detailOverlay?.kind === "detail" && showOnGlobe(detailOverlay.id)
        }
        onDelete={() =>
          detailOverlay?.kind === "detail" && setConfirmDeleteId(detailOverlay.id)
        }
      />

      <PlaceFormSheet
        open={Boolean(formOverlay)}
        mode={formOverlay?.kind === "form" ? formOverlay.mode : "create"}
        recessed={topOverlay?.kind !== "form"}
        draft={resolvedDraft}
        onChange={setDraft}
        onSave={() => void saveForm()}
        onClose={popOverlay}
        onRequestClose={guardFormClose}
        onChangeLocation={() => {
          captureProximity();
          pushOverlay({ kind: "search", purpose: "replace" });
        }}
        onAdjustPin={() =>
          beginPinSession({
            mode: draft.id ? "adjust" : "create",
            placeId: draft.id,
            position:
              draft.latitude !== null && draft.longitude !== null
                ? { longitude: draft.longitude, latitude: draft.latitude }
                : null,
            returnToForm: true,
          })
        }
        onDelete={draft.id ? () => setConfirmDeleteId(draft.id ?? null) : undefined}
        saving={saving}
        error={formError}
        trips={trips}
        onCreateTrip={startCreateTrip}
      />

      <TripDetailSheet
        trip={openTrip ?? null}
        places={places}
        open={Boolean(tripOverlay)}
        recessed={topOverlay?.kind !== "trip"}
        onClose={closeAllOverlays}
        onEdit={() => tripOverlay?.kind === "trip" && startEditTrip(tripOverlay.id)}
        onOpenPlace={openDetailFromTrip}
        onAddPlace={() =>
          tripOverlay?.kind === "trip" &&
          startCreate({ tripId: tripOverlay.id, keepTripOpen: true })
        }
      />

      <TripFormSheet
        open={Boolean(tripFormOverlay)}
        mode={tripFormOverlay?.kind === "tripForm" ? tripFormOverlay.mode : "create"}
        recessed={topOverlay?.kind !== "tripForm"}
        draft={tripDraft}
        onChange={setTripDraft}
        onSave={() => void saveTripForm()}
        onClose={popOverlay}
        onRequestClose={guardTripFormClose}
        onDelete={tripDraft.id ? () => setConfirmDeleteTripId(tripDraft.id ?? null) : undefined}
        saving={tripSaving}
        error={tripFormError}
      />

      <LocationSearchSheet
        open={Boolean(searchOverlay)}
        title={searchOverlay?.purpose === "replace" ? "Change Location" : "Add a Place"}
        proximity={proximity}
        onClose={popOverlay}
        onSelect={handleLocationChosen}
        // With no map to drop a pin on, the same row becomes manual entry —
        // adding a place must never be a dead end.
        mapAvailable={globeStatus !== "failed"}
        onManualEntry={() =>
          setOverlays((current) => {
            const withoutSearch = current.filter((overlay) => overlay.kind !== "search");
            return withoutSearch.some((overlay) => overlay.kind === "form")
              ? withoutSearch
              : [...withoutSearch, { kind: "form", mode: draft.id ? "edit" : "create" }];
          })
        }
        onPickOnGlobe={() => {
          setOverlays((current) => current.filter((overlay) => overlay.kind !== "search"));
          beginPinSession({
            mode: draft.id ? "adjust" : "create",
            placeId: draft.id,
            position:
              draft.latitude !== null && draft.longitude !== null
                ? { longitude: draft.longitude, latitude: draft.latitude }
                : (globeHandle.current?.getCenter() ?? null),
            returnToForm: true,
          });
        }}
      />

      <AdjustPinBar
        open={Boolean(pinSession)}
        mode={pinSession?.mode ?? "create"}
        latitude={pinSession?.position?.latitude ?? null}
        longitude={pinSession?.position?.longitude ?? null}
        label={pinLabel}
        resolving={pinResolving}
        onCancel={cancelPinSession}
        onSave={() => void commitPinSession()}
      />

      <ActionSheet
        open={Boolean(actionsFor)}
        onClose={() => setActionsFor(null)}
        title={actionsPlace?.name}
        actions={[
          {
            label: actionsPlace?.favorite ? "Remove from Favorites" : "Add to Favorites",
            icon: (
              <Heart size={18} fill={actionsPlace?.favorite ? "currentColor" : "none"} />
            ),
            onSelect: () => actionsFor && void toggleFavorite(actionsFor),
          },
          {
            label: "Show on Globe",
            icon: <Globe2 size={18} />,
            onSelect: () => actionsFor && showOnGlobe(actionsFor),
          },
          {
            label: "Edit",
            icon: <Pencil size={18} />,
            onSelect: () => actionsFor && startEdit(actionsFor),
          },
          {
            label: "Adjust Pin",
            icon: <MapPin size={18} />,
            onSelect: () => {
              if (!actionsPlace) return;
              beginPinSession({
                mode: "adjust",
                placeId: actionsPlace.id,
                position: {
                  longitude: actionsPlace.longitude,
                  latitude: actionsPlace.latitude,
                },
                returnToForm: false,
              });
            },
          },
          {
            label: "Delete Place",
            icon: <Trash2 size={18} />,
            destructive: true,
            onSelect: () => setConfirmDeleteId(actionsFor),
          },
        ]}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="Delete this place?"
        message={
          confirmPlace
            ? `${confirmPlace.name} will be removed from your travel history.`
            : "This will remove it from your travel history."
        }
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && void performDelete(confirmDeleteId)}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteTripId)}
        title={`Delete “${getTrip(confirmDeleteTripId)?.name ?? "this trip"}”?`}
        message="The trip will be deleted, but your visited places will remain in your travel history."
        confirmLabel="Delete Trip"
        onCancel={() => setConfirmDeleteTripId(null)}
        onConfirm={() => confirmDeleteTripId && void performDeleteTrip(confirmDeleteTripId)}
      />

      <ConfirmDialog
        open={discardTripPrompt}
        title="Discard changes?"
        message="Your edits to this trip won’t be saved."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onCancel={() => setDiscardTripPrompt(false)}
        onConfirm={() => {
          setDiscardTripPrompt(false);
          setTripDraft(tripDraftBaseline);
          popOverlay();
        }}
      />

      <ConfirmDialog
        open={discardPrompt}
        title="Discard changes?"
        message="Your edits to this place won’t be saved."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onCancel={() => setDiscardPrompt(false)}
        onConfirm={() => {
          setDiscardPrompt(false);
          setDraft(draftBaseline);
          popOverlay();
        }}
      />

      <SyncSettingsSheet
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        connection={sync.connection}
        state={sync.state}
        onConnect={sync.connect}
        onDisconnect={sync.disconnect}
        onSyncNow={sync.syncNow}
      />

      <Toast
        toast={toast}
        onDismiss={() => setToast(null)}
        placement={overlays.length > 0 ? "top" : "bottom"}
        bottomOffset={(tabBarHidden ? 148 : tabBarHeight) + 8}
      />
    </main>
  );
}
