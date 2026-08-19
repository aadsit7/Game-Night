/**
 * The canonical travel record. Everything the app renders — every pin on the
 * globe, every card in the list — is derived from a collection of these.
 *
 * Deliberately extensible: trips, companions, favourites and ratings can be
 * layered on later as optional fields without migrating existing records.
 */
export type VisitedPlace = {
  id: string;
  name: string;
  city?: string;
  region?: string;
  country: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  /** ISO calendar date, `YYYY-MM-DD`. */
  visitedFrom?: string;
  /** ISO calendar date, `YYYY-MM-DD`. Only meaningful alongside `visitedFrom`. */
  visitedTo?: string;
  notes?: string;
  /** Photo reference — either `photo:<uuid>` (local blob) or an absolute URL. */
  coverImage?: string;
  photos?: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * Tombstone. A deleted place is kept as a record with this set, rather than
   * dropped, so the deletion can travel to other devices — otherwise a device
   * that still has the row would simply put it back on the next sync.
   * Everything above the repository filters these out.
   */
  deletedAt?: string;
};

/** Fields a caller supplies when creating a place; the rest is generated. */
export type NewPlaceInput = Omit<VisitedPlace, "id" | "createdAt" | "updatedAt">;

/** A partial patch. `id` and `createdAt` are immutable once assigned. */
export type PlaceChanges = Partial<Omit<VisitedPlace, "id" | "createdAt">>;

export type PlaceSort =
  | "recentlyAdded"
  | "recentlyVisited"
  | "oldestVisited"
  | "name"
  | "country";

export const PLACE_SORT_LABELS: Record<PlaceSort, string> = {
  recentlyAdded: "Recently added",
  recentlyVisited: "Recently visited",
  oldestVisited: "Oldest visited",
  name: "Name",
  country: "Country",
};

/** A geocoded real-world location, before it becomes a saved place. */
export type LocationResult = {
  id: string;
  /** Primary label, e.g. "Basílica de la Sagrada Família". */
  name: string;
  /** Secondary label, e.g. "Barcelona, Spain". */
  context: string;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  /** Broad category from the geocoder, used only to pick an icon. */
  kind?: string;
};
