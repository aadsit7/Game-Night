import type { ExpressionSpecification } from "maplibre-gl";

/**
 * The map stack lives behind this module.
 *
 * Deliberately keyless: MapLibre GL for rendering and OpenFreeMap for tiles,
 * neither of which needs an account, an API key, or a billing relationship.
 * Anyone who opens the URL gets a working globe with nothing to configure —
 * which is the same promise the travel data itself makes.
 */

/** OpenFreeMap: free OpenStreetMap vector tiles, no key, no registration. */
const STYLE_BASE = "https://tiles.openfreemap.org/styles";

export const STYLE_LIGHT = `${STYLE_BASE}/liberty`;
export const STYLE_DARK = `${STYLE_BASE}/dark`;

export const styleFor = (dark: boolean) => (dark ? STYLE_DARK : STYLE_LIGHT);

/** Used to tell "the style couldn't be fetched" from a single missing tile. */
export const STYLE_URLS: readonly string[] = [STYLE_LIGHT, STYLE_DARK];

/**
 * Fontstacks the tile host actually serves. Naming one it doesn't have makes
 * labels silently disappear, so these are checked against the style's own use.
 */
export const FONT_REGULAR = ["Noto Sans Regular"];
export const FONT_BOLD = ["Noto Sans Bold"];

export const SOURCE_ID = "visited-places";
export const SOURCE_COUNTRIES = "world-countries";

export const LAYER_COUNTRY_FILL = "visited-country-fill";
export const LAYER_COUNTRY_LINE = "visited-country-line";
export const LAYER_CLUSTER = "visited-cluster";
export const LAYER_CLUSTER_COUNT = "visited-cluster-count";
/** The soft disc under the chip you last tapped. */
export const LAYER_PIN_HALO = "visited-pin-halo";
export const LAYER_PIN_MARKER = "visited-pin-marker";
export const LAYER_PIN = "visited-pin-label";

/** Layers a tap can land on, in the order the tap handler considers them. */
export const INTERACTIVE_LAYERS = [LAYER_PIN_MARKER, LAYER_CLUSTER];

/** Everything belonging to the city-pin view, hidden in Countries mode. */
export const CITY_LAYERS = [
  LAYER_CLUSTER,
  LAYER_CLUSTER_COUNT,
  LAYER_PIN_HALO,
  LAYER_PIN_MARKER,
  LAYER_PIN,
];

/** The two ways of reading the map. */
export type MapView = "countries" | "cities";

/** Public-domain Natural Earth polygons, built by `npm run countries`. */
export const COUNTRIES_URL = "geo/countries.json";

/** MapLibre's worker, copied into `public/` by `scripts/copy-map-worker.mjs`. */
export const WORKER_URL = "maplibre/maplibre-gl-worker.mjs";

/** Camera the app opens on when there is nothing to frame. */
export const DEFAULT_CAMERA = { center: [8, 24] as [number, number], zoom: 1.35 };

/**
 * The traveller's own marks.
 *
 * Split by scheme, because these sit on two grounds seventy L* apart and a
 * single hex cannot be the salient thing on both. Visited countries leave the
 * blue family entirely — the ocean is blue, and a blue country on a blue sea is
 * the one adjacency this app cannot afford, since at globe zoom most of a
 * country's perimeter is coastline rather than border.
 */
export type OverlayPalette = {
  country: string;
  countryLine: string;
  pin: string;
  pinSelected: string;
  /**
   * Somewhere still to go. Deliberately outside both the pin's warm family and
   * the water's blue: a wish and a memory have to be told apart at a glance,
   * and neither may be mistaken for the sea underneath them.
   */
  pinWishlist: string;
  cluster: string;
  /**
   * The ring around every mark the traveller owns — the flag chip, the cluster
   * disc. It is what lets a saturated flag sit on the ocean, on a coastline or
   * on a city and still read as a separate object from the ground under it.
   */
  pinStroke: string;
  label: string;
  labelHalo: string;
};

const OVERLAY_LIGHT: OverlayPalette = {
  country: "#0C7768",
  // Darker than its own fill: an edge that contains the shape rather than one
  // that makes every visited country look permanently selected.
  countryLine: "#0A5F53",
  pin: "#BF421F",
  // Against a light ground, salience means going darker, not brighter — and
  // the ground got richer when the ocean did, so this went with it.
  pinSelected: "#0A55AC",
  pinWishlist: "#6D33B8",
  cluster: "#B93A1A",
  pinStroke: "#FFFFFF",
  label: "#16181D",
  labelHalo: "rgba(255,255,255,0.95)",
};

