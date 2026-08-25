"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FolderOpen, Globe2, Heart, Images, MapPin, Pencil, Trash2 } from "lucide-react";

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
import {
  DeviceMediaIntake,
  type DeviceMediaIntakeHandle,
  type DeviceMediaTarget,
} from "@/components/photos/DeviceMediaIntake";
import { GooglePhotosFlowSheet } from "@/components/photos/GooglePhotosReviewSheet";
import { MediaCodeSheet } from "@/components/photos/MediaCodeSheet";
import { PlayerView } from "@/components/photos/PlayerView";
import { InsightDrillSheet } from "@/components/insights/InsightDrillSheet";
import { InsightsView } from "@/components/insights/InsightsView";
import { TravelMediaPlayer } from "@/components/photos/TravelMediaPlayer";
import { AdjustPinBar } from "@/components/place/AdjustPinBar";
import { LocationSearchSheet } from "@/components/place/LocationSearchSheet";
import { PlaceDetailSheet } from "@/components/place/PlaceDetailSheet";
import { PlaceFormSheet } from "@/components/place/PlaceFormSheet";
import {
  VisitFormSheet,
  emptyVisitDraft,
  type VisitDraft,
} from "@/components/place/VisitFormSheet";
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
import { useHistorySentinel } from "@/lib/hooks/useHistorySentinel";
import { makeCoverPhoto, removePlacePhoto } from "@/lib/places/photoEdits";
import { type InsightScope } from "@/lib/insights/insights";
import { startAutoLinkSweep } from "@/lib/maps/autoLinkSweep";
import { reverseGeocode } from "@/lib/maps/geocoding";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import { LocationError, currentLocation, type Fix } from "@/lib/maps/geolocation";
import type { MapView } from "@/lib/maps/basemap";
import { usePlaces } from "@/lib/store/PlacesProvider";
import {
  applyLocation,
  draftFromPlace,
  draftToInput,
  emptyDraft,
  isDraftDirty,
  withTrip,
  type PlaceDraft,
} from "@/lib/store/draft";
import {
  VISIT_STATUS_LIVED,
  isImplicitVisitId,
  isPlannedStatus,
  isResidenceStatus,
  visitStatusFor,
  visitsForPlace,
} from "@/lib/places/visits";
import {
  formatMediaCounts,
  mediaCounts,
  playlistForPlace,
  playlistForTrip,
} from "@/lib/photos/mediaPlaylist";
import { closePickerWindow, openPickerWindow } from "@/lib/photos/pickerWindow";
import { formatVisitRange } from "@/lib/utils/date";
import { alreadyTaggedMessage, placesToRetag, tagSummary } from "@/lib/trips/tagging";
import { sheetDepth } from "@/lib/ui/sheetStack";
import { hasValidCoordinates } from "@/lib/utils/geo";
import { createId } from "@/lib/utils/id";
import type {
  LocationResult,
  NewPlaceInput,
  NewVisitInput,
  PlaceChanges,
  PlaceVisit,
  VisitChanges,
  VisitedPlace,
} from "@/types/place";
import type { Trip } from "@/types/trip";
import type { PhotoContext, TravelPhoto } from "@/types/travelPhoto";

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
  | { kind: "tripForm"; mode: "create" | "edit"; id?: string }
  /** Logging or editing one stay; `visitId` may name the implicit visit. */
  | { kind: "visitForm"; placeId: string; visitId?: string }
  /** The Google Photos picking flow; its context lives in `photoContext`. */
  | { kind: "photoFlow" }
  /** The Stats tab's drill: the places behind one row or matrix cell. */
  | { kind: "insight"; scope: InsightScope; label: string };

type PinSession = {
  mode: "create" | "adjust";
  /** Present when correcting an existing place directly from its card. */
  placeId?: string;
  position: GlobePoint | null;
  /** Whether the flow should return to the form afterwards. */
  returnToForm: boolean;
};

/**
 * One run of the memories player, snapshotted at the tap that started it.
 * A snapshot rather than a live selection, so a background sync mid-show
 * can never renumber the playlist out from under the item on screen.
 */
