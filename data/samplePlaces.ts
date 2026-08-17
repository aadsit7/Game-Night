import type { VisitedPlace } from "@/types/place";

/**
 * Development seed data — fourteen places spread across six continents so the
 * globe, clustering, search, sorting and country counts can all be judged the
 * moment the app opens.
 *
 * This file is the only place sample data exists. Delete it (and the seed call
 * in `PlacesProvider`) to ship an app that starts empty. Set
 * `NEXT_PUBLIC_SEED_SAMPLE_DATA=false` to skip seeding without touching code.
 */

type Seed = Omit<VisitedPlace, "id" | "createdAt" | "updatedAt">;

const SEED_PLACES: Seed[] = [
  {
    name: "Tokyo",
    city: "Tokyo",
    country: "Japan",
    countryCode: "JP",
    latitude: 35.6762,
    longitude: 139.6503,
    visitedFrom: "2025-03-14",
    visitedTo: "2025-03-21",
    notes: "Late-night ramen in Shinjuku and the quiet of Meiji Jingu at opening.",
  },
  {
    name: "Kyoto",
    city: "Kyoto",
    region: "Kansai",
    country: "Japan",
    countryCode: "JP",
    latitude: 35.0116,
    longitude: 135.7681,
    visitedFrom: "2025-03-22",
    visitedTo: "2025-03-25",
    notes: "Walked Fushimi Inari before sunrise. Almost had it to myself.",
  },
  {
    name: "Bangkok",
    city: "Bangkok",
    country: "Thailand",
    countryCode: "TH",
    latitude: 13.7563,
    longitude: 100.5018,
    visitedFrom: "2024-11-08",
    visitedTo: "2024-11-13",
    notes: "Boat down the Chao Phraya at dusk.",
  },
  {
    name: "Sydney",
    city: "Sydney",
    region: "New South Wales",
    country: "Australia",
    countryCode: "AU",
    latitude: -33.8688,
    longitude: 151.2093,
    visitedFrom: "2024-01-05",
    visitedTo: "2024-01-12",
    notes: "Bondi to Coogee walk, then oysters at the fish market.",
  },
  {
    name: "Cape Town",
    city: "Cape Town",
    country: "South Africa",
    countryCode: "ZA",
    latitude: -33.9249,
    longitude: 18.4241,
    visitedFrom: "2023-10-02",
    visitedTo: "2023-10-09",
    notes: "Table Mountain cleared for about twenty minutes and we were up there.",
  },
  {
    name: "Basílica de la Sagrada Família",
    city: "Barcelona",
    region: "Catalonia",
    country: "Spain",
    countryCode: "ES",
    latitude: 41.4036,
    longitude: 2.1744,
    visitedFrom: "2024-06-18",
    notes: "The east-facing windows in the morning are the whole point.",
  },
  {
    name: "Paris",
    city: "Paris",
    country: "France",
    countryCode: "FR",
    latitude: 48.8566,
    longitude: 2.3522,
    visitedFrom: "2024-06-21",
    visitedTo: "2024-06-26",
    notes: "Rue Cler in the morning. Rodin garden in the rain.",
  },
  {
    name: "London",
    city: "London",
    country: "United Kingdom",
    countryCode: "GB",
    latitude: 51.5072,
    longitude: -0.1276,
    visitedFrom: "2024-06-27",
    visitedTo: "2024-06-30",
    notes: "Borough Market, then the Turbine Hall.",
  },
  {
    name: "Florence",
    city: "Florence",
    region: "Tuscany",
    country: "Italy",
    countryCode: "IT",
    latitude: 43.7696,
    longitude: 11.2558,
    visitedFrom: "2023-05-12",
    visitedTo: "2023-05-16",
    notes: "Booked the Uffizi for the first slot and had the Botticelli room nearly empty.",
  },
  {
    name: "Rome",
    city: "Rome",
    region: "Lazio",
    country: "Italy",
    countryCode: "IT",
    latitude: 41.9028,
    longitude: 12.4964,
    visitedFrom: "2023-05-17",
    visitedTo: "2023-05-21",
    notes: "The Pantheon oculus during a downpour.",
  },
  {
    name: "New York",
    city: "New York",
    region: "New York",
    country: "United States",
    countryCode: "US",
    latitude: 40.7128,
    longitude: -74.006,
    visitedFrom: "2025-09-11",
    visitedTo: "2025-09-16",
    notes: "Walked the whole High Line, ended up in Chelsea Market.",
  },
  {
    name: "San Francisco",
    city: "San Francisco",
    region: "California",
    country: "United States",
    countryCode: "US",
    latitude: 37.7749,
    longitude: -122.4194,
    visitedFrom: "2025-04-03",
    visitedTo: "2025-04-07",
    notes: "Fog rolled over Twin Peaks right on cue.",
  },
  {
    name: "Mexico City",
    city: "Mexico City",
    country: "Mexico",
    countryCode: "MX",
    latitude: 19.4326,
    longitude: -99.1332,
    visitedFrom: "2024-02-16",
    visitedTo: "2024-02-22",
    notes: "Sunday in Chapultepec, tacos al pastor in Roma Norte every night.",
  },
  {
    name: "Rio de Janeiro",
    city: "Rio de Janeiro",
    country: "Brazil",
    countryCode: "BR",
    latitude: -22.9068,
    longitude: -43.1729,
    visitedFrom: "2023-01-20",
    visitedTo: "2023-01-27",
    notes: "Sugarloaf at golden hour was worth the queue.",
  },
];

/**
 * Stamps the seed with ids and timestamps. `createdAt` is staggered so the
 * default "Recently added" ordering is stable and looks deliberate.
 */
export function buildSamplePlaces(): VisitedPlace[] {
  const base = Date.now();
  return SEED_PLACES.map((place, index) => {
    const created = new Date(base - index * 36_00_000).toISOString();
    return {
      ...place,
      id: `sample-${index + 1}`,
      createdAt: created,
      updatedAt: created,
    };
  });
}

export const SAMPLE_PLACE_COUNT = SEED_PLACES.length;
