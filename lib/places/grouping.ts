import type { VisitedPlace } from "@/types/place";

/**
 * The collection as a person remembers it: by country.
 *
 * A flat list of two hundred places answers "what did I just add?" and
 * nothing else. Grouped, the same records answer the question people
 * actually bring to a travel journal — "where have I been?" — country by
 * country, each section small enough to read.
 */

export type CountryGroup = {
  /** Matches the filter key the flag rail and country list already use. */
  key: string;
  label: string;
  code?: string;
  places: VisitedPlace[];
};

/**
 * Sections come out in the order their countries first appear, with each
 * place kept in the order it arrived — hand this the country-sorted list and
 * the sections read alphabetically with their places already arranged inside.
 * Gathering by key rather than by adjacency means a row missing its country
 * code cannot split one country into two look-alike sections.
 */
export function groupPlacesByCountry(places: VisitedPlace[]): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();

  for (const place of places) {
    // The same key the country filter matches on, so tapping a flag and
    // reading a heading can never disagree about what a country is.
    const key = (place.countryCode ?? place.country).toLowerCase();
    const group = groups.get(key);

    if (group) {
      group.places.push(place);
      // The heading's flag comes from whichever member knows the code.
      if (!group.code && place.countryCode) group.code = place.countryCode;
    } else {
      groups.set(key, {
        key,
        // A row someone typed by hand can have no country at all; a heading
        // still has to say something true about it.
        label: place.country || "No country",
        code: place.countryCode,
        places: [place],
      });
    }
  }

  return Array.from(groups.values());
}
