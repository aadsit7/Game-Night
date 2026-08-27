import type { LocationResult, NewPlaceInput, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";
import { isOffWorldPlace } from "@/lib/space/moonPlaces";
import { hasValidCoordinates } from "@/lib/utils/geo";

/**
 * The shape a place takes while it is being written.
 *
 * It lives above the form component rather than inside it, because adding a
 * place can detour through the globe to place a pin — and a half-filled form
 * must survive that trip intact.
 */
export type PlaceDraft = {
  /** Present when editing an existing record. */
  id?: string;
  name: string;
  city: string;
  region: string;
  country: string;
  countryCode?: string;
  latitude: number | null;
  longitude: number | null;
  visitedFrom: string;
  visitedTo: string;
  notes: string;
  favorite: boolean;
  /** Somewhere still to go. A wishlist entry has no visit date. */
  wantToGo: boolean;
  /** The trip this visit belongs to. Empty means it belongs to none. */
  tripId: string;
  /** Ordered; the first entry is the cover photo. */
  photos: string[];
  /** What the geocoder called this spot, shown as the location subtitle. */
  locationLabel: string;
  /** Google's listing id, when the location came from a Google result. */
  googlePlaceId: string;
};

export function emptyDraft(): PlaceDraft {
  return {
    name: "",
    city: "",
    region: "",
    country: "",
    latitude: null,
    longitude: null,
    visitedFrom: "",
    visitedTo: "",
    notes: "",
    favorite: false,
    wantToGo: false,
    tripId: "",
    photos: [],
    locationLabel: "",
    googlePlaceId: "",
  };
}

/**
 * Sets the start date, bringing the end date along with it.
 *
 * A trip is usually entered start-first, and most end dates are the same day
 * or a few days after. Leaving the end date empty means its picker opens on
 * today — so someone recording a trip two years ago has to scroll two years
 * back a second time, having just done it once. Seeding it from the start
 * removes that entirely: the common case is already right, and a longer trip
 * is a nudge from there rather than a journey.
 *
 * An end date the person actually chose is never moved. "Chose" means it
 * differs from the start date it was seeded with — anything still matching is
 * treated as following along.
 */
export function withVisitStart(draft: PlaceDraft, from: string): PlaceDraft {
  const wasTracking = !draft.visitedTo || draft.visitedTo === draft.visitedFrom;

  // Calendar dates are `YYYY-MM-DD`, so comparing them as strings orders them
  // correctly without parsing.
  const endsBeforeItStarts = Boolean(from && draft.visitedTo && draft.visitedTo < from);

  return {
    ...draft,
    visitedFrom: from,
    visitedTo: wasTracking || endsBeforeItStarts ? from : draft.visitedTo,
  };
}

/**
 * Reveals the end date with the start date already in it, for the same reason:
 * the field should open where the trip is, not where today is.
 */
export function withEndDateShown(draft: PlaceDraft): PlaceDraft {
  if (draft.visitedTo) return draft;
  return { ...draft, visitedTo: draft.visitedFrom };
}

/**
 * Moves a draft between "been here" and "want to go".
 *
 * A place still to go has no visit date, so the dates are dropped on the way
 * to the wishlist — visibly, since the fields go with them, and before
 * anything is saved, so backing out of the form costs nothing. Coming back the
 * other way leaves the fields empty rather than resurrecting a date the person
 * may no longer mean.
 */
export function withWantToGo(draft: PlaceDraft, wantToGo: boolean): PlaceDraft {
  if (draft.wantToGo === wantToGo) return draft;
  return wantToGo
    ? { ...draft, wantToGo, visitedFrom: "", visitedTo: "" }
    : { ...draft, wantToGo };
}

/**
 * Puts a draft in a trip, and dates it if it has no date of its own.
 *
 * A trip is laid out day by day, and a place with no date has no day to sit
 * under — it falls into a "no date yet" bucket at the bottom, which is the
 * opposite of what adding it to a trip was meant to achieve. The trip's own
 * start date is the honest first guess: it is the day the trip began, it is
 * one tap to move, and it puts the place on Day 1 rather than in a footnote.
 *
 * Only ever fills a blank. A date already typed is never overwritten, and a
 * place on the wishlist stays undated, because it has not been visited at all.
 */
export function withTrip(
  draft: PlaceDraft,
  tripId: string,
  trip: Pick<Trip, "startDate"> | undefined,
): PlaceDraft {
  const next = { ...draft, tripId };
  if (!tripId || next.wantToGo || next.visitedFrom || !trip?.startDate) return next;
  return { ...next, visitedFrom: trip.startDate, visitedTo: trip.startDate };
}

export function draftFromPlace(place: VisitedPlace): PlaceDraft {
  return {
    id: place.id,
    name: place.name,
    city: place.city ?? "",
    region: place.region ?? "",
    country: place.country ?? "",
    countryCode: place.countryCode,
    latitude: place.latitude,
    longitude: place.longitude,
    visitedFrom: place.visitedFrom ?? "",
    visitedTo: place.visitedTo ?? "",
    notes: place.notes ?? "",
    favorite: Boolean(place.favorite),
    wantToGo: Boolean(place.wantToGo),
    tripId: place.tripId ?? "",
    photos: [place.coverImage, ...(place.photos ?? [])].filter(
      (photo): photo is string => Boolean(photo),
    ),
    locationLabel: [place.city, place.region, place.country]
      .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index)
      .join(", "),
    googlePlaceId: place.googlePlaceId ?? "",
  };
}

