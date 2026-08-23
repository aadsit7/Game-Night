import { sphericalCentre, hasValidCoordinates } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

/**
 * The countries view, as marks rather than shapes.
 *
 * Painting a country you have been to is a beautiful answer to "how much of
 * the world have I seen" and a mute one: the shapes carry no name, no number,
 * and no sign that they can be tapped. Somebody who has been to Portugal and
 * Spain sees two green blobs and has to know the outlines to tell which is
 * which. So each visited country gets the same mark everything else in this app
 * gets — its flag, and how many places you have there.
 *
 * Where the mark goes is the mean direction of *your* places in that country,
 * not the country's own centre. For somewhere the size of the United States
 * those are nowhere near each other, and this is a travel journal: the useful
 * centre of America is where you have actually been.
 */
export type CountryMark = {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  /** The country's name, as the places themselves spell it. */
  name: string;
  /** How many saved places are in it. */
  count: number;
  longitude: number;
  latitude: number;
};

export function countryMarks(places: VisitedPlace[]): CountryMark[] {
  const byCode = new Map<string, { name: string; points: VisitedPlace[] }>();

  for (const place of places) {
    /* A country you want to go to is not a country you have been to. The fill
       under these marks makes the same exclusion, and a flag floating over an
       unpainted country would be the two of them disagreeing in public. */
    if (place.wantToGo) continue;
    if (!hasValidCoordinates(place)) continue;

    const code = place.countryCode?.trim().toUpperCase();
    if (!code || code.length !== 2) continue;

    const existing = byCode.get(code);
    if (existing) existing.points.push(place);
    else byCode.set(code, { name: place.country?.trim() || code, points: [place] });
  }

  const marks: CountryMark[] = [];
  for (const [code, { name, points }] of byCode) {
    const centre = sphericalCentre(points);
    if (!centre) continue;
    marks.push({
      code,
      name,
      count: points.length,
      longitude: centre.longitude,
      latitude: centre.latitude,
    });
  }

  /* A stable order, so the same collection produces the same features every
     time rather than following whatever order the data arrived in. Which mark
     is drawn on top of which is decided by the layer's sort key, not by this. */
  return marks.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
