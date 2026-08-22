import type { VisitedPlace } from "@/types/place";

/**
 * Tagging several places into a trip at once.
 *
 * Assigning places one at a time through the edit form is fine for one place
 * and miserable for eight, which is the normal case after a trip: you come
 * home, add everywhere you went, and only then decide they belong together.
 * The rules for doing it in bulk are here, away from the components, because
 * they are the part that is easy to get quietly wrong — writing a trip onto
 * places that already have it, or reporting "8 moved" when 8 were selected and
 * 3 already belonged.
 */

/** How much of a selection already belongs to one trip. */
export type TagState = "all" | "some" | "none";

export function tagState(selected: VisitedPlace[], tripId: string): TagState {
  if (selected.length === 0) return "none";
  const inTrip = selected.filter((place) => place.tripId === tripId).length;
  if (inTrip === selected.length) return "all";
  return inTrip > 0 ? "some" : "none";
}

/**
 * The places a tag would actually change.
 *
 * A place already in the target trip is skipped rather than rewritten: every
 * write is a queued row update against the sheet, and re-stamping a value that
 * is already there costs a round trip and bumps `Updated At` for no reason.
 * `null` means "take these out of whatever trip they are in", which skips the
 * places that were not in one.
 */
export function placesToRetag(
  selected: VisitedPlace[],
  tripId: string | null,
): VisitedPlace[] {
  return selected.filter((place) => (place.tripId ?? "") !== (tripId ?? ""));
}

/** Whether "take them out of their trip" is worth offering at all. */
export function canUntag(selected: VisitedPlace[]): boolean {
  return selected.some((place) => Boolean(place.tripId));
}

/**
 * What to say afterwards.
 *
 * Names the count that changed, not the count that was selected — "3 places
 * added to Japan 2026" when five were ticked and two were already in it is the
 * truth, and the difference is exactly what someone would otherwise wonder
 * about.
 */
export function tagSummary(changed: number, tripName: string | null): string {
  const places = `${changed} ${changed === 1 ? "place" : "places"}`;
  return tripName ? `${places} added to ${tripName}` : `${places} removed from their trip`;
}

/** Nothing to do, said in a way that explains why rather than just refusing. */
export function alreadyTaggedMessage(count: number, tripName: string | null): string {
  const subject = count === 1 ? "That place is" : `All ${count} places are`;
  return tripName ? `${subject} already in ${tripName}` : `${subject} not in a trip`;
}
