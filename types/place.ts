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
  /**
   * Saved as a favourite. The one mark that says "this one mattered", kept
   * separate from every other kind of note so it can be found in a tap.
   */
  favorite?: boolean;
  /**
   * Somewhere still to go, rather than somewhere been.
   *
   * A travel record is half memory and half intention, and the two behave
   * differently: a place you want to go has no visit date, takes no place in
   * the chronology, and does not count towards the countries you have seen.
   */
  wantToGo?: boolean;
  /**
   * The trip this visit belongs to, if any. Optional by design: a place
   * recorded before trips existed — or one that simply isn't part of a trip —
   * carries a blank cell in the sheet and no trip here.
   */
  tripId?: string;
  /** Photo reference — either `photo:<uuid>` (local blob) or an absolute URL. */
  coverImage?: string;
  photos?: string[];
  /**
   * Google's own id for this place, kept from the search result that created
   * it. It is what turns "Open in Google Maps" from a pin at some coordinates
   * into the actual listing — hours, photos, reviews. Set only when Google
   * answered the search; replaced or cleared when a different location is
   * chosen; deliberately kept when a pin is nudged, because adjusting a pin
   * corrects the placement of the same place rather than choosing a new one.
   */
  googlePlaceId?: string;
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

/**
 * One stay at a place — a row of the sheet's Dates_Visits tab.
 *
 * A place is somewhere; a visit is a time you were there. Keeping them apart
 * is what lets Salt Lake City be one pin with four date ranges instead of four
 * pins, and it is why adding somewhere you have already been can mean "log
 * another visit" rather than "make a duplicate".
 */
export type PlaceVisit = {
  /** The sheet's own id, e.g. `VIS-0001`. Local until the create lands. */
  id: string;
  placeId: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  startDate?: string;
  /** ISO calendar date, `YYYY-MM-DD`. Only meaningful alongside `startDate`. */
  endDate?: string;
  /** The trip this particular visit belonged to, if any. */
  tripId?: string;
  /** The sheet's own vocabulary — "Family", "Solo", "Study"… Free text is fine. */
  tripType?: string;
  /**
   * The sheet's Visit Status word — "Been", "Planned", "Lived there"… Never
   * invented here. "Lived there" is what makes a row a residence rather than
   * a stay; see `isResidenceVisit`.
   */
  status?: string;
  /** The Highlights cell: what made this stay this stay. */
  notes?: string;
  /** The Companions cell, kept as the sheet wrote it. */
  companions?: string;
  /** The Accommodation Name cell. */
  accommodationName?: string;
  createdAt: string;
  updatedAt: string;
  /** Tombstone, for the same reason places have one. */
  deletedAt?: string;
};

/** Fields a caller supplies when logging a visit; the rest is generated. */
export type NewVisitInput = Omit<PlaceVisit, "id" | "placeId" | "createdAt" | "updatedAt">;

/** A partial patch. `id`, `placeId` and `createdAt` are immutable once assigned. */
export type VisitChanges = Partial<Omit<PlaceVisit, "id" | "placeId" | "createdAt">>;

/** A partial patch. `id` and `createdAt` are immutable once assigned. */
export type PlaceChanges = Partial<Omit<VisitedPlace, "id" | "createdAt">>;

/** The two ways to slice the collection, beyond a country. */
export type PlaceFilter = "all" | "favorites" | "been" | "wantToGo";

export const PLACE_FILTER_LABELS: Record<PlaceFilter, string> = {
  all: "All",
  favorites: "Favorites",
  been: "Been",
  wantToGo: "Want to go",
};

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
  /**
   * The full street address, when the provider knows one. What tells four
   * branches of the same coffee shop apart in a list of results.
   */
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  /** Broad category from the geocoder, used only to pick an icon. */
  kind?: string;
  /** Which service answered. Shown as attribution, and nothing else. */
  source?: "google" | "osm";
  /** Google's id for the listing, present only when Google answered. */
  googlePlaceId?: string;
};
