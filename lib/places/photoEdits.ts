import type { PlaceChanges, VisitedPlace } from "@/types/place";

/**
 * Editing a place's photographs from where they are looked at.
 *
 * The record keeps one cover and a list behind it; these fold a "delete
 * this" or "lead with this" tap into the change that keeps that shape
 * honest. Both return the exact fields to save — including the keys that
 * must be present-but-empty, because an absent key means "leave the cell
 * alone" all the way down to the sheet, and clearing a cover is a thing a
 * person does.
 */

/** All of a place's photo refs, cover first — the order a viewer shows. */
export function placePhotoRefs(place: Pick<VisitedPlace, "coverImage" | "photos">): string[] {
  return [place.coverImage, ...(place.photos ?? [])].filter(
    (ref): ref is string => Boolean(ref),
  );
}

/**
 * Removes one photo. Deleting the cover promotes the next photo rather than
 * leaving a decapitated card; deleting the last photo clears both fields.
 * Null when the place doesn't hold that photo — nothing to save.
 */
export function removePlacePhoto(
  place: Pick<VisitedPlace, "coverImage" | "photos">,
  ref: string,
): PlaceChanges | null {
  if (place.coverImage === ref) {
    const [promoted, ...rest] = place.photos ?? [];
    return { coverImage: promoted, photos: rest.length > 0 ? rest : undefined };
  }
  if (!place.photos?.includes(ref)) return null;
  const rest = place.photos.filter((photo) => photo !== ref);
  return { photos: rest.length > 0 ? rest : undefined };
}

/**
 * Leads with a different photo. The old cover steps back into the list —
 * making a cover never deletes anything. Null when the tap changes nothing.
 */
export function makeCoverPhoto(
  place: Pick<VisitedPlace, "coverImage" | "photos">,
  ref: string,
): PlaceChanges | null {
  if (place.coverImage === ref) return null;
  const refs = placePhotoRefs(place);
  if (!refs.includes(ref)) return null;
  const rest = refs.filter((photo) => photo !== ref);
  return { coverImage: ref, photos: rest.length > 0 ? rest : undefined };
}
