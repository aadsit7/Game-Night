import type { LocationResult, VisitedPlace } from "@/types/place";

/**
 * Somewhere that is not on Earth.
 *
 * A travel journal that draws the solar system behind the planet and then
 * refuses to let you record standing on any of it is telling a small lie
 * about its own sky. The Moon has been visited — by twelve people, and by a
 * great many more machines — and a journal of places is the right shape for
 * that. So the Moon is searchable like anywhere else, saved like anywhere
 * else, and opening it does the one thing Earth cannot do for it: pulls the
 * camera back off the planet until the Moon is the world you are looking at.
 *
 * The record needs no new column to hold this. A lunar place is one whose
 * Country reads "Moon", and its latitude and longitude are *selenographic* —
 * the Moon's own grid, north positive, east positive, exactly as the USGS
 * gazetteer gives them. Everything that must not treat those as Earth
 * coordinates — the pins, the framing, the Google lookups, the mini-map —
 * asks {@link isOffWorldPlace} first.
 */

/** What the Country cell reads for somewhere on the Moon. */
export const MOON_WORLD = "Moon";

/** Whether a record is somewhere other than Earth. */
export function isOffWorldPlace(
  place: Pick<VisitedPlace, "country"> | null | undefined,
): boolean {
  return place?.country?.trim().toLowerCase() === MOON_WORLD.toLowerCase();
}

/** The Earth-bound half of a collection: everything a globe can draw. */
export function earthPlaces(places: VisitedPlace[]): VisitedPlace[] {
  return places.filter((place) => !isOffWorldPlace(place));
}

export type MoonSiteKind = "world" | "sea" | "crater" | "mountain" | "landing";

export type MoonSite = {
  id: string;
  name: string;
  /** Other names it is known by, and the ones people actually type. */
  aliases?: string[];
  /** The half of the Moon it is on — kept in the record's Region cell. */
  region: string;
  /** Selenographic latitude, north positive. */
  latitude: number;
  /** Selenographic longitude, east positive. */
  longitude: number;
  /** The line under the name: what it is, in one breath. */
  blurb: string;
  kind: MoonSiteKind;
};

const NEAR = "Near side";
const FAR = "Far side";
const SOUTH = "South pole";
const NORTH = "North pole";

/**
 * The Moon as a gazetteer: the seas anyone can point to with the naked eye,
 * the craters that give it its face, every place a human being has stood, and
 * a handful of the machines that got there first or went somewhere new.
 *
 * Coordinates are the published selenographic ones, so a site saved here
 * lands where the surface map puts that feature rather than near it.
 */
