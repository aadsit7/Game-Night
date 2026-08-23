import { angularDistance } from "@/lib/utils/geo";
import type { NewPlaceInput, VisitedPlace } from "@/types/place";

/**
 * Recognising "you've saved this before" at the moment of saving it again.
 *
 * Adding a place you have already been to should log another visit on the
 * existing record, not grow a twin pin — otherwise the globe slowly fills with
 * duplicates and none of them tells the whole story. The recognition has to be
 * conservative: merging two places that are genuinely different loses a real
 * record, while missing a duplicate merely leaves things as they were. So a
 * match takes either the same name in the same country, or coordinates close
 * enough that the geocoder plainly returned the same spot.
 */

/** One degree of great circle is ~111.3 km. */
const METERS_PER_DEGREE = 111_320;

/**
 * Close enough to be the same answer from the same search. Two taps on the
 * same result land within GPS noise of each other; two different shops in
 * the same block are already further apart than this. Tight on purpose —
 * merging two genuinely different places loses a record, while missing a
 * duplicate merely leaves things as they were.
 */
const SAME_SPOT_METERS = 60;

/**
 * How far apart two same-named places in one country can be and still be the
 * same place. Kyoto re-added is metres from Kyoto; Springfield, Illinois is
 * a thousand kilometres from Springfield, Massachusetts and must not merge
 * into it just because both sit in the US.
 */
const SAME_NAME_MAX_METERS = 50_000;

/**
 * Lowercased, accent-stripped, single-spaced — so "São Paulo" and "Sao Paulo"
 * read as the same word, which to a person they are.
 */
export function normalizePlaceName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sameCountry(a: NewPlaceInput, b: VisitedPlace): boolean {
  const codeA = a.countryCode?.trim().toUpperCase();
  const codeB = b.countryCode?.trim().toUpperCase();
  if (codeA && codeB) return codeA === codeB;
  const nameA = normalizePlaceName(a.country ?? "");
  const nameB = normalizePlaceName(b.country ?? "");
  // With no code and no country on either side, don't let two blanks agree.
  return nameA.length > 0 && nameA === nameB;
}

function metersApart(a: NewPlaceInput, b: VisitedPlace): number {
  return (
    angularDistance(
      { latitude: a.latitude, longitude: a.longitude },
      { latitude: b.latitude, longitude: b.longitude },
    ) * METERS_PER_DEGREE
  );
}

/**
 * The already-saved place this input duplicates, or null.
 *
 * Name matches only count within the same country and within shouting
 * distance — there is a Springfield everywhere, including several per
 * country — and a coordinate match needs no name at all, because two pins on
 * the same rooftop are the same place whatever they were typed in as.
 * Tombstoned records never match: re-adding somewhere deleted should
 * genuinely re-add it.
 */
export function findDuplicatePlace(
  input: NewPlaceInput,
  places: VisitedPlace[],
): VisitedPlace | null {
  const name = normalizePlaceName(input.name);

  for (const place of places) {
    if (place.deletedAt) continue;

    const distance = metersApart(input, place);
    if (
      name &&
      normalizePlaceName(place.name) === name &&
      sameCountry(input, place) &&
      distance <= SAME_NAME_MAX_METERS
    ) {
      return place;
    }
    if (distance <= SAME_SPOT_METERS) {
      return place;
    }
  }
  return null;
}
