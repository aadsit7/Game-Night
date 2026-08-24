import { loadCache, saveCache, clearCache } from "@/lib/sheets/cache";
import {
  clearConnection,
  loadConnection,
  saveConnection,
  type SheetConnection,
} from "@/lib/sheets/connection";
import { defaultConnection } from "@/lib/sheets/defaultConnection";
import {
  applyLocalPhotos,
  forgetLocalPhotos,
  rememberLocalPhotos,
  renameLocalPhotos,
} from "@/lib/sheets/localPhotos";
import {
  COLUMNS,
  MEDIA_COLUMNS,
  MEDIA_TAB,
  MEDIA_TYPE_PHOTO,
  PLACES_TAB,
  TRAVEL_PHOTOS_TAB,
  TRIPS_TAB,
  VISITS_TAB,
  VISIT_COLUMNS,
  applyMediaPhotos,
  applyVisitSpans,
  fieldsFromChanges,
  fieldsFromTripChanges,
  fieldsFromVisitChanges,
  isRemotePhoto,
  mediaFromTable,
  placesFromTable,
  restrictToHeaders,
  travelPhotosFromTable,
  tripsFromTable,
  visitsFromTable,
  type MediaLink,
} from "@/lib/sheets/mapping";
import {
  implicitVisit,
  isImplicitVisitId,
  isUpcomingVisit,
  visitSpan,
  visitStats,
  visitStatusFor,
} from "@/lib/places/visits";
import {
  LOCAL_ID_PREFIX,
  adoptFieldValue,
  adoptId,
  enqueue,
  isLocalId,
  loadQueue,
  pendingKeys,
  saveQueue,
  settle,
  type PendingWrite,
} from "@/lib/sheets/queue";
import {
  SheetError,
  deleteRow,
  deleteTravelPhotoRemote,
  getAll,
  importPickedPhotos,
  uploadPhoto,
  uploadTravelMedia,
  upsertRow,
  type ImportItemResult,
  type SheetCapabilities,
} from "@/lib/sheets/sheetsClient";
import type { PreparedDeviceMedia } from "@/lib/photos/deviceMedia";
import { forgetCachedPhoto } from "@/lib/storage/cloudPhotoCache";
import { PersistenceError, type PlaceRepository } from "@/lib/storage/placeRepository";
import { deletePhoto, getPhoto, isLocalPhotoRef } from "@/lib/storage/photoStore";
import { createId } from "@/lib/utils/id";
import { clampLatitude, isValidLatitude, isValidLongitude, normalizeLongitude } from "@/lib/utils/geo";
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
 * The travel collection, stored in a Google Sheet.
 *
 * Reads happen once at startup — one request for every tab — and are held in
 * memory from then on. Writes are applied to memory immediately and sent to
 * the sheet straight after, so a tap never waits on the network and a change
 * made in a tunnel is still a change: it waits on a queue and goes up when the
 * connection does.
 *
 * The sheet is the truth. The localStorage copy underneath is only a cache, so
 * a successful load overwrites it wholesale rather than merging into it.
 */

export type SheetPhase =
  | "unconfigured"
  | "loading"
  | "idle"
  | "saving"
  | "offline"
  | "error";

export type SheetStatus = {
  phase: SheetPhase;
  /** When the sheet was last read end to end. */
  lastSyncedAt: string | null;
  error: string | null;
  /** Writes still only on this device. */
  pending: number;
  connected: boolean;
};

type Listener = () => void;

/**
 * The status before anything has been read from this browser.
 *
 * Exported and shared rather than rebuilt, because `useSyncExternalStore`
 * compares snapshots by identity: a fresh object every render would look like
 * a change on every render and loop.
 */
export const INITIAL_STATUS: SheetStatus = {
  phase: "unconfigured",
  lastSyncedAt: null,
  error: null,
  pending: 0,
  connected: false,
};

/** One shared empty array, for the same reason. */
export const NO_PLACES: VisitedPlace[] = [];

/** And one for trips. */
export const NO_TRIPS: Trip[] = [];

/** And one for visits. */
export const NO_VISITS: PlaceVisit[] = [];

/** And one for cloud photos. */
export const NO_TRAVEL_PHOTOS: TravelPhoto[] = [];

/**
 * What a deployment can do before it has been asked. Nothing, deliberately:
 * an app that offered a search the script cannot serve would fail on every
 * keystroke, and an older script simply omits the field.
 */
export const NO_CAPABILITIES: SheetCapabilities = {
  placesSearch: false,
  placeDetails: false,
  photoUpload: false,
  visits: false,
  travelPhotos: false,
  googlePhotosPicker: false,
  googlePhotosConnected: false,
  deviceMediaUpload: false,
};

/** What one photo-import run did, item by item plus the running totals. */
export type PhotoImportProgress = {
  total: number;
  done: number;
  imported: number;
  duplicates: number;
  videos: number;
  failed: GooglePickedMedia[];
};

/** Every photo reference on a place that is a real link rather than a blob. */
function remotePhotoRefs(place: VisitedPlace): string[] {
  return [place.coverImage, ...(place.photos ?? [])].filter(
    (ref): ref is string => Boolean(ref && isRemotePhoto(ref)),
  );
}

/** Base64 without a data-URL prefix, which is what the Apps Script decodes. */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