export const MOON_SITES: MoonSite[] = [
  {
    id: "moon",
    name: "The Moon",
    aliases: ["moon", "luna", "the moon"],
    region: NEAR,
    latitude: 0,
    longitude: 0,
    blurb: "Earth’s only natural satellite — 384,400 km away",
    kind: "world",
  },

  /* The seas: basalt floods, dark enough to read from a back garden. */
  {
    id: "mare-tranquillitatis",
    name: "Sea of Tranquility",
    aliases: ["mare tranquillitatis", "tranquility", "tranquillity"],
    region: NEAR,
    latitude: 8.5,
    longitude: 31.4,
    blurb: "Mare Tranquillitatis — where Apollo 11 came down",
    kind: "sea",
  },
  {
    id: "mare-serenitatis",
    name: "Sea of Serenity",
    aliases: ["mare serenitatis", "serenity"],
    region: NEAR,
    latitude: 28,
    longitude: 17.5,
    blurb: "Mare Serenitatis — the right eye of the Man in the Moon",
    kind: "sea",
  },
  {
    id: "mare-imbrium",
    name: "Sea of Showers",
    aliases: ["mare imbrium", "imbrium", "showers"],
    region: NEAR,
    latitude: 32.8,
    longitude: -15.6,
    blurb: "Mare Imbrium — a 1,100 km basin struck out in an afternoon",
    kind: "sea",
  },
  {
    id: "oceanus-procellarum",
    name: "Ocean of Storms",
    aliases: ["oceanus procellarum", "procellarum", "storms"],
    region: NEAR,
    latitude: 18.4,
    longitude: -57.4,
    blurb: "Oceanus Procellarum — the largest of the lunar seas",
    kind: "sea",
  },
  {
    id: "mare-crisium",
    name: "Sea of Crises",
    aliases: ["mare crisium", "crisium", "crises"],
    region: NEAR,
    latitude: 17,
    longitude: 59.1,
    blurb: "Mare Crisium — an oval sea near the eastern limb",
    kind: "sea",
  },
  {
    id: "mare-nectaris",
    name: "Sea of Nectar",
    aliases: ["mare nectaris", "nectaris", "nectar"],
    region: NEAR,
    latitude: -15.2,
    longitude: 35.5,
    blurb: "Mare Nectaris — a small southern sea with a bright rim",
    kind: "sea",
  },
  {
    id: "mare-orientale",
    name: "Eastern Sea",
    aliases: ["mare orientale", "orientale"],
    region: FAR,
    latitude: -19.4,
    longitude: -92.8,
    blurb: "Mare Orientale — a bullseye basin, barely visible from Earth",
    kind: "sea",
  },

  /* The craters that give the near side its face. */
  {
    id: "copernicus",
    name: "Copernicus Crater",
    aliases: ["copernicus"],
    region: NEAR,
    latitude: 9.62,
    longitude: -20.08,
    blurb: "93 km across, with terraced walls and a bright ray system",
    kind: "crater",
  },
  {
    id: "tycho",
    name: "Tycho Crater",
    aliases: ["tycho"],
    region: NEAR,
    latitude: -43.31,
    longitude: -11.36,
    blurb: "The young crater whose rays reach a quarter of the way round",
    kind: "crater",
  },
  {
    id: "kepler",
    name: "Kepler Crater",
    aliases: ["kepler"],
    region: NEAR,
    latitude: 8.1,
    longitude: -38,
    blurb: "A small bright crater adrift in the Ocean of Storms",
    kind: "crater",
  },
  {
    id: "aristarchus",
    name: "Aristarchus Crater",
    aliases: ["aristarchus"],
    region: NEAR,
    latitude: 23.7,
    longitude: -47.4,
    blurb: "The brightest spot on the Moon, beside a winding valley",
    kind: "crater",
  },
  {
    id: "plato",
    name: "Plato Crater",
    aliases: ["plato"],
    region: NEAR,
    latitude: 51.6,
    longitude: -9.3,
    blurb: "A dark flooded floor on the shore of the Sea of Showers",
    kind: "crater",
  },
  {
    id: "clavius",
    name: "Clavius Crater",
    aliases: ["clavius"],
    region: NEAR,
    latitude: -58.4,
    longitude: -14.4,
    blurb: "225 km wide, with a curving chain of craters on its floor",
    kind: "crater",
  },
  {
    id: "tsiolkovskiy",
    name: "Tsiolkovskiy Crater",
    aliases: ["tsiolkovskiy", "tsiolkovsky"],
    region: FAR,
    latitude: -20.4,
    longitude: 129.1,
    blurb: "A dark lava floor and a white peak, on the hidden side",
    kind: "crater",
  },
  {
    id: "shackleton",
    name: "Shackleton Crater",
    aliases: ["shackleton"],
    region: SOUTH,
    latitude: -89.9,
    longitude: 0,
    blurb: "At the south pole, where the floor has never seen the Sun",
    kind: "crater",
  },
  {
    id: "peary",
    name: "Peary Crater",
    aliases: ["peary"],
    region: NORTH,
    latitude: 88.6,
    longitude: 33,
    blurb: "At the north pole, with rims in nearly perpetual daylight",
    kind: "crater",
  },
  {
    id: "south-pole-aitken",
    name: "South Pole–Aitken Basin",
    aliases: ["aitken", "south pole aitken", "spa basin"],
    region: FAR,
    latitude: -53,
    longitude: -169,
    blurb: "2,500 km wide and 8 km deep — the largest crater in the solar system",
    kind: "crater",
  },

  /* The mountains. */
  {
    id: "montes-apenninus",
    name: "Montes Apenninus",
    aliases: ["apennines", "apenninus", "lunar apennines"],
    region: NEAR,
    latitude: 18.9,
    longitude: -3.7,
    blurb: "A 600 km mountain wall, rising 5 km over the Sea of Showers",
    kind: "mountain",
  },

  /* Where people have actually stood. */
  {
    id: "apollo-11",
    name: "Tranquility Base",
    aliases: ["apollo 11", "apollo11", "armstrong", "aldrin", "tranquility base"],
    region: NEAR,
    latitude: 0.6741,
    longitude: 23.4730,
    blurb: "Apollo 11 · 20 July 1969 · Armstrong and Aldrin",
    kind: "landing",
  },
  {
    id: "apollo-12",
    name: "Apollo 12 · Ocean of Storms",
    aliases: ["apollo 12", "apollo12", "conrad", "bean", "surveyor 3"],
    region: NEAR,
    latitude: -3.0124,
    longitude: -23.4219,
    blurb: "Apollo 12 · November 1969 · landed beside Surveyor 3",
    kind: "landing",
  },
  {
    id: "apollo-14",
    name: "Fra Mauro",
    aliases: ["apollo 14", "apollo14", "shepard", "mitchell", "fra mauro"],
    region: NEAR,
    latitude: -3.6453,
    longitude: -17.4714,
    blurb: "Apollo 14 · February 1971 · Shepard and Mitchell",
    kind: "landing",
  },
  {
    id: "apollo-15",
    name: "Hadley–Apennine",
    aliases: ["apollo 15", "apollo15", "hadley", "scott", "irwin", "hadley rille"],
    region: NEAR,
    latitude: 26.1322,
    longitude: 3.6339,
    blurb: "Apollo 15 · July 1971 · the first rover, beside a lava channel",
    kind: "landing",
  },
  {
    id: "apollo-16",
    name: "Descartes Highlands",
    aliases: ["apollo 16", "apollo16", "descartes", "young", "duke"],
    region: NEAR,
    latitude: -8.9734,
    longitude: 15.5011,
    blurb: "Apollo 16 · April 1972 · the only landing in the highlands",
    kind: "landing",
  },
  {
    id: "apollo-17",
    name: "Taurus–Littrow",
    aliases: ["apollo 17", "apollo17", "cernan", "schmitt", "taurus littrow"],
    region: NEAR,
    latitude: 20.1911,
    longitude: 30.7723,
    blurb: "Apollo 17 · December 1972 · the last time anyone stood here",
    kind: "landing",
  },

  /* And a few of the machines. */
  {
    id: "luna-9",
    name: "Luna 9",
    aliases: ["luna 9", "luna9"],
    region: NEAR,
    latitude: 7.13,
    longitude: -64.37,
    blurb: "February 1966 · the first soft landing anywhere off Earth",
    kind: "landing",
  },
  {
    id: "lunokhod-1",
    name: "Lunokhod 1",
    aliases: ["lunokhod", "lunokhod 1", "luna 17"],
    region: NEAR,
    latitude: 38.2378,
    longitude: -35.0017,
    blurb: "November 1970 · the first rover on another world",
    kind: "landing",
  },
  {
    id: "change-4",
    name: "Chang’e 4 · Von Kármán",
    aliases: ["change 4", "chang'e 4", "chang e 4", "von karman", "yutu"],
    region: FAR,
    latitude: -45.4,
    longitude: 177.6,
    blurb: "January 2019 · the first landing on the far side",
    kind: "landing",
  },
  {
    id: "chandrayaan-3",
    name: "Shiv Shakti Point",
    aliases: ["chandrayaan", "chandrayaan 3", "vikram", "pragyan", "shiv shakti"],
    region: SOUTH,
    latitude: -69.373,
    longitude: 32.319,
    blurb: "August 2023 · Chandrayaan-3, nearest the south pole",
    kind: "landing",
  },
];