const OVERLAY_DARK: OverlayPalette = {
  country: "#17A08D",
  // On a dark map the containing edge has to be lighter than the fill.
  countryLine: "#7FE0CE",
  pin: "#E0562C",
  pinSelected: "#4DA6FF",
  // Deep enough to hold its own inside the chip's near-white ring, which is
  // the only ground this colour ever touches.
  pinWishlist: "#A472FF",
  cluster: "#C2451F",
  pinStroke: "rgba(233,238,246,0.92)",
  label: "#EDF1F7",
  labelHalo: "rgba(8,11,16,0.90)",
};

export const overlayFor = (dark: boolean): OverlayPalette =>
  dark ? OVERLAY_DARK : OVERLAY_LIGHT;

/**
 * Countries mode is nearly opaque at globe scale — the question it answers is
 * "how much of the world have I seen", and a wash cannot answer it — then eases
 * back as the map becomes a map. It never drops far enough to disappear: pins
 * are hidden in this mode, so the fill is the only thing on screen that is the
 * traveller's.
 */
export const COUNTRY_FILL_OPACITY = {
  countries: [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.94,
    5,
    0.92,
    9,
    0.62,
    13,
    0.55,
  ] as ExpressionSpecification,
  cities: 0.14,
} as const;

export const COUNTRY_LINE_OPACITY = { countries: 0.9, cities: 0 } as const;

/** A 0.6px hairline is not an edge at globe zoom. */
export const COUNTRY_LINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  1.2,
  4,
  1.8,
];

/**
 * Where our layers slot into the vendor style: above land, water, roads and
 * buildings, below every border and every label. Anchoring on the first symbol
 * layer instead would bury liberty's motorways under the country wash while
 * doing the opposite in dark, because the two styles order roads and labels
 * differently.
 */
export const COUNTRY_BEFORE_IDS = [
  "boundary_3",
  "highway_name_other",
  "boundary_2",
  "boundary_state",
];

/* ------------------------------------------------------------------------ */
/* Chip paint                                                                */
/*                                                                           */
/* These live here rather than inline in the component so they can be run    */
/* through the style validator in a test. A rejected expression is a silent  */
/* failure — the renderer fires an error nobody is listening for and quietly */
/* keeps the old paint — so "it compiles" is not evidence that it works.     */
/* ------------------------------------------------------------------------ */

/** Labels fade in between these zooms; a globe view stays uncluttered. */
export const LABEL_FADE_START = 3.4;
export const LABEL_FADE_END = 4.4;

/** Matches the one feature the traveller has selected, if any. */
export const selectedFilter = (selectedId: string | null): ExpressionSpecification => [
  "==",
  ["get", "id"],
  selectedId ?? "__none__",
];

/**
 * The sprite a feature asks for by name.
 *
 * The id is written into the feature by the component — country and variant,
 * resolved once per place — rather than assembled here with `concat`, because
 * the same string has to be the key the images are registered under, and one
 * place deciding it is one place that can get it wrong.
 */
export const MARKER_ICON_IMAGE: ExpressionSpecification = ["get", "icon"];

/**
 * `zoom` is only legal as the input to a *top-level* `step`/`interpolate`, so
 * every selected/unselected choice below sits inside the stops rather than
 * wrapping them. Wrapping an interpolate in a `case` type-checks perfectly and
 * is rejected at runtime.
 *
 * The chip shrinks at globe zoom rather than staying its full size: a hundred
 * flags at 32px is a mosaic of the world, not a map of it. It never shrinks
 * far enough to stop being a flag, which is the whole reason it is one.
 */
export const markerIconSize = (selected: ExpressionSpecification): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  ["case", selected, 0.82, 0.66],
  3,
  ["case", selected, 0.98, 0.82],
  8,
  ["case", selected, 1.18, 1],
];

/** The unselected default, used when the layer is first installed. */
export const MARKER_ICON_SIZE_DEFAULT: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  0.66,
  3,
  0.82,
  8,
  1,
];