function friendly(error: unknown, fallback: string): string {
  if (error instanceof SheetError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
}

class SheetPlaceRepository implements PlaceRepository {
  private connection: SheetConnection | null = null;

  /** Everything, tombstones included. */
  private places: VisitedPlace[] = [];

  /** The same collection minus tombstones, kept so reads have a stable identity. */
  private visible: VisitedPlace[] = NO_PLACES;

  /** Trips, and the same collection minus tombstones. */
  private trips: Trip[] = [];
  private visibleTrips: Trip[] = NO_TRIPS;

  /** Visits, and the same collection minus tombstones. */
  private visits: PlaceVisit[] = [];
  private visibleVisits: PlaceVisit[] = NO_VISITS;

  /** Cloud photos, and the same collection minus tombstones. */
  private travelPhotos: TravelPhoto[] = [];
  private visibleTravelPhotos: TravelPhoto[] = NO_TRAVEL_PHOTOS;

  /** Photo rows on Media_Links, kept so removing a photo can remove its row. */
  private media: MediaLink[] = [];

  /**
   * The headers the Dates_Visits and Media_Links tabs actually had at load
   * time, so writes are trimmed to columns this particular sheet owns.
   */
  private visitHeaders: string[] = [];
  private mediaHeaders: string[] = [];

  /** One Drive sweep at a time; a second request just waits for the next one. */
  private photoSweepRunning = false;

  /**
   * Local refs the script refused outright — too large, not an image, a
   * sharing policy. Retrying such an upload would fail identically and block
   * every photo behind it, so the sweep skips them for this session.
   */
  private refusedPhotoRefs = new Set<string>();

  /**
   * Local ref to the link it was uploaded as. An edit form opened before the
   * sweep still holds the ref; without this, saving that form would put the
   * blob reference back over the link and tear down the Media_Links row.
   */
  private uploadedPhotoUrls = new Map<string, string>();

  private lookups: Record<string, string[]> = {};
  private settings: Record<string, string> = {};
  private capabilities: SheetCapabilities = NO_CAPABILITIES;
  private queue: PendingWrite[] = [];

  private status: SheetStatus = INITIAL_STATUS;

  private listeners = new Set<Listener>();
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private hydrated = false;

  /**
   * Temporary id to the one the sheet gave it.
   *
   * Records and queued writes are re-pointed the moment a create lands, but a
   * half-finished form on screen holds its own copy of an id and cannot be
   * reached from here. This is how it catches up — see `resolveId`.
   */
  private adopted = new Map<string, string>();

  /* ---------------------------------------------------------------- *
   * Subscription
   * ---------------------------------------------------------------- */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  getStatus(): SheetStatus {
    return this.status;
  }

  /**
   * The places to draw. Recomputed only when the collection changes, so
   * repeated reads hand back the same array and React can tell "nothing
   * happened" from "everything happened".
   */
  getVisible(): VisitedPlace[] {
    return this.visible;
  }

  /** The one way the collection changes: keep both views in step, then tell React. */
  private commit(places: VisitedPlace[]): void {
    this.places = places;
    const visible = places.filter((place) => !place.deletedAt);
    this.visible = visible.length === 0 ? NO_PLACES : visible;
    this.notify();
  }

  /** The trips to draw, tombstones removed. Stable identity, as above. */
  getVisibleTrips(): Trip[] {
    return this.visibleTrips;
  }

  /** The one way the trip collection changes. */
  private commitTrips(trips: Trip[]): void {
    this.trips = trips;
    const visible = trips.filter((trip) => !trip.deletedAt);
    this.visibleTrips = visible.length === 0 ? NO_TRIPS : visible;
    this.notify();
  }

  /** The visits to draw, tombstones removed. Stable identity, as above. */
  getVisibleVisits(): PlaceVisit[] {
    return this.visibleVisits;
  }

  /** The one way the visit collection changes. */
  private commitVisits(visits: PlaceVisit[]): void {
    this.visits = visits;
    const visible = visits.filter((visit) => !visit.deletedAt);
    this.visibleVisits = visible.length === 0 ? NO_VISITS : visible;
    this.notify();
  }

  /** The cloud photos to draw, tombstones removed. Stable identity, as above. */
  getVisibleTravelPhotos(): TravelPhoto[] {
    return this.visibleTravelPhotos;
  }

  /** The one way the cloud photo collection changes. */
  private commitTravelPhotos(photos: TravelPhoto[]): void {
    this.travelPhotos = photos;
    const visible = photos.filter((photo) => !photo.deletedAt);
    this.visibleTravelPhotos = visible.length === 0 ? NO_TRAVEL_PHOTOS : visible;
    this.notify();
  }

  getLookups(): Record<string, string[]> {
    return this.lookups;
  }

  getSettings(): Record<string, string> {
    return this.settings;
  }

  /** Read by the search layer to decide which geocoder to ask. */
  getCapabilities(): SheetCapabilities {
    return this.capabilities;
  }

  getConnection(): SheetConnection | null {
    return this.connection;
  }

  private setStatus(patch: Partial<SheetStatus>): void {
    this.status = { ...this.status, ...patch, pending: this.queue.length };
    this.notify();
  }

  /* ---------------------------------------------------------------- *
   * Startup
   * ---------------------------------------------------------------- */

  /**
   * Brings this browser's saved state into memory.
   *
   * Kept out of the constructor because the module is imported during the
   * static build, where there is no localStorage to read.
   */
  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;

    this.connection = loadConnection();
    this.queue = loadQueue();

    const cached = loadCache();
    if (cached) {
      this.lookups = cached.lookups;
      this.settings = cached.settings;
      this.media = cached.media;
      this.visitHeaders = cached.visitHeaders;
      this.commitTrips(cached.trips);
      this.commitVisits(cached.visits);
      this.commitTravelPhotos(cached.travelPhotos);
      this.commit(cached.places);
    }

    this.setStatus({
      phase: this.connection ? "loading" : "unconfigured",
      connected: Boolean(this.connection),
      lastSyncedAt: cached?.cachedAt || null,
    });
  }

  connect(connection: SheetConnection): void {
    this.connection = connection;
    saveConnection(connection);
    this.setStatus({ phase: "loading", connected: true, error: null });
  }

  /**
   * Forgets this browser's connection, and everything read with it.
   *
   * If the published site carries a built-in connection, that is what the app
   * falls back to — resetting is meant to undo a manual override, not to lock
   * someone out of their own data until they retype it.
   *
   * The queue is deliberately kept either way: an unsaved edit is the one
   * thing here that exists nowhere else, and it should still go up once a
   * connection returns.
   */
  disconnect(): void {
    this.lookups = {};
    this.settings = {};
    this.capabilities = NO_CAPABILITIES;
    this.media = [];
    this.visitHeaders = [];
    this.mediaHeaders = [];
    clearConnection();
    clearCache();
    this.commitTrips([]);
    this.commitVisits([]);
    this.commit([]);

    this.commitTravelPhotos([]);

    this.connection = defaultConnection();
    this.setStatus({
      phase: this.connection ? "loading" : "unconfigured",
      connected: Boolean(this.connection),
      error: null,
      lastSyncedAt: null,
    });

    if (this.connection) void this.load();
  }

  /**
   * Reads every tab and replaces what is in memory.
   *
   * Records with a write still queued are the exception: those keep the local
   * version, because the sheet has not been told about them yet and showing
   * its older copy would look like the edit had been undone.
   */
  async load(): Promise<void> {
    if (!this.connection) {
      this.setStatus({ phase: "unconfigured", connected: false });
      return;
    }

    this.setStatus({ phase: "loading", error: null });

    try {
      const snapshot = await getAll(this.connection);
      const placesTable = snapshot.tabs[PLACES_TAB];

      if (!placesTable || placesTable.headers.length === 0) {
        throw new SheetError(
          "The sheet answered, but its Places tab looks empty. Check the tab name hasn’t changed.",
          "malformed",
        );
      }

      const fromSheet = placesFromTable(placesTable, snapshot.serverTime);

      const visitsTable = snapshot.tabs[VISITS_TAB];
      const visits = visitsFromTable(visitsTable, snapshot.serverTime);
      this.visitHeaders = visitsTable?.headers ?? [];

      // Deleted visit rows must not stretch a place's span, so the spans are
      // folded from the parsed records rather than the raw table.
      const liveVisits = visits.filter((visit) => !visit.deletedAt);
      const spans = new Map<string, { from?: string; to?: string }>();
      for (const visit of liveVisits) {
        const grouped = liveVisits.filter((v) => v.placeId === visit.placeId);
        if (!spans.has(visit.placeId)) spans.set(visit.placeId, visitSpan(grouped));
      }
      const withSpans = applyVisitSpans(fromSheet, spans);

      const mediaTable = snapshot.tabs[MEDIA_TAB];
      // Media rows still queued locally survive the reload the same way
      // pending places do — the sheet hasn't been told about them yet.
      const pendingWrites = pendingKeys(this.queue);
      this.media = [
        ...mediaFromTable(mediaTable),
        ...this.media.filter((link) => pendingWrites.has(link.id)),
      ];
      this.mediaHeaders = mediaTable?.headers ?? [];
      const withMedia = applyMediaPhotos(withSpans, this.media);

      // Metadata only — the bytes stay in Drive until a gallery asks.
      this.commitTravelPhotos(
        travelPhotosFromTable(snapshot.tabs[TRAVEL_PHOTOS_TAB], snapshot.serverTime),
      );

      // A sheet whose script predates trips has no Trips tab. That is not a
      // failure — it simply has no trips, and everything else loads as before.
      this.commitTrips(
        this.overlayPendingTrips(tripsFromTable(snapshot.tabs[TRIPS_TAB], snapshot.serverTime)),
      );
      this.commitVisits(this.overlayPendingVisits(visits));
      this.commit(applyLocalPhotos(this.overlayPending(withMedia)));
      this.lookups = snapshot.lookups;
      this.settings = snapshot.settings;
      this.capabilities = snapshot.capabilities;

      this.persist();
      this.setStatus({
        phase: this.queue.length > 0 ? "saving" : "idle",
        error: null,
        lastSyncedAt: new Date().toISOString(),
      });

      void this.flush();
      void this.syncPhotosToDrive();
    } catch (error) {
      const retryable = error instanceof SheetError && error.retryable;

      // Having a cache is what makes a failed load survivable: the history is
      // still on screen, marked as not currently in step with the sheet.
      this.setStatus({
        phase: retryable && this.places.length > 0 ? "offline" : "error",
        error: friendly(error, "Your travel data couldn’t be loaded from the sheet."),
      });
    }
  }

  /** Keeps locally-pending records ahead of the sheet's older copy of them. */
  private overlayPending(fromSheet: VisitedPlace[]): VisitedPlace[] {
    const pending = pendingKeys(this.queue);
    if (pending.size === 0) return fromSheet;

    const local = new Map(this.places.map((place) => [place.id, place]));
    const merged = fromSheet.map((place) =>
      pending.has(place.id) ? (local.get(place.id) ?? place) : place,
    );

    // Records created while offline exist nowhere in the sheet yet.
    const present = new Set(merged.map((place) => place.id));
    for (const key of pending) {
      const record = local.get(key);
      if (record && !present.has(key)) merged.push(record);
    }
    return merged;
  }

  /** The same rule as `overlayPending`, for trips. */
  private overlayPendingTrips(fromSheet: Trip[]): Trip[] {
    const pending = pendingKeys(this.queue);
    if (pending.size === 0) return fromSheet;

    const local = new Map(this.trips.map((trip) => [trip.id, trip]));
    const merged = fromSheet.map((trip) =>
      pending.has(trip.id) ? (local.get(trip.id) ?? trip) : trip,
    );

    const present = new Set(merged.map((trip) => trip.id));
    for (const key of pending) {
      const record = local.get(key);
      if (record && !present.has(key)) merged.push(record);
    }
    return merged;
  }

  /** The same rule again, for visits. */
  private overlayPendingVisits(fromSheet: PlaceVisit[]): PlaceVisit[] {
    const pending = pendingKeys(this.queue);
    if (pending.size === 0) return fromSheet;

    const local = new Map(this.visits.map((visit) => [visit.id, visit]));
    const merged = fromSheet.map((visit) =>
      pending.has(visit.id) ? (local.get(visit.id) ?? visit) : visit,
    );

    const present = new Set(merged.map((visit) => visit.id));
    for (const key of pending) {
      const record = local.get(key);
      if (record && !present.has(key)) merged.push(record);
    }
    return merged;
  }

  private persist(): void {
    saveCache({
      places: this.places,
      trips: this.trips,
      visits: this.visits,
      travelPhotos: this.travelPhotos,
      media: this.media,
      visitHeaders: this.visitHeaders,
      lookups: this.lookups,
      settings: this.settings,
    });
  }

  /* ---------------------------------------------------------------- *
   * The queue
   * ---------------------------------------------------------------- */

  private push(write: PendingWrite): void {
    this.queue = enqueue(this.queue, write);
    saveQueue(this.queue);
    this.setStatus({ phase: this.queue.length > 0 ? "saving" : this.status.phase });
    void this.flush();
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)];
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  /**
   * Sends queued writes, oldest first and one at a time.
   *
   * Order matters and concurrency would break it: a create has to land before
   * the edit that follows it, or the edit would arrive quoting an id the sheet
   * has never seen.
   */
  async flush(): Promise<void> {
    if (this.flushing || !this.connection || this.queue.length === 0) return;

    this.flushing = true;
    this.clearRetry();
    this.setStatus({ phase: "saving" });

    try {
      while (this.queue.length > 0) {
        const write = this.queue[0];
        const connection = this.connection;
        if (!connection) break;

        try {
          if (write.kind === "delete") {
            await deleteRow(connection, { tab: write.tab, id: write.id });
          } else {
            const result = await upsertRow(connection, {
              tab: write.tab,
              id: write.id && !isLocalId(write.id) ? write.id : undefined,
              fields: write.fields,
            });

            // An offline create finally has a real Place ID. Everything that
            // refers to it locally has to move across — but only after the
            // create itself has left the queue, because re-keying rebuilds the
            // entries and `settle` would no longer recognise the one it just
            // sent, and send it a second time.
            this.queue = settle(this.queue, write);
            if (isLocalId(write.key)) this.adopt(write.key, result.id, write.tab);
            saveQueue(this.queue);
            this.retryAttempt = 0;
            continue;
          }

          this.queue = settle(this.queue, write);
          saveQueue(this.queue);
          this.retryAttempt = 0;
        } catch (error) {
          const retryable = error instanceof SheetError && error.retryable;

          if (retryable) {
            // Left at the head of the queue on purpose — it is not lost, and
            // the next attempt sends it before anything queued behind it.
            this.setStatus({
              phase: "offline",
              error: friendly(error, "That change hasn’t reached the sheet yet."),
            });
            this.scheduleRetry();
            return;
          }

          // A refused write — a wrong code, a renamed column — will be refused
          // again just as fast. Retrying forever would hide it, so it stops
          // here, still queued, with the reason on screen.
          this.setStatus({
            phase: "error",
            error: friendly(error, "The sheet refused that change."),
          });
          return;
        }
      }

      this.setStatus({ phase: "idle", error: null });
    } finally {
      this.flushing = false;
    }
  }

  /**
   * The id a temporary one turned into, or the id itself.
   *
   * Follows the chain, so a value that has been through more than one rename
   * still ends up at the row that actually exists.
   */
  resolveId(id: string): string {
    let current = id;
    for (let hops = 0; hops < 8; hops += 1) {
      const next = this.adopted.get(current);
      if (!next || next === current) return current;
      current = next;
    }
    return current;
  }

  /** Swaps a temporary id for the one the sheet assigned, everywhere at once. */
  private adopt(localKey: string, assignedId: string, tab: string): void {
    this.adopted.set(localKey, assignedId);

    if (tab === TRIPS_TAB) {
      this.commitTrips(
        this.trips.map((trip) => (trip.id === localKey ? { ...trip, id: assignedId } : trip)),
      );
      // Places assigned to a trip that was still being created point at its
      // temporary id — in memory and in anything queued behind it. Both have
      // to move across, or the sheet would be told a place belongs to a trip
      // that never existed there.
      this.commit(
        this.places.map((place) =>
          place.tripId === localKey ? { ...place, tripId: assignedId } : place,
        ),
      );
      // Visits point at trips too, through their own Trip ID cell.
      this.commitVisits(
        this.visits.map((visit) =>
          visit.tripId === localKey ? { ...visit, tripId: assignedId } : visit,
        ),
      );
      this.queue = adoptFieldValue(this.queue, COLUMNS.tripId, localKey, assignedId);
      this.queue = adoptFieldValue(this.queue, VISIT_COLUMNS.tripId, localKey, assignedId);
      this.queue = adoptId(this.queue, localKey, assignedId);
      this.persist();
      return;
    }

    if (tab === VISITS_TAB) {
      this.commitVisits(
        this.visits.map((visit) => (visit.id === localKey ? { ...visit, id: assignedId } : visit)),
      );
      this.queue = adoptId(this.queue, localKey, assignedId);
      this.persist();
      return;
    }

    if (tab === MEDIA_TAB) {
      this.media = this.media.map((link) =>
        link.id === localKey ? { ...link, id: assignedId } : link,
      );
      this.queue = adoptId(this.queue, localKey, assignedId);
      this.persist();
      return;
    }

    this.commit(
      this.places.map((place) => (place.id === localKey ? { ...place, id: assignedId } : place)),
    );
    // Visit rows and photo rows created against the temporary place id — in
    // memory and queued — have to follow it to the real one, or the sheet
    // would hold stays at a place that never existed there.
    this.commitVisits(
      this.visits.map((visit) =>
        visit.placeId === localKey ? { ...visit, placeId: assignedId } : visit,
      ),
    );
    this.media = this.media.map((link) =>
      link.placeId === localKey ? { ...link, placeId: assignedId } : link,
    );
    // "Place ID" is the visit column and the media column alike, so one pass
    // over the queue re-points both kinds of pending row.
    this.queue = adoptFieldValue(this.queue, VISIT_COLUMNS.placeId, localKey, assignedId);
    this.queue = adoptId(this.queue, localKey, assignedId);
    renameLocalPhotos(localKey, assignedId);
    this.persist();
  }

  /** Called when the browser says the network is back, and by "Sync now". */
  retryNow(): void {
    this.retryAttempt = 0;
    this.clearRetry();
    void this.flush();
  }

  /* ---------------------------------------------------------------- *
   * PlaceRepository
   * ---------------------------------------------------------------- */

  async getAll(): Promise<VisitedPlace[]> {
    return this.visible;
  }

  async getAllIncludingDeleted(): Promise<VisitedPlace[]> {
    return [...this.places];
  }

  async getById(id: string): Promise<VisitedPlace | null> {
    const found = this.places.find((place) => place.id === id);
    return found && !found.deletedAt ? found : null;
  }

  async replaceAll(places: VisitedPlace[]): Promise<VisitedPlace[]> {
    this.commit(places);
    this.persist();
    return this.visible;
  }

  async create(input: NewPlaceInput): Promise<VisitedPlace> {
    this.requireConnection();

    const now = new Date().toISOString();
    // The sheet hands out PL-0001 and the like, and it is the only thing that
    // can do so safely. Until the create lands, the record carries a local id.
    const place: VisitedPlace = {
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
      id: `${LOCAL_ID_PREFIX}${createId()}`,
      createdAt: now,
      updatedAt: now,
    };

    this.commit([place, ...this.places]);
    rememberLocalPhotos(place);
    this.persist();

    this.push({
      kind: "upsert",
      key: place.id,
      tab: PLACES_TAB,
      fields: fieldsFromChanges(place),
      queuedAt: now,
    });

    void this.syncPhotosToDrive();
    return place;
  }

  async update(id: string, changes: PlaceChanges): Promise<VisitedPlace> {
    this.requireConnection();

    const index = this.places.findIndex((place) => place.id === id);
    if (index === -1 || this.places[index].deletedAt) {
      throw new PersistenceError("That place no longer exists.");
    }

    // A form opened before the Drive sweep ran still holds local blob refs
    // for photos that have since been uploaded. Saving those refs as-is would
    // revert the link swap — and the blob behind them is already gone — so
    // they are translated to their uploaded links on the way in.
    if (this.uploadedPhotoUrls.size > 0) {
      const translate = (ref: string | undefined) =>
        ref ? (this.uploadedPhotoUrls.get(ref) ?? ref) : ref;
      if ("coverImage" in changes) changes = { ...changes, coverImage: translate(changes.coverImage) };
      if ("photos" in changes && changes.photos) {
        // De-duped: the translated ref and the already-swapped link are the
        // same picture, and it should not appear twice.
        changes = {
          ...changes,
          photos: [...new Set(changes.photos.map((photo) => translate(photo) as string))],
        };
      }
    }

    const previous = this.places[index];
    const merged: VisitedPlace = {
      ...previous,
      ...changes,
      id,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };

    if (typeof merged.latitude !== "number" || !isValidLatitude(merged.latitude)) {
      throw new PersistenceError("Those details couldn’t be saved. Check the location.");
    }
    merged.latitude = clampLatitude(merged.latitude);
    merged.longitude = normalizeLongitude(merged.longitude);
    if (!merged.name?.trim()) {
      throw new PersistenceError("Those details couldn’t be saved. Check the name.");
    }

    const next = [...this.places];
    next[index] = merged;
    this.commit(next);
    rememberLocalPhotos(merged);

    // A removed photo that had been uploaded leaves a Media_Links row behind;
    // take the row with it, or the photo would return on the next load.
    if ("photos" in changes || "coverImage" in changes) {
      const kept = new Set(remotePhotoRefs(merged));
      const dropped = remotePhotoRefs(previous).filter((url) => !kept.has(url));
      for (const url of dropped) {
        for (const link of this.media.filter((m) => m.placeId === id && m.url === url)) {
          this.media = this.media.filter((m) => m !== link);
          this.push({
            kind: "delete",
            key: link.id,
            id: link.id,
            tab: MEDIA_TAB,
            queuedAt: merged.updatedAt,
          });
        }
      }
    }

    this.persist();

    this.push({
      kind: "upsert",
      key: id,
      id,
      tab: PLACES_TAB,
      fields: fieldsFromChanges(changes, previous),
      queuedAt: merged.updatedAt,
    });

    void this.syncPhotosToDrive();
    return merged;
  }

  /**
   * Sets the tombstone here and Deleted? in the sheet. The row itself stays
   * exactly where it is — removing it would shift every row beneath and break
   * the formulas on Search_View and Dashboard.
   */
  async delete(id: string): Promise<void> {
    this.requireConnection();

    const index = this.places.findIndex((place) => place.id === id);
    if (index === -1 || this.places[index].deletedAt) return;

    const now = new Date().toISOString();
    const next = [...this.places];
    next[index] = { ...next[index], deletedAt: now, updatedAt: now };
    this.commit(next);
    this.persist();

    // The local-photos side table forgets the record whatever kind of id it
    // has — undo is unharmed, because restore() writes the entry back from
    // its snapshot. Only inside the isLocalId branch, a synced place's entry
    // would outlive the place forever and keep re-attaching refs on load.
    forgetLocalPhotos(id);

    // A record the sheet has never seen has nothing to soft-delete; the queue
    // drops its create instead. So do the visit and photo rows queued against
    // it — flushed, they would land in the sheet pointing at a place id that
    // never existed there.
    if (isLocalId(id)) {
      this.queue = this.queue.filter(
        (write) => !(write.kind === "upsert" && write.fields[VISIT_COLUMNS.placeId] === id),
      );
      saveQueue(this.queue);
      if (this.visits.some((visit) => visit.placeId === id && !visit.deletedAt)) {
        this.commitVisits(
          this.visits.map((visit) =>
            visit.placeId === id && !visit.deletedAt
              ? { ...visit, deletedAt: now, updatedAt: now }
              : visit,
          ),
        );
      }
      this.media = this.media.filter((link) => link.placeId !== id);
      this.persist();
    }

    this.push({ kind: "delete", key: id, id, tab: PLACES_TAB, queuedAt: now });
  }

  async updateCoordinates(id: string, latitude: number, longitude: number): Promise<VisitedPlace> {
    if (!isValidLatitude(latitude) || !isValidLongitude(normalizeLongitude(longitude))) {
      throw new PersistenceError("That location isn’t valid.");
    }
    return this.update(id, { latitude, longitude });
  }

  async restore(place: VisitedPlace): Promise<VisitedPlace> {
    this.requireConnection();

    const now = new Date().toISOString();
    const revived: VisitedPlace = { ...place, deletedAt: undefined, updatedAt: now };

    const index = this.places.findIndex((existing) => existing.id === place.id);
    const next = [...this.places];
    if (index === -1) next.unshift(revived);
    else next[index] = revived;
    next.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    this.commit(next);
    rememberLocalPhotos(revived);
    this.persist();

    this.push({
      kind: "upsert",
      key: revived.id,
      id: isLocalId(revived.id) ? undefined : revived.id,
      tab: PLACES_TAB,
      fields: { ...fieldsFromChanges(revived, place), [COLUMNS.deleted]: "No" },
      queuedAt: now,
    });

    return revived;
  }

  /* ---------------------------------------------------------------- *
   * Visits
   *
   * The same machinery again: the same queue, the same generic upsert and
   * delete, the same offline behaviour. A visit is a row on Dates_Visits that
   * points at its place; the place's own date columns are derived from its
   * visits and re-written whenever they change, so every screen that sorts or
   * groups on one date range keeps working untouched.
   * ---------------------------------------------------------------- */

  /** A trimmed id, followed through any adoption it has been through. */
  private resolveTrimmed(value: string | undefined): string | undefined {
    const cleaned = trimmed(value);
    return cleaned ? this.resolveId(cleaned) : undefined;
  }

  /** Trimmed to the columns this sheet's Dates_Visits tab actually has. */
  private visitFields(
    changes: VisitChanges | NewVisitInput,
    options: { isNew?: boolean; placeId?: string },
  ): Record<string, string> {
    return restrictToHeaders(fieldsFromVisitChanges(changes, options), this.visitHeaders);
  }

  /**
   * Logs a stay at a place.
   *
   * The first time a visit is logged against a place that recorded its dates
   * the old way — on the Places row, with no visit rows at all — those dates
   * are written down as a real visit first. The history the card showed
   * yesterday is the history the sheet holds today, and the new stay lands
   * beside it rather than instead of it.
   */
  async addVisit(
    placeId: string,
    input: NewVisitInput,
    options: {
      /**
       * Off when the caller is editing the implicit visit itself: the row
       * being written IS the old history, corrected, so writing the original
       * alongside it would double the first trip.
       */
      materializeImplicit?: boolean;
    } = {},
  ): Promise<PlaceVisit> {
    this.requireConnection();

    const id = this.resolveId(placeId);
    const place = this.places.find((candidate) => candidate.id === id);
    if (!place || place.deletedAt) throw new PersistenceError("That place no longer exists.");

    // An end date with no start still names when the stay was; it becomes the
    // start rather than an orphaned Last Visited Date.
    const startDate = trimmed(input.startDate) ?? trimmed(input.endDate);
    const endDate = trimmed(input.endDate) ?? startDate;
    if (startDate && endDate && endDate < startDate) {
      throw new PersistenceError("A visit can’t end before it starts.");
    }

    const now = new Date().toISOString();
    const creations: PlaceVisit[] = [];

    const hasReal = this.visits.some((visit) => visit.placeId === id && !visit.deletedAt);
    if (!hasReal && options.materializeImplicit !== false) {
      const implied = implicitVisit(place);
      if (implied) {
        creations.push({
          ...implied,
          id: `${LOCAL_ID_PREFIX}${createId()}`,
          placeId: id,
          status: visitStatusFor(implied.startDate),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const visit: PlaceVisit = {
      id: `${LOCAL_ID_PREFIX}${createId()}`,
      placeId: id,
      startDate,
      endDate,
      // Resolved: a form can hold a trip's temporary id after the trip's
      // create has landed and renamed it.
      tripId: this.resolveTrimmed(input.tripId),
      tripType: trimmed(input.tripType),
      status: trimmed(input.status) ?? visitStatusFor(startDate),
      notes: trimmed(input.notes),
      createdAt: now,
      updatedAt: now,
    };
    creations.push(visit);

    this.commitVisits([...creations, ...this.visits]);
    this.persist();

    for (const created of creations) {
      this.push({
        kind: "upsert",
        key: created.id,
        tab: VISITS_TAB,
        fields: this.visitFields(created, { isNew: true, placeId: id }),
        queuedAt: now,
      });
    }

    await this.syncVisitDerived(id);
    return visit;
  }

  async updateVisit(visitId: string, changes: VisitChanges): Promise<PlaceVisit> {
    this.requireConnection();

    // The caller may hold the id a form froze before the visit's create
    // landed; resolveId follows it to the row that actually exists.
    const id = this.resolveId(visitId);
    const index = this.visits.findIndex((visit) => visit.id === id);
    if (index === -1 || this.visits[index].deletedAt) {
      throw new PersistenceError("That visit no longer exists.");
    }

    const previous = this.visits[index];
    const merged: PlaceVisit = {
      ...previous,
      ...changes,
      id,
      placeId: previous.placeId,
      startDate: "startDate" in changes ? trimmed(changes.startDate) : previous.startDate,
      endDate: "endDate" in changes ? trimmed(changes.endDate) : previous.endDate,
      tripId: "tripId" in changes ? this.resolveTrimmed(changes.tripId) : previous.tripId,
      tripType: "tripType" in changes ? trimmed(changes.tripType) : previous.tripType,
      status: "status" in changes ? trimmed(changes.status) : previous.status,
      notes: "notes" in changes ? trimmed(changes.notes) : previous.notes,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };
    if (!merged.startDate && merged.endDate) {
      merged.startDate = merged.endDate;
    }
    if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) {
      throw new PersistenceError("A visit can’t end before it starts.");
    }

    const next = [...this.visits];
    next[index] = merged;
    this.commitVisits(next);
    this.persist();

    // Both dates always travel together, so the derived cells — Days, Year,
    // Month, Season — are computed from the pair the row will actually hold.
    // The merged values travel rather than the raw changes, so a resolved
    // trip id is what lands in the cell.
    this.push({
      kind: "upsert",
      key: id,
      id: isLocalId(id) ? undefined : id,
      tab: VISITS_TAB,
      fields: this.visitFields(
        {
          ...changes,
          startDate: merged.startDate,
          endDate: merged.endDate,
          ...("tripId" in changes ? { tripId: merged.tripId } : {}),
        },
        {},
      ),
      queuedAt: merged.updatedAt,
    });

    await this.syncVisitDerived(merged.placeId);
    return merged;
  }

  async deleteVisit(visitId: string): Promise<void> {
    this.requireConnection();

    // Resolved for the same reason as updateVisit — a silent no-op here
    // would leave the row alive under a success toast.
    const id = this.resolveId(visitId);
    const index = this.visits.findIndex((visit) => visit.id === id);
    if (index === -1 || this.visits[index].deletedAt) return;

    const now = new Date().toISOString();
    const next = [...this.visits];
    next[index] = { ...next[index], deletedAt: now, updatedAt: now };
    this.commitVisits(next);
    this.persist();

    this.push({ kind: "delete", key: id, id, tab: VISITS_TAB, queuedAt: now });

    await this.syncVisitDerived(next[index].placeId);
  }

  /**
   * Removes the implicit visit — the one that exists only as dates on the
   * Places row. Clearing the dates is most of it; the summary columns are
   * zeroed too, so the sheet doesn't keep counting a visit the card no
   * longer shows.
   */
  async clearImplicitVisit(placeId: string): Promise<void> {
    this.requireConnection();

    const id = this.resolveId(placeId);
    const place = this.places.find((candidate) => candidate.id === id);
    if (!place || place.deletedAt) return;

    await this.update(id, { visitedFrom: undefined, visitedTo: undefined });

    if (this.visits.some((visit) => visit.placeId === id && !visit.deletedAt)) return;
    this.push({
      kind: "upsert",
      key: id,
      id: isLocalId(id) ? undefined : id,
      tab: PLACES_TAB,
      fields: { [COLUMNS.visitCount]: "0", [COLUMNS.daysTotal]: "0" },
      queuedAt: new Date().toISOString(),
    });
  }

  /**
   * Re-derives a place's date columns from its visit rows.
   *
   * First/Last Visited Date, Visit Count and Days Spent Total all describe
   * the visits, so they are recomputed here — never edited directly — and a
   * place whose last visit was deleted goes honestly dateless. Logging a
   * dated visit against a wishlist place is also the moment it stops being a
   * wish, so the flag flips here too.
   */
  private async syncVisitDerived(placeId: string): Promise<void> {
    const id = this.resolveId(placeId);
    const place = this.places.find((candidate) => candidate.id === id);
    if (!place || place.deletedAt) return;

    let own = this.visits.filter((visit) => visit.placeId === id && !visit.deletedAt);

    /*
     * History that lives only on the Places row — a First Visited Date
     * earlier than any visit row — is written down before it can be
     * overwritten, or re-deriving the columns would erase a trip no row ever
     * recorded. Guarded against resurrection: a date any row (deleted ones
     * included) already reaches is known history, not missing history.
     */
    const rowSpan = visitSpan(own);
    const earliest = place.visitedFrom;
    if (
      earliest &&
      rowSpan.from &&
      earliest < rowSpan.from &&
      !this.visits.some(
        (visit) => visit.placeId === id && visit.startDate && visit.startDate <= earliest,
      )
    ) {
      const now = new Date().toISOString();
      const early: PlaceVisit = {
        id: `${LOCAL_ID_PREFIX}${createId()}`,
        placeId: id,
        startDate: earliest,
        endDate:
          place.visitedTo && place.visitedTo < rowSpan.from ? place.visitedTo : earliest,
        status: visitStatusFor(earliest),
        createdAt: now,
        updatedAt: now,
      };
      this.commitVisits([early, ...this.visits]);
      this.persist();
      this.push({
        kind: "upsert",
        key: early.id,
        tab: VISITS_TAB,
        fields: this.visitFields(early, { isNew: true, placeId: id }),
        queuedAt: now,
      });
      own = [early, ...own];
    }

    // Only stays that have happened count. A "Planned" trip next spring is
    // not a visit yet: it must not flip a wishlist place to been, extend the
    // visited span, or pad Days Spent Total.
    const happened = own.filter((visit) => !isUpcomingVisit(visit));
    const span = visitSpan(happened);
    const stats = visitStats(happened);

    const changes: PlaceChanges = {};
    if (place.visitedFrom !== span.from) changes.visitedFrom = span.from;
    if (place.visitedTo !== span.to) changes.visitedTo = span.to;
    if (place.wantToGo && span.from) changes.wantToGo = false;

    if (Object.keys(changes).length > 0) {
      await this.update(id, changes);
    }

    // The summary columns aren't part of the app's own model, so they ride
    // as extra cells — folded into the queued row write when one is waiting.
    const summary = {
      [COLUMNS.visitCount]: String(stats.count),
      [COLUMNS.daysTotal]: String(stats.daysTotal),
    };
    const current = this.places.find((candidate) => candidate.id === id);
    if (!current || current.deletedAt) return;
    this.push({
      kind: "upsert",
      key: current.id,
      id: isLocalId(current.id) ? undefined : current.id,
      tab: PLACES_TAB,
      fields: summary,
      queuedAt: new Date().toISOString(),
    });
  }

  /* ---------------------------------------------------------------- *
   * Cloud photos — Google Photos imports living in Drive
   * ---------------------------------------------------------------- */

  /**
   * A visit id photos can actually attach to.
   *
   * The implicit visit — the one a place's old-style dates imply — has no
   * row in the sheet, and the import validates its Visit ID against the
   * sheet. So attaching photos to it first writes it down for real, exactly
   * the way editing it does, and hands back the id of the real row.
   */
  async ensureRealVisit(placeId: string, visit: PlaceVisit): Promise<string> {
    if (!isImplicitVisitId(visit.id)) return this.resolveId(visit.id);

    const created = await this.addVisit(
      placeId,
      {
        startDate: visit.startDate,
        endDate: visit.endDate,
        tripId: visit.tripId,
        status: visitStatusFor(visit.startDate),
      },
      { materializeImplicit: false },
    );
    return created.id;
  }

  /**
   * Imports one confirmed batch of picked photos and folds the created rows
   * straight into memory, so the gallery fills in without a full reload.
   * The visit id is re-resolved at the moment of import — a visit created
   * seconds ago may have just been assigned its real sheet id.
   */
  async importGooglePhotos(request: {
    items: GooglePickedMedia[];
    placeId?: string;
    visitId?: string;
    tripId?: string;
  }): Promise<ImportItemResult[]> {
    this.requireConnection();
    const connection = this.connection;
    if (!connection) return [];

    const visitId = request.visitId ? this.resolveId(request.visitId) : undefined;
    if (visitId && isLocalId(visitId)) {
      throw new PersistenceError(
        "That visit hasn’t reached the sheet yet. Give it a moment to sync, then try again.",
      );
    }

    const result = await importPickedPhotos(connection, {
      items: request.items,
      placeId: request.placeId ? this.resolveId(request.placeId) : undefined,
      visitId,
      tripId: request.tripId ? this.resolveId(request.tripId) : undefined,
    });

    const created = travelPhotosFromTable(result.photos, new Date().toISOString());
    if (created.length > 0) {
      const known = new Set(created.map((photo) => photo.id));
      this.commitTravelPhotos([
        ...this.travelPhotos.filter((photo) => !known.has(photo.id)),
        ...created,
      ]);
      this.persist();
    }
    return result.results;
  }

  /**
   * One photo or video from the device, into Travel_Photos — the same tab,
   * association rules and renditions as a Google Photos import, with the
   * bytes coming from a picked file instead of a picking session. Online
   * only, like every other action that moves media: megabytes of clip have
   * no business in the localStorage write queue.
   */
  async addDeviceTravelMedia(request: {
    placeId?: string;
    visitId?: string;
    tripId?: string;
    media: PreparedDeviceMedia;
  }): Promise<{ status: "imported" | "duplicate"; clipStored: boolean }> {
    this.requireConnection();
    const connection = this.connection;
    if (!connection) throw new PersistenceError("Connect the app to your sheet first.");

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new PersistenceError("Adding photos and videos needs a connection. Try again when you’re back online.");
    }

    const resolvedOrFail = (id: string | undefined, what: string): string | undefined => {
      if (!id) return undefined;
      const resolved = this.resolveId(id);
      if (isLocalId(resolved)) {
        throw new PersistenceError(
          `That ${what} hasn’t reached the sheet yet. Give it a moment to sync, then try again.`,
        );
      }
      return resolved;
    };

    const media = request.media;
    const result = await uploadTravelMedia(connection, {
      placeId: resolvedOrFail(request.placeId, "place"),
      visitId: resolvedOrFail(request.visitId, "visit"),
      tripId: resolvedOrFail(request.tripId, "trip"),
      itemId: media.itemId,
      filename: media.filename,
      mimeType: media.mimeType,
      takenAt: media.takenAt,
      width: media.width,
      height: media.height,
      thumbData: await blobToBase64(media.thumb),
      displayData: await blobToBase64(media.display),
      videoData: media.clip ? await blobToBase64(media.clip) : undefined,
    });

    const created = travelPhotosFromTable(result.photos, new Date().toISOString());
    if (created.length > 0) {
      const known = new Set(created.map((photo) => photo.id));
      this.commitTravelPhotos([
        ...this.travelPhotos.filter((photo) => !known.has(photo.id)),
        ...created,
      ]);
      this.persist();
    }
    return { status: result.status, clipStored: result.clipStored };
  }

  /**
   * Removes one cloud photo. The script tombstones the metadata row and
   * tidies the Drive files; this side only has to forget what it cached.
   * Deliberately not queued: the delete touches Drive as well as the sheet,
   * so it is an online action and says so when it cannot run.
   */
  async removeTravelPhoto(id: string): Promise<void> {
    this.requireConnection();
    const connection = this.connection;
    if (!connection) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new PersistenceError("Removing a photo needs a connection. Try again when you’re back online.");
    }

    await deleteTravelPhotoRemote(connection, id);

    const now = new Date().toISOString();
    this.commitTravelPhotos(
      this.travelPhotos.map((photo) =>
        photo.id === id ? { ...photo, deletedAt: now, updatedAt: now } : photo,
      ),
    );
    this.persist();
    void forgetCachedPhoto(id);
  }

  /* ---------------------------------------------------------------- *
   * Photos to Drive
   *
   * A photo starts life as a blob in this browser's IndexedDB, which no other
   * device can see. When the deployed script says it can (photoUpload), each
   * local photo is sent up once, filed in the sheet owner's Drive, and the
   * place record swaps the blob reference for the link — which then syncs
   * through the sheet like any other cell, so the photo follows the account
   * rather than the browser. A failed upload changes nothing: the photo stays
   * local and the next sweep tries again.
   * ---------------------------------------------------------------- */

  private hasLocalPhotos(place: VisitedPlace): boolean {
    return [place.coverImage, ...(place.photos ?? [])].some(
      (ref) => typeof ref === "string" && isLocalPhotoRef(ref),
    );
  }

  async syncPhotosToDrive(): Promise<void> {
    if (this.photoSweepRunning) return;
    if (!this.connection || !this.capabilities.photoUpload) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    this.photoSweepRunning = true;
    try {
      // Ids are snapshotted but each place is re-read per photo: uploads are
      // slow, and the record may have been edited or deleted mid-sweep.
      const ids = this.visible.filter((place) => this.hasLocalPhotos(place)).map((p) => p.id);
      for (const placeId of ids) {
        const place = this.places.find((p) => p.id === this.resolveId(placeId));
        if (!place || place.deletedAt) continue;

        const refs = [place.coverImage, ...(place.photos ?? [])].filter(
          (ref): ref is string => typeof ref === "string" && isLocalPhotoRef(ref),
        );
        for (const ref of refs) {
          // A photo the script has permanently refused would fail identically
          // every time; re-sending megabytes to hear "no" again would also
          // wedge every photo queued behind it.
          if (this.refusedPhotoRefs.has(ref)) continue;
          const ok = await this.uploadOnePhoto(place.id, ref);
          // Network trouble ends the sweep; the next load or save retries.
          if (!ok) return;
        }
      }
    } finally {
      this.photoSweepRunning = false;
    }
  }

  /** True unless the upload failed in a way worth stopping the sweep for. */
  private async uploadOnePhoto(placeId: string, ref: string): Promise<boolean> {
    const connection = this.connection;
    if (!connection) return false;

    let blob: Blob | null = null;
    try {
      blob = await getPhoto(ref);
    } catch {
      blob = null;
    }
    // A reference whose blob is gone can never upload; skip it rather than
    // wedging the sweep on it forever.
    if (!blob) return true;

    try {
      const data = await blobToBase64(blob);
      const current = this.places.find((p) => p.id === this.resolveId(placeId));
      if (!current || current.deletedAt) return true;

      const upload = await uploadPhoto(connection, {
        name: `${(current.name || "photo").slice(0, 60)} ${ref.slice(6, 14)}.jpg`,
        mimeType: blob.type || "image/jpeg",
        data,
      });

      // The upload can take seconds, and the place's queued create may land
      // meanwhile — adoptRemotePhoto re-resolves the id itself. The blob is
      // only ever deleted once the swap has actually been recorded; deleting
      // it on a miss would destroy the one copy of the photo.
      const swapped = await this.adoptRemotePhoto(current.id, ref, upload.url);
      if (swapped) void deletePhoto(ref);
      return true;
    } catch (error) {
      // Only a network that went away or a request that timed out is worth
      // stopping the sweep for — those heal on their own. Anything the script
      // actually answered — "too large", "not an image", a sharing policy —
      // would be refused identically on every retry, so the photo stays
      // local, is skipped for the rest of this session, and the photos
      // queued behind it still get their turn.
      if (error instanceof SheetError && error.kind !== "network" && error.kind !== "timeout") {
        this.refusedPhotoRefs.add(ref);
        return true;
      }
      return false;
    }
  }

  /**
   * Swaps a local reference for its uploaded link, and records the upload.
   * Answers whether the swap was actually written — the caller must not
   * delete the local blob otherwise.
   */
  private async adoptRemotePhoto(placeId: string, ref: string, url: string): Promise<boolean> {
    const place = this.places.find((p) => p.id === this.resolveId(placeId));
    if (!place || place.deletedAt) return false;

    // Remembered before the update: an edit form opened earlier still holds
    // the local ref, and saving it would otherwise put the blob reference
    // back over the link. `update` translates through this map instead.
    this.uploadedPhotoUrls.set(ref, url);

    const changes: PlaceChanges = {};
    if (place.coverImage === ref) changes.coverImage = url;
    if (place.photos?.includes(ref)) {
      changes.photos = place.photos.map((photo) => (photo === ref ? url : photo));
    }
    if (Object.keys(changes).length === 0) return false;

    await this.update(place.id, changes);

    // The Media_Links row is what makes the photo appear on other devices —
    // the Photo URL column only carries the cover.
    const now = new Date().toISOString();
    const mediaId = `${LOCAL_ID_PREFIX}${createId()}`;
    this.media = [...this.media, { id: mediaId, placeId: place.id, url }];
    this.push({
      kind: "upsert",
      key: mediaId,
      tab: MEDIA_TAB,
      fields: restrictToHeaders(
        {
          [MEDIA_COLUMNS.placeId]: place.id,
          [MEDIA_COLUMNS.type]: MEDIA_TYPE_PHOTO,
          [MEDIA_COLUMNS.title]: place.name,
          [MEDIA_COLUMNS.url]: url,
          [MEDIA_COLUMNS.deleted]: "No",
          [MEDIA_COLUMNS.archived]: "No",
        },
        this.mediaHeaders,
      ),
      queuedAt: now,
    });
    this.persist();
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Trips
   *
   * Deliberately the same machinery as places: the same queue, the same
   * generic upsert and delete on the sheet, the same offline behaviour. A trip
   * is another row in another tab, not another system.
   * ---------------------------------------------------------------- */

  async getTrips(): Promise<Trip[]> {
    return this.visibleTrips;
  }

  async createTrip(input: NewTripInput): Promise<Trip> {
    this.requireConnection();

    const name = input.name?.trim();
    if (!name) throw new PersistenceError("A trip needs a name.");
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new PersistenceError("The end of a trip can’t come before its start.");
    }

    const now = new Date().toISOString();
    // As with places, the sheet hands out TRIP-0001 and the like. Until the
    // create lands, the trip carries a local id — and anything assigned to it
    // in the meantime is re-pointed when the real id arrives.
    const trip: Trip = {
      ...input,
      id: `${LOCAL_ID_PREFIX}${createId()}`,
      name,
      startDate: trimmed(input.startDate),
      endDate: trimmed(input.endDate),
      description: trimmed(input.description),
      coverPlaceId: trimmed(input.coverPlaceId),
      createdAt: now,
      updatedAt: now,
    };

    this.commitTrips([trip, ...this.trips]);
    this.persist();

    this.push({
      kind: "upsert",
      key: trip.id,
      tab: TRIPS_TAB,
      fields: fieldsFromTripChanges(trip),
      queuedAt: now,
    });

    return trip;
  }

  async updateTrip(id: string, changes: TripChanges): Promise<Trip> {
    this.requireConnection();

    const index = this.trips.findIndex((trip) => trip.id === id);
    if (index === -1 || this.trips[index].deletedAt) {
      throw new PersistenceError("That trip no longer exists.");
    }

    const previous = this.trips[index];
    const merged: Trip = {
      ...previous,
      ...changes,
      id,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };

    if (!merged.name?.trim()) throw new PersistenceError("A trip needs a name.");
    merged.name = merged.name.trim();
    if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) {
      throw new PersistenceError("The end of a trip can’t come before its start.");
    }

    const next = [...this.trips];
    next[index] = merged;
    this.commitTrips(next);
    this.persist();

    this.push({
      kind: "upsert",
      key: id,
      id: isLocalId(id) ? undefined : id,
      tab: TRIPS_TAB,
      fields: fieldsFromTripChanges(changes),
      queuedAt: merged.updatedAt,
    });

    return merged;
  }

  /**
   * Removes the trip and nothing else.
   *
   * Every place that belonged to it has its trip cell cleared and stays
   * exactly where it was — in the history, on the globe, on the timeline. A
   * trip is a label on a set of visits, and taking the label off is not the
   * same as throwing the visits away.
   */
  async deleteTrip(id: string): Promise<void> {
    this.requireConnection();

    const index = this.trips.findIndex((trip) => trip.id === id);
    if (index === -1 || this.trips[index].deletedAt) return;

    const now = new Date().toISOString();

    // The places first: if the run is interrupted, a trip with no members is a
    // far better half-state than members pointing at a trip that is gone.
    for (const place of this.places) {
      if (place.tripId !== id || place.deletedAt) continue;
      await this.update(place.id, { tripId: undefined });
    }

    const next = [...this.trips];
    next[index] = { ...next[index], deletedAt: now, updatedAt: now };
    this.commitTrips(next);
    this.persist();

    this.push({ kind: "delete", key: id, id, tab: TRIPS_TAB, queuedAt: now });
  }

  private requireConnection(): void {
    if (!this.connection) {
      throw new PersistenceError(
        "This browser isn’t connected to your sheet yet. Open settings and add the connection.",
      );
    }
  }
}

export const sheetPlaceRepository = new SheetPlaceRepository();
