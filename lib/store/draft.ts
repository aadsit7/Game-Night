import type { LocationResult, NewPlaceInput, VisitedPlace } from "@/types/place";
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
  /** Ordered; the first entry is the cover photo. */
  photos: string[];
  /** What the geocoder called this spot, shown as the location subtitle. */
  locationLabel: string;
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
    photos: [],
    locationLabel: "",
  };
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
    photos: [place.coverImage, ...(place.photos ?? [])].filter(
      (photo): photo is string => Boolean(photo),
    ),
    locationLabel: [place.city, place.region, place.country]
      .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index)
      .join(", "),
  };
}

/** Everything a geocoder result can pre-fill, so the form opens nearly done. */
export function applyLocation(draft: PlaceDraft, result: LocationResult): PlaceDraft {
  return {
    ...draft,
    // Keep a name the traveller has already personalised.
    name: draft.name.trim() ? draft.name : result.name,
    city: result.city ?? draft.city,
    region: result.region ?? draft.region,
    country: result.country ?? draft.country,
    countryCode: result.countryCode ?? draft.countryCode,
    latitude: result.latitude,
    longitude: result.longitude,
    locationLabel: result.context || result.name,
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
    visitedFrom: draft.visitedFrom || undefined,
    // An end date without a start date has no meaning.
    visitedTo: draft.visitedFrom && draft.visitedTo ? draft.visitedTo : undefined,
    notes: draft.notes.trim() || undefined,
    coverImage: cover,
    photos: rest.length > 0 ? rest : undefined,
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
  ];
  if (keys.some((key) => current[key] !== original[key])) return true;
  if (current.photos.length !== original.photos.length) return true;
  return current.photos.some((photo, index) => photo !== original.photos[index]);
}