/**
 * Which chip is drawn on top when two overlap.
 *
 * Icons on this layer are placed with `icon-allow-overlap`, so there is no
 * collision to win and the key decides draw order alone: the spec sorts
 * ascending and lets a *higher* key overlap a lower one. The selected place
 * therefore sorts last, which is the one that has to stay visible.
 */
export const markerSortKey = (selected: ExpressionSpecification): ExpressionSpecification => [
  "case",
  selected,
  1,
  0,
];

/**
 * A cluster is the same chip, a little bigger.
 *
 * Not a different mark and not a different colour: "four places in Portugal"
 * is still Portugal, and the flag is what says so. Size and a counted badge
 * are what say "four".
 */
export const clusterIconSize = (): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  0.76,
  3,
  0.94,
  8,
  1.14,
];

/**
 * Where the count badge hangs off the chip.
 *
 * Top right, which is where a badge goes — and, more to the point, not bottom
 * right, where the chip already carries the favourite and wishlist marks. A
 * cluster wears one of its members' chips, so the member being a favourite
 * would otherwise put a heart and a number in the same few pixels.
 *
 * `icon-offset` is in the icon's own pixels and scales with `icon-size`;
 * `text-offset` is in ems of the text size. They have to describe the same
 * point on screen or the number floats off its badge, so both are derived
 * here from one distance rather than tuned separately.
 */
export const COUNT_BADGE_NUDGE = 13;
export const COUNT_BADGE_TEXT_SIZE = 11.5;

export const countBadgeOffset = (): [number, number] => [COUNT_BADGE_NUDGE, -COUNT_BADGE_NUDGE];

export const countBadgeTextOffset = (): [number, number] => [
  COUNT_BADGE_NUDGE / COUNT_BADGE_TEXT_SIZE,
  -COUNT_BADGE_NUDGE / COUNT_BADGE_TEXT_SIZE,
];

/**
 * The halo under the selected chip.
 *
 * Selection is a light behind the mark rather than a different mark: the flag
 * is what the chip is *for*, and swapping it for a highlight colour the moment
 * you tap would take away the thing you tapped to look at. Sized to sit a few
 * pixels proud of the chip at every zoom, so it reads as a glow rather than as
 * a second disc.
 */
export const HALO_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  17,
  3,
  21,
  8,
  25,
];

/** The selected place shows its name at any zoom; the rest fade in. */
export const labelOpacity = (selected: ExpressionSpecification): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  LABEL_FADE_START,
  ["case", selected, 1, 0],
  LABEL_FADE_END,
  1,
];

/**
 * Which label survives when two want the same patch of screen.
 *
 * The opposite of `markerSortKey`, and deliberately so: labels are placed with
 * collision on, and there the spec gives priority to the *lower* key. The
 * selected place is the one name that must never be the one dropped.
 */
export const labelSortKey = (selected: ExpressionSpecification): ExpressionSpecification => [
  "case",
  selected,
  0,
  1,
];

export const LABEL_OPACITY_DEFAULT: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  LABEL_FADE_START,
  0,
  LABEL_FADE_END,
  1,
];

export type MapLibreGL = typeof import("maplibre-gl");

let modulePromise: Promise<MapLibreGL> | null = null;

/**
 * Loaded on demand so the GL renderer stays out of the initial bundle and the
 * Places view can render before the globe is ready.
 */
export async function loadMapLibre(): Promise<MapLibreGL> {
  if (!modulePromise) {
    modulePromise = import("maplibre-gl")
      .then((maplibregl) => {
        // MapLibre finds its worker from `import.meta.url` and gives up with an
        // empty string when that isn't an http(s) URL — which is exactly what a
        // bundler leaves behind. `new Worker("")` then fails with an error event
        // carrying no message, and since the worker is where every vector tile,
        // GeoJSON source and glyph is parsed, the map draws its raster relief
        // and nothing else: no pins, no clusters, no country fills, no labels,
        // and no complaint. Pointing it at our own copy is the whole fix.
        //
        // Must happen before the first Map is constructed. This is the only
        // path to the module, so it always does.
        maplibregl.setWorkerUrl(assetUrl(WORKER_URL));
        return maplibregl;
      })
      .catch((error) => {
        modulePromise = null;
        throw error;
      });
  }
  return modulePromise;
}

/**
 * Assets are served from the app's own base path, which differs between local
 * development and the deployed subpath.
 */
export function assetUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") || "";
  return `${base}/${path.replace(/^\//, "")}`;
}
