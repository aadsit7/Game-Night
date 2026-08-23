/**
 * The first-class visit model.
 *
 * A place is somewhere; a visit is a dated experience of being there — a
 * stay, or a whole period of living there. Both are rows of the sheet's
 * Dates_Visits tab, and both are the unit photos attach to: a photo belongs
 * to the February trip, not to Salt Lake City in the abstract.
 *
 * The type itself lives in `types/place.ts` as `PlaceVisit`, where it grew up
 * beside the place it points at; this module gives it its own front door and
 * the vocabulary that separates a visit from a residence. One model, two
 * names — deliberately not a second system.
 */

export type {
  PlaceVisit as Visit,
  PlaceVisit,
  NewVisitInput,
  VisitChanges,
} from "@/types/place";

/**
 * The Visit Status words this app understands, spelled the way the sheet's
 * Lookups tab spells them. Anything else found in a cell — "Booked",
 * "Considering", "Passed through" — is kept exactly as written.
 */
export const VISIT_STATUS_LIVED = "Lived there";
