import type { NewPlaceInput, PlaceChanges, VisitedPlace } from "@/types/place";

/**
 * The one seam between the app and where travel data lives.
 *
 * Every read and write in the UI goes through this interface, which is what
 * made moving the collection from this browser into a Google Sheet a matter of
 * writing a second implementation rather than touching a single screen. The
 * implementation now in use is `sheetPlaceRepository`.
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
  /** Overwrites the collection wholesale, e.g. with a freshly loaded remote state. */
  replaceAll(places: VisitedPlace[]): Promise<VisitedPlace[]>;
}

/**
 * A failure a person can act on. Anything thrown out of a repository is
 * expected to be one of these, so the UI can show the message as written.
 */
export class PersistenceError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    this.cause = cause;
  }
}
