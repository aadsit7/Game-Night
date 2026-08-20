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
  PLACES_TAB,
  TRIPS_TAB,
  VISITS_TAB,
  applyVisitSpans,
  fieldsFromChanges,
  fieldsFromTripChanges,
  placesFromTable,
  tripsFromTable,
  visitSpans,
} from "@/lib/sheets/mapping";
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
import { SheetError, deleteRow, getAll, upsertRow } from "@/lib/sheets/sheetsClient";
import { PersistenceError, type PlaceRepository } from "@/lib/storage/placeRepository";
import { createId } from "@/lib/utils/id";
import { clampLatitude, isValidLatitude, isValidLongitude, normalizeLongitude } from "@/lib/utils/geo";
import type { NewPlaceInput, PlaceChanges, VisitedPlace } from "@/types/place";
import type { NewTripInput, Trip, TripChanges } from "@/types/trip";

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

  private lookups: Record<string, string[]> = {};
  private settings: Record<string, string> = {};
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

  getLookups(): Record<string, string[]> {
    return this.lookups;
  }

  getSettings(): Record<string, string> {
    return this.settings;
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
      this.commitTrips(cached.trips);
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
    clearConnection();
    clearCache();
    this.commitTrips([]);
    this.commit([]);

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
      const visits = snapshot.tabs[VISITS_TAB];
      const withSpans = visits ? applyVisitSpans(fromSheet, visitSpans(visits)) : fromSheet;

      // A sheet whose script predates trips has no Trips tab. That is not a
      // failure — it simply has no trips, and everything else loads as before.
      this.commitTrips(
        this.overlayPendingTrips(tripsFromTable(snapshot.tabs[TRIPS_TAB], snapshot.serverTime)),
      );
      this.commit(applyLocalPhotos(this.overlayPending(withSpans)));
      this.lookups = snapshot.lookups;
      this.settings = snapshot.settings;

      this.persist();
      this.setStatus({
        phase: this.queue.length > 0 ? "saving" : "idle",
        error: null,
        lastSyncedAt: new Date().toISOString(),
      });

      void this.flush();
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

  private persist(): void {
    saveCache({
      places: this.places,
      trips: this.trips,
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
      this.queue = adoptFieldValue(this.queue, COLUMNS.tripId, localKey, assignedId);
      this.queue = adoptId(this.queue, localKey, assignedId);
      this.persist();
      return;
    }

    this.commit(
      this.places.map((place) => (place.id === localKey ? { ...place, id: assignedId } : place)),
    );
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

    return place;
  }

  async update(id: string, changes: PlaceChanges): Promise<VisitedPlace> {
    this.requireConnection();

    const index = this.places.findIndex((place) => place.id === id);
    if (index === -1 || this.places[index].deletedAt) {
      throw new PersistenceError("That place no longer exists.");
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
    this.persist();

    this.push({
      kind: "upsert",
      key: id,
      id,
      tab: PLACES_TAB,
      fields: fieldsFromChanges(changes, previous),
      queuedAt: merged.updatedAt,
    });

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

    // A record the sheet has never seen has nothing to soft-delete; the queue
    // drops its create instead, and the local photo record goes with it.
    if (isLocalId(id)) forgetLocalPhotos(id);

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