/** Everything a geocoder result can pre-fill, so the form opens nearly done. */
export function applyLocation(draft: PlaceDraft, result: LocationResult): PlaceDraft {
  // Somewhere off Earth has no flag, and must not inherit the one the draft
  // was carrying before: a lunar record wearing Portugal's colours would be
  // painted over Portugal on the globe.
  const offWorld = isOffWorldPlace({ country: result.country ?? "" });

  return {
    ...draft,
    // Keep a name the traveller has already personalised.
    name: draft.name.trim() ? draft.name : result.name,
    city: offWorld ? "" : (result.city ?? draft.city),
    region: result.region ?? draft.region,
    country: result.country ?? draft.country,
    countryCode: offWorld ? undefined : (result.countryCode ?? draft.countryCode),
    latitude: result.latitude,
    longitude: result.longitude,
    locationLabel: result.context || result.name,
    // Choosing a location re-anchors the record: a Google result brings its
    // listing id, and any other provider clears the one that no longer
    // describes where the pin now is.
    googlePlaceId: result.googlePlaceId ?? "",
  };
}

export function draftFromLocation(result: LocationResult): PlaceDraft {
  return applyLocation(emptyDraft(), result);
}

export function isDraftValid(draft: PlaceDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    hasValidCoordinates({ latitude: draft.latitude, longitude: draft.longitude })
  );
}

export function draftToInput(draft: PlaceDraft): NewPlaceInput {
  const [cover, ...rest] = draft.photos;
  return {
    name: draft.name.trim(),
    city: draft.city.trim() || undefined,
    region: draft.region.trim() || undefined,
    country: draft.country.trim(),
    countryCode: draft.countryCode,
    latitude: draft.latitude as number,
    longitude: draft.longitude as number,
    // Somewhere still to go has not been visited, so it carries no visit date.
    visitedFrom: draft.wantToGo ? undefined : draft.visitedFrom || undefined,
    // An end date without a start date has no meaning.
    visitedTo:
      !draft.wantToGo && draft.visitedFrom && draft.visitedTo ? draft.visitedTo : undefined,
    notes: draft.notes.trim() || undefined,
    favorite: draft.favorite,
    wantToGo: draft.wantToGo,
    // Always present, even when empty: an absent key would leave the sheet's
    // existing cell alone, and clearing the trip is a thing a person does.
    tripId: draft.tripId.trim() || undefined,
    coverImage: cover,
    photos: rest.length > 0 ? rest : undefined,
    googlePlaceId: draft.googlePlaceId.trim() || undefined,
  };
}

/** Used to decide whether closing the form needs a confirmation. */
export function isDraftDirty(current: PlaceDraft, original: PlaceDraft): boolean {
  const keys: Array<keyof PlaceDraft> = [
    "name",
    "city",
    "region",
    "country",
    "latitude",
    "longitude",
    "visitedFrom",
    "visitedTo",
    "notes",
    "favorite",
    "wantToGo",
    "tripId",
    "googlePlaceId",
  ];
  if (keys.some((key) => current[key] !== original[key])) return true;
  if (current.photos.length !== original.photos.length) return true;
  return current.photos.some((photo, index) => photo !== original.photos[index]);
}