/** The site behind a saved lunar record, matched on where its pin sits. */
export function moonSiteAt(latitude: number, longitude: number): MoonSite | null {
  for (const site of MOON_SITES) {
    if (Math.abs(site.latitude - latitude) < 0.02 && Math.abs(site.longitude - longitude) < 0.02) {
      return site;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Finding one                                                                 */
/* -------------------------------------------------------------------------- */

/** Lower case, unaccented, and stripped of the punctuation nobody types. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The words that mean "somewhere off Earth" rather than a particular place. */
const WORLD_WORDS = ["moon", "luna", "lunar", "space"];

/**
 * How well a site answers a typed term: 3 for the name itself, 2 for the
 * start of a name or alias, 1 for a mention anywhere in it, 0 for no.
 */
function scoreSite(site: MoonSite, term: string): number {
  const names = [site.name, ...(site.aliases ?? [])].map(fold);
  let best = 0;
  for (const name of names) {
    if (name === term) return 3;
    if (name.startsWith(term) || name.split(" ").some((word) => word.startsWith(term))) {
      best = Math.max(best, 2);
    } else if (name.includes(term)) {
      best = Math.max(best, 1);
    }
  }
  if (best === 0 && fold(site.blurb).includes(term)) best = 1;
  return best;
}

/** The lunar sites a search term is asking for, best answer first. */
export function searchMoonSites(query: string, limit = 5): MoonSite[] {
  const term = fold(query);
  if (term.length < 2) return [];

  // "moon" is a request for the Moon, and then for its landmarks — the sites
  // are already listed in the order a first visit would want them.
  if (WORLD_WORDS.some((word) => word.startsWith(term) || term.startsWith(word))) {
    return MOON_SITES.slice(0, limit);
  }

  return MOON_SITES.map((site) => ({ site, score: scoreSite(site, term) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.site);
}

/** One lunar site, in the shape the add-a-place flow already understands. */
export function toMoonLocationResult(site: MoonSite): LocationResult {
  return {
    id: `moon:${site.id}`,
    name: site.name,
    context: site.kind === "world" ? MOON_WORLD : `${site.region}, ${MOON_WORLD}`,
    address: site.blurb,
    region: site.region,
    country: MOON_WORLD,
    // No flag, no ISO code: the Moon is not a country and must never be
    // painted as one on the Earth's own map.
    countryCode: undefined,
    latitude: site.latitude,
    longitude: site.longitude,
    kind: site.kind === "world" ? "country" : "poi",
    source: "moon",
  };
}

/** The lunar answers to a search term, ready to sit above the Earth's. */
export function searchMoonLocations(query: string, limit = 5): LocationResult[] {
  return searchMoonSites(query, limit).map(toMoonLocationResult);
}