type PlayerSession = {
  title: string;
  subtitle?: string;
  completionLabel: string;
  photos: TravelPhoto[];
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

/*
 * The tab views and the globe re-render only when something they draw
 * changed. The shell above them re-renders for every toast, sheet and
 * sweep tick, and with a couple of hundred places the list behind an open
 * card was paying for each one. Memoised here, with every callback below
 * held stable, that work simply stops happening.
 */
const TravelGlobeM = memo(TravelGlobe);
const PlacesViewM = memo(PlacesView);
const TimelineViewM = memo(TimelineView);
const TripsViewM = memo(TripsView);
const PlayerViewM = memo(PlayerView);
const InsightsViewM = memo(InsightsView);

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
    findExistingPlace,
    visits,
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
    travelPhotos,
    capabilities,
    ensureRealVisit,
    removeTravelPhoto,
    sync,
  } = usePlaces();

  const reduceMotion = useReducedMotion();

  const [mode, setMode] = useState<AppMode>("globe");
  /* The tab highlight answers the tap on the spot; the heavy view behind it
     mounts in a deferred render React can slice and interleave, so switching
     onto two hundred place cards no longer stutters the press itself. */
  const deferredMode = useDeferredValue(mode);
  /* Read by callbacks that outlive the render they were made in — the undo in
     a toast is pressed up to six seconds later, by which time the tab it was
     raised from may not be the tab in front of anyone. */
  const modeRef = useRef<AppMode>("globe");
  const [mapView, setMapView] = useState<MapView>("places");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [selectingPlaces, setSelectingPlaces] = useState(false);
  const [tagging, setTagging] = useState(false);
  /** Places waiting on a trip that is still being typed into the form. */
  const tagAfterCreate = useRef<string[] | null>(null);
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

  const [visitDraft, setVisitDraft] = useState<VisitDraft>(emptyVisitDraft);
  const [visitDraftBaseline, setVisitDraftBaseline] = useState<VisitDraft>(emptyVisitDraft);
  const [discardVisitPrompt, setDiscardVisitPrompt] = useState(false);
  const [visitSaving, setVisitSaving] = useState(false);
  const [visitError, setVisitError] = useState<string | null>(null);

  /** What the open photo flow is attaching to — visit, residence or trip. */
  const [photoContext, setPhotoContext] = useState<PhotoContext | null>(null);
  const [mediaCodeOpen, setMediaCodeOpen] = useState(false);
  /** The memories player, when one is up — a place's show or a whole trip's. */
  const [playerSession, setPlayerSession] = useState<PlayerSession | null>(null);
  /** Bumped when the media code is saved, so failed galleries retry clean. */
  const [galleryEpoch, setGalleryEpoch] = useState(0);
  const [confirmDeleteVisit, setConfirmDeleteVisit] = useState<{
    placeId: string;
    visitId: string;
  } | null>(null);
  const [discardTripPrompt, setDiscardTripPrompt] = useState(false);
  const [confirmDeleteTripId, setConfirmDeleteTripId] = useState<string | null>(null);

  const [pinSession, setPinSession] = useState<PinSession | null>(null);
  const [pinLabel, setPinLabel] = useState<string | null>(null);
  const [pinResolving, setPinResolving] = useState(false);
  const pinResultRef = useRef<LocationResult | null>(null);

  const [myLocation, setMyLocation] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  /**
   * A refusal is permanent until someone changes it in browser settings, so
   * asking again on the next pin would be a prompt that can only fail. The
   * button stays, because that is a deliberate request rather than a guess.
   */
  const locationRefused = useRef(false);

  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const [globeStatus, setGlobeStatus] = useState<"loading" | "ready" | "failed">("loading");
  /** Captured when the search sheet opens, to bias results toward the view. */
  const [proximity, setProximity] = useState<[number, number] | undefined>(undefined);
  const [tabBarHeight, setTabBarHeight] = useState(84);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const globeHandle = useRef<TravelGlobeHandle | null>(null);
  const undoTimer = useRef<number | null>(null);
  /* Everything the last delete removed, held whole for the length of the undo
     window. A list rather than one record, because a selection is deleted in
     one go and has to come back in one go. */
  const pendingDelete = useRef<VisitedPlace[]>([]);

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
  const insightOverlay = overlays.find(
    (overlay): overlay is Extract<Overlay, { kind: "insight" }> => overlay.kind === "insight",
  );
  const openTrip = getTrip(tripOverlay?.kind === "trip" ? tripOverlay.id : null);
  const tripFormOverlay = overlays.find((overlay) => overlay.kind === "tripForm");
  const visitFormOverlay = overlays.find((overlay) => overlay.kind === "visitForm");

  /** The stays the open card shows: real rows, or the one the dates imply. */
  const detailVisits = useMemo(
    () => (detailPlace ? visitsForPlace(detailPlace, getVisits(detailPlace.id)) : []),
    [detailPlace, getVisits],
  );

  /**
   * How far back in the stack a sheet sits — 0 for the one in front.
   *
   * The sheets are rendered in a fixed order below, but the order they are
   * *stacked* in is whatever the user did: opening a place from a trip has to
   * put the place in front, and opening a trip from a place the other way
   * round. Layering therefore has to be read off this array, never off the
   * order the JSX happens to be written in.
   */
  const depthOf = useCallback(
    (kind: Overlay["kind"]) => sheetDepth(overlays, kind),
    [overlays],
  );

  /**
   * What the place sheet returns to when it is closed, when that is somewhere
   * rather than nowhere. Closing already goes back to the trip; naming it in
   * the header is what makes that predictable instead of a guess.
   */
  const detailBackTo = (() => {
    const index = overlays.findIndex((overlay) => overlay.kind === "detail");
    if (index <= 0) return undefined;
    const beneath = overlays[index - 1];
    if (beneath.kind === "trip") return getTrip(beneath.id)?.name ?? "Trip";
    if (beneath.kind === "insight") return beneath.label;
    return undefined;
  })();

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

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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

      setMapView("places");
      /* Hand the globe the places rather than a zoom. "Show me inside Japan"
         and "show me inside Luxembourg" are the same request and nothing like
         the same camera, and the globe is the only thing here that knows how
         far back its own projection has to be to hold them all. */
      const framed = inCountry.filter(hasValidCoordinates);
      if (framed.length === 0) return;

      setCamera({
        token: Date.now(),
        longitude: framed[0].longitude,
        latitude: framed[0].latitude,
        fit: framed.map((place) => ({
          longitude: place.longitude,
          latitude: place.latitude,
        })),
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
      // Adding from inside a trip dates the place to the trip's first day, so
      // it lands on Day 1 rather than in the undated footnote at the bottom.
      const fresh = options.tripId
        ? withTrip(emptyDraft(), options.tripId, getTrip(options.tripId))
        : emptyDraft();
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
    [captureProximity, getTrip],
  );

  /* One identity per intent, so the memoised views can skip re-renders. */
  const startCreateBlank = useCallback(() => startCreate(), [startCreate]);
  const showGlobeTab = useCallback(() => setMode("globe"), []);
  const browsePlacesTab = useCallback(() => setMode("places"), []);
  const openSyncSheet = useCallback(() => setSyncOpen(true), []);
  const openMediaCodeSheet = useCallback(() => setMediaCodeOpen(true), []);

  /**
   * The big search found somewhere new. Skip the middle step: fresh draft,
   * location applied, form open — the same landing the two-step flow reaches,
   * minus the flow.
   */
  const addFromGlobeSearch = useCallback((result: LocationResult) => {
    const fresh = applyLocation(emptyDraft(), result);
    setDraft(fresh);
    setDraftBaseline(fresh);
    setFormError(null);
    setPreviewOpen(false);
    setOverlays([{ kind: "form", mode: "create" }]);
  }, []);

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

  /** A Stats row or matrix cell, opened as the places behind the number. */
  const openInsightDrill = useCallback((scope: InsightScope, label: string) => {
    setOverlays([{ kind: "insight", scope, label }]);
  }, []);

  /** A place opened from a drill, with the drill left open beneath it. */
  const openDetailFromInsight = useCallback((id: string) => {
    setOverlays((current) => [
      ...current.filter((overlay) => overlay.kind === "insight"),
      { kind: "detail", id },
    ]);
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

  /**
   * Photo edits made from the viewer, where the photo is. Both go through
   * the same save as the form, so the sheet's cells and any uploaded copies
   * follow along exactly as an edit would move them.
   */
  const handleDeletePlacePhoto = useCallback(
    (placeId: string, ref: string) => {
      const place = getPlace(placeId);
      if (!place) return;
      const changes = removePlacePhoto(place, ref);
      if (!changes) return;
      updatePlace(placeId, changes)
        .then(() => showToast(whenOffline("Photo deleted", "Deleted here — it’ll sync when you’re back")))
        .catch((error) =>
          showToast(error instanceof Error ? error.message : "That photo couldn’t be deleted.", {
            tone: "error",
          }),
        );
    },
    [getPlace, updatePlace, showToast],
  );

  const handleMakeCoverPhoto = useCallback(
    (placeId: string, ref: string) => {
      const place = getPlace(placeId);
      if (!place) return;
      const changes = makeCoverPhoto(place, ref);
      if (!changes) return;
      updatePlace(placeId, changes)
        .then(() => showToast("Cover photo updated"))
        .catch((error) =>
          showToast(error instanceof Error ? error.message : "That couldn’t be made the cover.", {
            tone: "error",
          }),
        );
    },
    [getPlace, updatePlace, showToast],
  );

  /**
   * The card found this place's Google listing; keep it. One cell in the
   * sheet, and every future open is a lookup instead of a hunt. A failed
   * write is silent — the card already has what it needs for this session,
   * and the next open simply searches again.
   */
  const handleLinkGoogle = useCallback(
    (placeId: string, googlePlaceId: string) => {
      updatePlace(placeId, { googlePlaceId }).catch(() => undefined);
    },
    [updatePlace],
  );

  /* The back catalogue links itself: one quiet search every few seconds
     while the app is open, through the same confident-match path a card
     open uses. Places reads are live, so new saves simply join the queue. */
  useEffect(
    () =>
      startAutoLinkSweep({
        getPlaces: () => sheetPlaceRepository.getVisible(),
        onLinked: handleLinkGoogle,
      }),
    [handleLinkGoogle],
  );

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

  /**
   * Videos picked inside the place form. A saved place takes them straight
   * into its memories; a place still being typed holds them until Save, when
   * the new record exists to attach to. Cancelling the form lets them go —
   * the note under the picker says as much as it counts them.
   */
  const pendingFormVideos = useRef<File[]>([]);
  const [pendingFormVideoCount, setPendingFormVideoCount] = useState(0);

  const flushFormVideos = useCallback((placeId: string, title: string) => {
    const files = pendingFormVideos.current;
    pendingFormVideos.current = [];
    setPendingFormVideoCount(0);
    if (files.length === 0) return;
    deviceIntake.current?.addFiles(
      { title, resolve: async () => ({ placeId }) },
      files,
    );
  }, []);

  const handleFormVideos = useCallback(
    (files: File[]) => {
      const id = resolvedDraft.id;
      if (id) {
        deviceIntake.current?.addFiles(
          {
            title: resolvedDraft.name.trim() || "This place",
            resolve: async () => ({ placeId: id }),
          },
          files,
        );
        return;
      }
      pendingFormVideos.current = [...pendingFormVideos.current, ...files];
      setPendingFormVideoCount(pendingFormVideos.current.length);
    },
    [resolvedDraft.id, resolvedDraft.name],
  );

  /* Videos held for a save that never came go with the closed form. */
  const formIsOpen = overlays.some((overlay) => overlay.kind === "form");
  useEffect(() => {
    if (!formIsOpen && pendingFormVideos.current.length > 0) {
      pendingFormVideos.current = [];
      setPendingFormVideoCount(0);
    }
  }, [formIsOpen]);

  /**
   * The already-been-here save: no second pin, the existing record grows.
   *
   * The dates become another visit, anything the form carried that the record
   * lacked — notes, photos, a favourite mark — is kept rather than thrown
   * away, and the card opens on the place so the new visit is right there in
   * the list. Adding a visit to a wishlist entry is the moment it stops being
   * a wish, and the repository flips that flag as part of the same save.
   */
  const mergeIntoExisting = useCallback(
    async (existing: VisitedPlace, input: NewPlaceInput) => {
      const additions: PlaceChanges = {};
      if (input.notes && !existing.notes) additions.notes = input.notes;
      if (input.favorite && !existing.favorite) additions.favorite = true;

      const incoming = [input.coverImage, ...(input.photos ?? [])].filter(
        (photo): photo is string => Boolean(photo),
      );
      if (incoming.length > 0) {
        const have = new Set([existing.coverImage, ...(existing.photos ?? [])]);
        const extra = incoming.filter((photo) => !have.has(photo));
        if (extra.length > 0) {
          if (!existing.coverImage) {
            additions.coverImage = extra[0];
            if (extra.length > 1) {
              additions.photos = [...(existing.photos ?? []), ...extra.slice(1)];
            }
          } else {
            additions.photos = [...(existing.photos ?? []), ...extra];
          }
        }
      }
      // Adding from inside a trip must actually put the place in the trip —
      // the trip screen lists members by the place's own trip cell. A trip
      // the place already belongs to is never overwritten.
      if (input.tripId && !existing.tripId) additions.tripId = input.tripId;
      // A record saved before Google answered for it gains its listing id the
      // next time the same place is added from a Google result.
      if (input.googlePlaceId && !existing.googlePlaceId) {
        additions.googlePlaceId = input.googlePlaceId;
      }

      if (Object.keys(additions).length > 0) await updatePlace(existing.id, additions);

      let message: string;
      if (!input.wantToGo && input.visitedFrom) {
        await addVisit(existing.id, {
          startDate: input.visitedFrom,
          endDate: input.visitedTo,
          tripId: input.tripId,
        });
        // A wishlist entry gaining its first dates is an arrival, not a repeat.
        message = existing.wantToGo
          ? `${existing.name} visited — moved off your wishlist`
          : `Added another visit to ${existing.name}`;
      } else if (!input.wantToGo && existing.wantToGo) {
        await updatePlace(existing.id, { wantToGo: false });
        message = `${existing.name} moved off your wishlist`;
      } else {
        message = `${existing.name} is already on your globe`;
      }

      // Videos the form was holding belong to this existing place now.
      flushFormVideos(existing.id, existing.name);

      setDraft(resolvedDraft);
      setDraftBaseline(resolvedDraft);
      // The card is the proof: open it where the visit just appeared.
      setOverlays((current) => [
        ...current.filter((overlay) => overlay.kind === "trip"),
        { kind: "detail", id: existing.id },
      ]);
      showToast(whenOffline(message, `${message} — it’ll sync when you’re back`));
    },
    [updatePlace, addVisit, showToast, resolvedDraft, flushFormVideos],
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
        // Somewhere already saved doesn't get a twin — it gets another visit.
        const existing = findExistingPlace(input);
        if (existing) {
          await mergeIntoExisting(existing, input);
          return;
        }

        const created = await createPlace(input);
        // The place exists now; videos the form was holding go to it.
        flushFormVideos(created.id, created.name);
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
    findExistingPlace,
    mergeIntoExisting,
    popOverlay,
    showToast,
    selectedId,
    flyTo,
    reduceMotion,
    flushFormVideos,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Visits                                                                   */
  /* ---------------------------------------------------------------------- */

  const startAddVisit = useCallback((placeId: string) => {
    const fresh = emptyVisitDraft();
    setVisitDraft(fresh);
    setVisitDraftBaseline(fresh);
    setVisitError(null);
    setOverlays((current) => [...current, { kind: "visitForm", placeId }]);
  }, []);

  const startEditVisit = useCallback((placeId: string, visit: PlaceVisit) => {
    const fresh: VisitDraft = {
      startDate: visit.startDate ?? "",
      endDate: visit.endDate ?? "",
      tripId: visit.tripId ?? "",
      tripType: visit.tripType ?? "",
      notes: visit.notes ?? "",
      lived: isResidenceStatus(visit.status),
    };
    setVisitDraft(fresh);
    setVisitDraftBaseline(fresh);
    setVisitError(null);
    setOverlays((current) => [...current, { kind: "visitForm", placeId, visitId: visit.id }]);
  }, []);

  /** The same rule as the place and trip forms: typed input never vanishes silently. */
  const guardVisitFormClose = useCallback(() => {
    const dirty =
      visitDraft.startDate !== visitDraftBaseline.startDate ||
      visitDraft.endDate !== visitDraftBaseline.endDate ||
      visitDraft.tripId !== visitDraftBaseline.tripId ||
      visitDraft.tripType !== visitDraftBaseline.tripType ||
      visitDraft.notes !== visitDraftBaseline.notes ||
      visitDraft.lived !== visitDraftBaseline.lived;
    if (!dirty) return true;
    setDiscardVisitPrompt(true);
    return false;
  }, [visitDraft, visitDraftBaseline]);

  const saveVisit = useCallback(async () => {
    const overlay = visitFormOverlay;
    if (!overlay || overlay.kind !== "visitForm") return;

    setVisitSaving(true);
    setVisitError(null);
    try {
      const input: NewVisitInput = {
        startDate: visitDraft.startDate || undefined,
        endDate: visitDraft.endDate || undefined,
        tripId: visitDraft.tripId || undefined,
        tripType: visitDraft.tripType || undefined,
        notes: visitDraft.notes || undefined,
        // The switch owns the residence word outright; everything else keeps
        // the calendar-derived status rules below.
        status: visitDraft.lived ? VISIT_STATUS_LIVED : undefined,
      };

      if (!overlay.visitId) {
        await addVisit(overlay.placeId, input);
        showToast(whenOffline("Visit added", "Visit added — it’ll sync when you’re back"));
      } else if (isImplicitVisitId(overlay.visitId)) {
        // Editing the visit the old dates implied writes it down for real,
        // corrected — one row, not the original plus the correction.
        await addVisit(overlay.placeId, input, { materializeImplicit: false });
        showToast(whenOffline("Visit updated", "Updated here — it’ll sync when you’re back"));
      } else {
        // The overlay froze both ids when the form opened; if the visit's or
        // the place's create landed meanwhile, the sheet renamed them.
        // Follow the renames, or the status-preservation rules below would
        // judge a blank. (resolveTripId is the store's generic id resolver.)
        const targetVisitId = resolveTripId(overlay.visitId);
        const existing = getVisits(resolveTripId(overlay.placeId)).find(
          (v) => v.id === targetVisitId,
        );
        const changes: VisitChanges = { ...input };
        if (visitDraft.lived) {
          changes.status = VISIT_STATUS_LIVED;
        } else if (existing && isResidenceStatus(existing.status)) {
          // Switched off: the residence becomes an ordinary dated stay.
          changes.status = visitStatusFor(input.startDate);
        } else {
          // Status is written only when the answer to "has this happened?"
          // actually changes — a "Booked" stay stays "Booked" until it has.
          const nextPlanned = isPlannedStatus(visitStatusFor(input.startDate));
          if (!existing?.status || isPlannedStatus(existing.status) !== nextPlanned) {
            changes.status = visitStatusFor(input.startDate);
          } else {
            delete changes.status;
          }
        }
        await updateVisit(targetVisitId, changes);
        showToast(whenOffline("Visit updated", "Updated here — it’ll sync when you’re back"));
      }
      popOverlay();
    } catch (error) {
      setVisitError(error instanceof Error ? error.message : "That visit couldn’t be saved.");
    } finally {
      setVisitSaving(false);
    }
  }, [
    visitFormOverlay,
    visitDraft,
    addVisit,
    updateVisit,
    getVisits,
    resolveTripId,
    popOverlay,
    showToast,
  ]);

  const performDeleteVisit = useCallback(async () => {
    const target = confirmDeleteVisit;
    setConfirmDeleteVisit(null);
    if (!target) return;

    try {
      if (isImplicitVisitId(target.visitId)) {
        // The implied visit has no row of its own to remove — clearing the
        // place's dates (and the sheet's summary columns) is the whole of it.
        await clearImplicitVisit(target.placeId);
      } else {
        await deleteVisit(target.visitId);
      }
      setOverlays((current) => current.filter((overlay) => overlay.kind !== "visitForm"));
      showToast(whenOffline("Visit removed", "Removed here — it’ll sync when you’re back"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That visit couldn’t be removed.", {
        tone: "error",
      });
    }
  }, [confirmDeleteVisit, clearImplicitVisit, deleteVisit, showToast]);

  /* ---------------------------------------------------------------------- */
  /* Photos                                                                   */
  /* ---------------------------------------------------------------------- */

  const photosEnabled = capabilities.travelPhotos;
  /** Whether this deployment stores photos and videos picked from a device. */
  const deviceMediaEnabled = photosEnabled && capabilities.deviceMediaUpload;

  /** The "from this device" intake — one hidden input, one progress sheet. */
  const deviceIntake = useRef<DeviceMediaIntakeHandle | null>(null);
  /**
   * "Where from?" for one Add tap. Both answers must run inside the option's
   * own tap — the picker window and the file dialog are each gesture-gated —
   * which the ActionSheet honours by calling onSelect synchronously.
   */
  const [addMediaChoice, setAddMediaChoice] = useState<{
    title: string;
    googlePhotos: () => void;
    device: () => void;
  } | null>(null);

  const beginGooglePhotosForVisit = useCallback(
    (place: VisitedPlace, visit: PlaceVisit) => {
      // The blank window must open inside this tap — Safari's rule — and is
      // pointed at Google Photos once the session exists.
      openPickerWindow();
      void (async () => {
        try {
          // Photos attach to real rows, so the visit the old dates implied is
          // written down first — exactly what editing it does.
          const visitId = await ensureRealVisit(place.id, visit);
          setPhotoContext({
            kind: "visit",
            placeId: place.id,
            visitId,
            tripId: visit.tripId,
            startDate: visit.startDate,
            endDate: visit.endDate,
            title: place.name,
            subtitle: formatVisitRange(visit.startDate, visit.endDate) ?? undefined,
          });
          pushOverlay({ kind: "photoFlow" });
        } catch (error) {
          closePickerWindow();
          showToast(
            error instanceof Error ? error.message : "Photos couldn’t be started.",
            { tone: "error" },
          );
        }
      })();
    },
    [ensureRealVisit, pushOverlay, showToast],
  );

  const deviceTargetForVisit = useCallback(
    (place: VisitedPlace, visit: PlaceVisit): DeviceMediaTarget => ({
      title: place.name,
      resolve: async () => {
        const visitId = await ensureRealVisit(place.id, visit);
        return { placeId: place.id, visitId, tripId: visit.tripId };
      },
    }),
    [ensureRealVisit],
  );

  const startAddPhotosForVisit = useCallback(
    (place: VisitedPlace, visit: PlaceVisit) => {
      if (!deviceMediaEnabled) {
        beginGooglePhotosForVisit(place, visit);
        return;
      }
      setAddMediaChoice({
        title: place.name,
        googlePhotos: () => beginGooglePhotosForVisit(place, visit),
        device: () => deviceIntake.current?.open(deviceTargetForVisit(place, visit)),
      });
    },
    [deviceMediaEnabled, beginGooglePhotosForVisit, deviceTargetForVisit],
  );

  const beginGooglePhotosForTrip = useCallback(
    (trip: Trip) => {
      openPickerWindow();
      setPhotoContext({
        kind: "trip",
        tripId: trip.id,
        startDate: trip.startDate,
        endDate: trip.endDate,
        title: trip.name,
        subtitle: formatVisitRange(trip.startDate, trip.endDate) ?? undefined,
      });
      pushOverlay({ kind: "photoFlow" });
    },
    [pushOverlay],
  );

  const startAddPhotosForTrip = useCallback(
    (trip: Trip) => {
      if (!deviceMediaEnabled) {
        beginGooglePhotosForTrip(trip);
        return;
      }
      setAddMediaChoice({
        title: trip.name,
        googlePhotos: () => beginGooglePhotosForTrip(trip),
        device: () =>
          deviceIntake.current?.open({
            title: trip.name,
            resolve: async () => ({ tripId: trip.id }),
          }),
      });
    },
    [deviceMediaEnabled, beginGooglePhotosForTrip],
  );

  const closePhotoFlow = useCallback(() => {
    setOverlays((current) => current.filter((overlay) => overlay.kind !== "photoFlow"));
    setPhotoContext(null);
  }, []);

  const handleRemovePhoto = useCallback(
    async (photo: TravelPhoto) => {
      try {
        await removeTravelPhoto(photo.id);
        showToast("Photo removed");
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "That photo couldn’t be removed.",
          { tone: "error" },
        );
        throw error;
      }
    },
    [removeTravelPhoto, showToast],
  );

  /* Play Memories. Both levels assemble their playlist through the same pure
     selectors and play it through the same player — the only difference is
     the array handed over. */

  const startPlaceMemories = useCallback(
    (place: VisitedPlace) => {
      const playlist = playlistForPlace(travelPhotos, place.id);
      if (playlist.length === 0) return;
      setPlayerSession({
        title: place.name,
        subtitle: formatMediaCounts(mediaCounts(playlist)),
        completionLabel: "Memories complete",
        photos: playlist,
      });
    },
    [travelPhotos],
  );

  const startTripMemories = useCallback(
    (trip: Trip) => {
      const playlist = playlistForTrip(travelPhotos, trip, places, visits);
      if (playlist.length === 0) return;
      setPlayerSession({
        title: trip.name,
        subtitle: formatMediaCounts(mediaCounts(playlist)),
        completionLabel: "Trip complete",
        photos: playlist,
      });
    },
    [travelPhotos, places, visits],
  );

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

  /**
   * Filing several places into a trip at once.
   *
   * Each place is its own row in the sheet, so this is N writes however it is
   * presented — but they go through the same queue as every other edit, in
   * order, and the queue is what makes them survive a tunnel. Places already
   * in the target trip are skipped rather than rewritten, and the toast counts
   * what actually moved.
   *
   * Undo restores each place's previous trip individually, because a selection
   * can span several: five places going into "Japan 2026" might have come from
   * two other trips and no trip at all, and putting them all back as "no trip"
   * would be a second mistake rather than an undo.
   */
  const tagPlacesWithTrip = useCallback(
    async (ids: string[], trip: Trip | null): Promise<boolean> => {
      const tripId = trip?.id ?? null;
      const tripName = trip?.name ?? null;

      const selected = ids
        .map((id) => getPlace(id))
        .filter((place): place is VisitedPlace => Boolean(place));
      const changing = placesToRetag(selected, tripId);

      if (changing.length === 0) {
        showToast(alreadyTaggedMessage(selected.length, tripName));
        return true;
      }

      const previous = changing.map((place) => ({ id: place.id, tripId: place.tripId }));

      setTagging(true);
      try {
        for (const place of changing) {
          await updatePlace(place.id, { tripId: tripId ?? undefined });
        }
        showToast(whenOffline(
          tagSummary(changing.length, tripName),
          `${tagSummary(changing.length, tripName)} — it’ll sync when you’re back`,
        ), {
          action: {
            label: "Undo",
            onPress: () => {
              void (async () => {
                for (const record of previous) {
                  try {
                    await updatePlace(record.id, { tripId: record.tripId ?? undefined });
                  } catch {
                    // Best effort: one place that will not go back must not
                    // stop the others from returning.
                  }
                }
                showToast("Undone");
              })();
            },
          },
        });
        return true;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Those couldn’t be saved.", {
          tone: "error",
        });
        return false;
      } finally {
        setTagging(false);
      }
    },
    [getPlace, updatePlace, showToast],
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

      // Created from "New Trip" inside the tag sheet: the selection that was
      // waiting on it goes straight in, and that write announces itself, so
      // there is no second toast here.
      const waiting = tagAfterCreate.current;
      tagAfterCreate.current = null;
      if (waiting && waiting.length > 0) {
        void tagPlacesWithTrip(waiting, created);
        return created;
      }

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
  }, [tripDraft, overlays, createTrip, updateTrip, popOverlay, showToast, tagPlacesWithTrip]);

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

  /**
   * Asks the device where it is.
   *
   * Never called on load — a permission prompt on the first screen is the
   * fastest way to earn a permanent "no", and none of this matters until a pin
   * needs a home.
   */
  const findMe = useCallback(async (): Promise<Fix | null> => {
    setLocating(true);
    setLocationError(null);
    try {
      const fix = await currentLocation();
      setMyLocation(fix);
      locationRefused.current = false;
      return fix;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return null;
      if (error instanceof LocationError) {
        if (error.kind === "denied") locationRefused.current = true;
        setLocationError(error.message);
      } else {
        setLocationError("Your location isn’t available right now.");
      }
      return null;
    } finally {
      setLocating(false);
    }
  }, []);

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

  const flyToPin = useCallback((point: GlobePoint, zoom: number) => {
    setCamera({
      token: Date.now(),
      longitude: point.longitude,
      latitude: point.latitude,
      zoom,
      duration: 1200,
    });
  }, []);

  const beginPinSession = useCallback(
    (session: PinSession) => {
      setPinSession(session);
      setPreviewOpen(false);
      setMode("globe");
      setLocationError(null);

      if (session.position) {
        void resolvePinLabel(session.position);
        flyToPin(session.position, 9);
        return;
      }

      setPinLabel(null);

      /*
       * Nowhere to start from, so start at the middle of the map and ask the
       * device where it is.
       *
       * The centre goes in first so the bar is never in a dead state with a
       * disabled Save while a fix is being taken — the map is right there and
       * the pin is draggable from the first frame.
       *
       * Then, if the device answers, the pin moves to where you are and the
       * camera follows it down. Standing somewhere is almost always the answer
       * for a spot with no searchable name — a viewpoint, a beach, a bend in a
       * trail — and this is the one moment where asking for the permission is
       * obviously earning its keep: it is a direct consequence of tapping
       * "drop a pin", not something sprung on someone reading the globe.
       */
      const centre = globeHandle.current?.getCenter() ?? null;
      if (centre) {
        setPinSession((current) => (current ? { ...current, position: centre } : current));
        void resolvePinLabel(centre);
      }

      if (locationRefused.current) return;

      void findMe().then((fix) => {
        if (!fix) return;
        const position = { longitude: fix.longitude, latitude: fix.latitude };

        setPinSession((current) => {
          if (!current) return current;
          // A pin the person has already moved is theirs. Only one still
          // sitting exactly where it was put down gets taken over.
          const untouched =
            !current.position ||
            (centre !== null &&
              current.position.longitude === centre.longitude &&
              current.position.latitude === centre.latitude);
          if (!untouched) return current;

          void resolvePinLabel(position);
          flyToPin(position, 14);
          return { ...current, position };
        });
      });
    },
    [resolvePinLabel, findMe, flyToPin],
  );

  /** The locate button in the pin bar: a deliberate ask, so it always asks. */
  const useMyLocation = useCallback(() => {
    void findMe().then((fix) => {
      if (!fix) return;
      const position = { longitude: fix.longitude, latitude: fix.latitude };
      setPinSession((current) => (current ? { ...current, position } : current));
      void resolvePinLabel(position);
      flyToPin(position, 15);
    });
  }, [findMe, resolvePinLabel, flyToPin]);

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
    setLocationError(null);
    pinResultRef.current = null;
    if (session?.returnToForm && draft.name) {
      setOverlays([{ kind: "form", mode: draft.id ? "edit" : "create" }]);
    } else if (session?.mode === "adjust" && session.placeId) {
      setSelectedId(session.placeId);
      setPreviewOpen(true);
    }
  }, [pinSession, draft.id, draft.name]);

  /* Back walks out of pin placement the same way Cancel does. */
  useHistorySentinel(Boolean(pinSession), cancelPinSession);

  const commitPinSession = useCallback(async () => {
    const session = pinSession;
    if (!session?.position) return;
    const { longitude, latitude } = session.position;
    const geocoded = pinResultRef.current;

    setPinSession(null);
    setPinLabel(null);
    setLocationError(null);
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

  /**
   * Lets go of whatever the last delete was holding, photographs included.
   *
   * Called when the undo window runs out and when a second delete replaces the
   * first: only one delete can be standing at a time, and the one being
   * displaced is now permanent.
   */
  const forgetPendingDelete = useCallback(() => {
    for (const place of pendingDelete.current) discardPlacePhotos(place);
    pendingDelete.current = [];
  }, [discardPlacePhotos]);

  /**
   * Holds a delete open for as long as the toast stands, and puts the undo in
   * it.
   *
   * Undo restores and then gets out of the way. It used to select the place,
   * open its preview and swing the app round to the globe — which, pressed
   * from a list, answered "put that back" by throwing away where you were.
   * The place reappears where it was deleted from; only somebody already
   * looking at the globe, who has just watched a pin vanish, is shown it
   * coming back.
   */
  const holdForUndo = useCallback(
    (removed: VisitedPlace[], text: string) => {
      if (removed.length === 0) return;

      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      forgetPendingDelete();
      pendingDelete.current = removed;

      undoTimer.current = window.setTimeout(() => {
        forgetPendingDelete();
        undoTimer.current = null;
      }, UNDO_WINDOW_MS);

      showToast(text, {
        action: {
          label: "Undo",
          onPress: () => {
            if (undoTimer.current) window.clearTimeout(undoTimer.current);
            undoTimer.current = null;
            const records = pendingDelete.current;
            pendingDelete.current = [];
            if (records.length === 0) return;

            void Promise.all(records.map((record) => restorePlace(record)))
              .then(() => {
                if (modeRef.current !== "globe" || records.length !== 1) return;
                setSelectedId(records[0].id);
                setPreviewOpen(true);
              })
              .catch((error: Error) => showToast(error.message, { tone: "error" }));
          },
        },
      });
    },
    [forgetPendingDelete, restorePlace, showToast],
  );

  const performDelete = useCallback(
    async (id: string) => {
      setConfirmDeleteId(null);
      closeAllOverlays();
      setPreviewOpen(false);
      setSelectedId(null);

      try {
        const removed = await deletePlace(id);
        if (!removed) return;
        holdForUndo([removed], "Place deleted");
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "That place couldn’t be deleted.",
          { tone: "error" },
        );
      }
    },
    [deletePlace, holdForUndo, showToast, closeAllOverlays],
  );

  /**
   * Deletes a whole selection, and leaves one undo covering all of it.
   *
   * Sequential rather than parallel: every write goes through the same queue
   * to the same sheet, and firing a dozen at once only reorders them.
   *
   * A partial failure keeps the undo rather than replacing it with the error,
   * and says how far it got — "4 of 7 places deleted". An error message that
   * takes the undo away with it is the worst of both: it explains what went
   * wrong and removes the only way to put back what went right.
   */
  const performDeleteMany = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      closeAllOverlays();
      setPreviewOpen(false);
      setSelectedId(null);

      const removed: VisitedPlace[] = [];
      let failure: string | null = null;

      for (const id of ids) {
        try {
          const place = await deletePlace(id);
          if (place) removed.push(place);
        } catch (error) {
          failure =
            error instanceof Error ? error.message : "Those places couldn’t all be deleted.";
        }
      }

      if (removed.length === 0) {
        if (failure) showToast(failure, { tone: "error" });
        return;
      }

      holdForUndo(
        removed,
        failure
          ? `${removed.length} of ${ids.length} places deleted`
          : removed.length === 1
            ? "Place deleted"
            : `${removed.length} places deleted`,
      );
    },
    [deletePlace, holdForUndo, showToast, closeAllOverlays],
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

  const tabBarHidden = Boolean(pinSession) || selectingPlaces;
  const actionsPlace = getPlace(actionsFor);
  const confirmPlace = getPlace(confirmDeleteId);
  const searchOverlay = topOverlay?.kind === "search" ? topOverlay : null;
  const formOverlay = overlays.find((overlay) => overlay.kind === "form");

  // Everything below reads from the sheet, so on a browser that hasn't been
  // told where the sheet is there is nothing honest to draw yet. Placed after
  // every hook above so the hook order never changes between renders.
  /* Defined late because they wrap handlers that live above. */
  const createTripForSelection = useCallback(
    (ids: string[]) => {
      tagAfterCreate.current = ids;
      startCreateTrip();
    },
    [startCreateTrip],
  );
  const deletePlaceNow = useCallback((id: string) => void performDelete(id), [performDelete]);
  const deletePlacesNow = useCallback(
    (ids: string[]) => void performDeleteMany(ids),
    [performDeleteMany],
  );
  const handleModeChange = useCallback((next: AppMode) => {
    setMode(next);
    if (next !== "globe") setPreviewOpen(false);
  }, []);

  if (needsSetup) {
    return <SheetSetupScreen onConnected={sync.connect} />;
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg">
      {/* The globe is mounted for the whole session and never torn down. */}
      <div className="absolute inset-0">
        <TravelGlobeM
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
          // Only while a pin is being placed: outside that it is a mark with
          // nothing to say, and a live dot on a travel map reads as clutter.
          currentLocation={
            pinSession && myLocation
              ? { longitude: myLocation.longitude, latitude: myLocation.latitude }
              : null
          }
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
        onAddLocation={addFromGlobeSearch}
        onOpenSettings={() => setSyncOpen(true)}
        // Noted at focus so the world search is biased to wherever the globe
        // is currently looking, same as the add flow's own search.
        onSearchFocus={captureProximity}
        proximity={proximity}
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
        {deferredMode === "places" ? (
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
            <PlacesViewM
              places={places}
              countries={countries}
              stats={stats}
              loading={status === "loading"}
              bottomInset={tabBarHeight + 16}
              onOpenPlace={openDetail}
              onPlaceActions={setActionsFor}
              onAdd={startCreateBlank}
              onShowGlobe={showGlobeTab}
              syncState={sync.state}
              onOpenSync={openSyncSheet}
              trips={trips}
              tagging={tagging}
              onTagPlaces={tagPlacesWithTrip}
              onCreateTripFor={createTripForSelection}
              /* Straight to the delete, with the undo it already leaves in the
                 toast. The confirmation dialog belongs to the menu, where the
                 tap that opened it could have been a mis-tap; a swipe across
                 half a row could not. */
              onDeletePlace={deletePlaceNow}
              /* The selection's own delete, which does ask first — it can be
                 many places at once, and a tick list is easier to build up by
                 accident than a swipe is. */
              onDeletePlaces={deletePlacesNow}
              onSelectingChange={setSelectingPlaces}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The timeline slides over the globe the same way Places does. */}
      <AnimatePresence>
        {deferredMode === "timeline" ? (
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
            <TimelineViewM
              places={places}
              visits={visits}
              trips={trips}
              loading={status === "loading"}
              bottomInset={tabBarHeight + 16}
              onOpenPlace={openDetail}
              onOpenTrip={openTripDetail}
              onAdd={startCreateBlank}
              onShowGlobe={showGlobeTab}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Trips slides over the globe the same way Places and Timeline do. */}
      <AnimatePresence>
        {deferredMode === "trips" ? (
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
            <TripsViewM
              trips={trips}
              places={places}
              visits={visits}
              loading={status === "loading"}
              bottomInset={tabBarHeight + 16}
              onOpenTrip={openTripDetail}
              onCreateTrip={startCreateTrip}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The Player — everything with media attached, ready to watch — slides
          over the globe the same way the other tabs do. */}
      <AnimatePresence>
        {deferredMode === "player" ? (
          <motion.div
            key="player"
            className="absolute inset-0 z-20"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] }
            }
          >
            <PlayerViewM
              trips={trips}
              places={places}
              visits={visits}
              travelPhotos={travelPhotos}
              loading={status === "loading"}
              photosEnabled={photosEnabled}
              bottomInset={tabBarHeight + 16}
              onPlayTrip={startTripMemories}
              onPlayPlace={startPlaceMemories}
              onOpenTrip={openTripDetail}
              onOpenPlace={openDetail}
              onBrowsePlaces={browsePlacesTab}
              onNeedMediaCode={openMediaCodeSheet}
              galleryEpoch={galleryEpoch}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The scoreboard slides over the globe the same way the others do. */}
      <AnimatePresence>
        {deferredMode === "stats" ? (
          <motion.div
            key="stats"
            className="absolute inset-0 z-20"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] }
            }
          >
            <InsightsViewM
              places={places}
              visits={visits}
              loading={status === "loading"}
              bottomInset={tabBarHeight + 16}
              onOpenPlace={openDetail}
              onDrill={openInsightDrill}
              onAdd={startCreateBlank}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <MapViewToggle
        value={mapView}
        onChange={setMapView}
        /* Hidden while a place is previewed rather than lifted above the
           card. The card's height depends on how much the traveller wrote in
           it, so any fixed offset is a guess, and the two we tried were both
           wrong for a place with notes — the switch ended up peeking out from
           behind the sheet. It is browsing chrome; while you are reading one
           place, it has nothing to offer. */
        visible={
          mode === "globe" &&
          globeStatus !== "failed" &&
          !pinSession &&
          !previewVisible &&
          overlays.length === 0 &&
          places.length > 0
        }
        bottomOffset={tabBarHeight + 8}
      />

      <AppTabBar
        ref={tabBarRef}
        mode={mode}
        onModeChange={handleModeChange}
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
        depth={depthOf("detail")}
        backTo={detailBackTo}
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
        visits={detailVisits}
        onAddVisit={() => detailPlace && startAddVisit(detailPlace.id)}
        onEditVisit={(visit) => detailPlace && startEditVisit(detailPlace.id, visit)}
        tripNameFor={(tripId) => (tripId ? getTrip(tripId)?.name : undefined)}
        travelPhotos={travelPhotos}
        photosEnabled={photosEnabled}
        onAddPhotosToVisit={(visit) => detailPlace && startAddPhotosForVisit(detailPlace, visit)}
        onRemovePhoto={handleRemovePhoto}
        onNeedMediaCode={() => setMediaCodeOpen(true)}
        onPlayMemories={() => detailPlace && startPlaceMemories(detailPlace)}
        galleryEpoch={galleryEpoch}
        onLinkGoogle={handleLinkGoogle}
        onDeletePlacePhoto={(ref) => detailPlace && handleDeletePlacePhoto(detailPlace.id, ref)}
        onMakeCoverPhoto={(ref) => detailPlace && handleMakeCoverPhoto(detailPlace.id, ref)}
      />

      <VisitFormSheet
        open={Boolean(visitFormOverlay)}
        mode={visitFormOverlay?.kind === "visitForm" && visitFormOverlay.visitId ? "edit" : "add"}
        placeName={
          getPlace(visitFormOverlay?.kind === "visitForm" ? visitFormOverlay.placeId : null)
            ?.name ?? "this place"
        }
        depth={depthOf("visitForm")}
        draft={visitDraft}
        onChange={setVisitDraft}
        onSave={() => void saveVisit()}
        onClose={popOverlay}
        onRequestClose={guardVisitFormClose}
        onDelete={
          visitFormOverlay?.kind === "visitForm" && visitFormOverlay.visitId
            ? () =>
                setConfirmDeleteVisit({
                  placeId: visitFormOverlay.placeId,
                  visitId: visitFormOverlay.visitId as string,
                })
            : undefined
        }
        saving={visitSaving}
        error={visitError}
        trips={trips}
        tripTypes={sync.lookups["Trip Type"] ?? []}
      />

      <PlaceFormSheet
        open={Boolean(formOverlay)}
        mode={formOverlay?.kind === "form" ? formOverlay.mode : "create"}
        depth={depthOf("form")}
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
        visitCount={draft.id ? getVisits(draft.id).length : 0}
        onVideos={deviceMediaEnabled ? handleFormVideos : undefined}
        pendingVideoCount={pendingFormVideoCount}
      />

      <InsightDrillSheet
        scope={insightOverlay?.scope ?? null}
        label={insightOverlay?.label ?? ""}
        open={Boolean(insightOverlay)}
        onClose={closeAllOverlays}
        depth={depthOf("insight")}
        places={places}
        visits={visits}
        onOpenPlace={openDetailFromInsight}
      />

      <TripDetailSheet
        trip={openTrip ?? null}
        places={places}
        visits={visits}
        open={Boolean(tripOverlay)}
        depth={depthOf("trip")}
        onClose={closeAllOverlays}
        onEdit={() => tripOverlay?.kind === "trip" && startEditTrip(tripOverlay.id)}
        onOpenPlace={openDetailFromTrip}
        onAddPlace={() =>
          tripOverlay?.kind === "trip" &&
          startCreate({ tripId: tripOverlay.id, keepTripOpen: true })
        }
        travelPhotos={travelPhotos}
        photosEnabled={photosEnabled}
        onAddPhotos={() => openTrip && startAddPhotosForTrip(openTrip)}
        onRemovePhoto={handleRemovePhoto}
        onNeedMediaCode={() => setMediaCodeOpen(true)}
        onPlayMemories={() => openTrip && startTripMemories(openTrip)}
        galleryEpoch={galleryEpoch}
      />

      <TripFormSheet
        open={Boolean(tripFormOverlay)}
        mode={tripFormOverlay?.kind === "tripForm" ? tripFormOverlay.mode : "create"}
        depth={depthOf("tripForm")}
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
            // Deliberately null for a new place: `beginPinSession` starts it at
            // the middle of the map and then offers to move it to where the
            // device actually is.
            position:
              draft.latitude !== null && draft.longitude !== null
                ? { longitude: draft.longitude, latitude: draft.latitude }
                : null,
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
        onUseMyLocation={useMyLocation}
        locating={locating}
        locationError={locationError}
        accuracy={myLocation?.accuracy ?? null}
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
        open={discardVisitPrompt}
        title="Discard changes?"
        message="Your edits to this visit won’t be saved."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onCancel={() => setDiscardVisitPrompt(false)}
        onConfirm={() => {
          setDiscardVisitPrompt(false);
          setVisitDraft(visitDraftBaseline);
          popOverlay();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteVisit)}
        title="Remove this visit?"
        message="Only this stay is removed — the place keeps its card and photos."
        confirmLabel="Remove Visit"
        onCancel={() => setConfirmDeleteVisit(null)}
        onConfirm={() => void performDeleteVisit()}
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

      <GooglePhotosFlowSheet
        open={overlays.some((overlay) => overlay.kind === "photoFlow")}
        depth={depthOf("photoFlow")}
        context={photoContext}
        onClose={closePhotoFlow}
        onToast={showToast}
      />

      <MediaCodeSheet
        open={mediaCodeOpen}
        onClose={() => setMediaCodeOpen(false)}
        onSaved={() => {
          setGalleryEpoch((epoch) => epoch + 1);
          showToast("Media code saved on this device");
        }}
      />

      {/* "Where from?" for one Add tap. Both options must act inside their
          own tap — the picker window and the file dialog are gesture-gated —
          and the ActionSheet calls onSelect synchronously for exactly this. */}
      <ActionSheet
        open={Boolean(addMediaChoice)}
        onClose={() => setAddMediaChoice(null)}
        title={addMediaChoice ? `Add to ${addMediaChoice.title}` : undefined}
        description="Photos and videos both play in Memories."
        actions={[
          {
            label: "Choose from Google Photos",
            icon: <Images size={18} />,
            onSelect: () => addMediaChoice?.googlePhotos(),
          },
          {
            label: "Choose files on this device",
            icon: <FolderOpen size={18} />,
            onSelect: () => addMediaChoice?.device(),
          },
        ]}
      />

      <DeviceMediaIntake handleRef={deviceIntake} onToast={showToast} />

      <TravelMediaPlayer
        open={Boolean(playerSession)}
        title={playerSession?.title ?? ""}
        subtitle={playerSession?.subtitle}
        photos={playerSession?.photos ?? []}
        completionLabel={playerSession?.completionLabel}
        onClose={() => setPlayerSession(null)}
        onNeedMediaCode={() => setMediaCodeOpen(true)}
      />

      <SyncSettingsSheet
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        connection={sync.connection}
        state={sync.state}
        capabilities={capabilities}
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
