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
export const LAYER_CLUSTER_GLOW = "visited-cluster-glow";
export const LAYER_CLUSTER = "visited-cluster";
export const LAYER_CLUSTER_COUNT = "visited-cluster-count";
export const LAYER_PIN_DOT = "visited-pin-dot";
export const LAYER_PIN = "visited-pin-label";

/** Layers a tap can land on, in the order the tap handler considers them. */
export const INTERACTIVE_LAYERS = [LAYER_PIN_DOT, LAYER_CLUSTER, LAYER_CLUSTER_GLOW];

/** Everything belonging to the city-pin view, hidden in Countries mode. */
export const CITY_LAYERS = [
  LAYER_CLUSTER_GLOW,
  LAYER_CLUSTER,
  LAYER_CLUSTER_COUNT,
  LAYER_PIN_DOT,
  LAYER_PIN,
];

/** The two ways of reading the map. */
export type MapView = "countries" | "cities";

/** Public-domain Natural Earth polygons, built by `npm run countries`. */
export const COUNTRIES_URL = "geo/countries.json";

/** Camera the app opens on when there is nothing to frame. */
export const DEFAULT_CAMERA = { center: [8, 24] as [number, number], zoom: 1.35 };

/** Countries and pins are different hues so neither hides the other. */
export const COUNTRY_COLOR = "#2F6BFF";
export const PIN_COLOR = "#FF5A3C";
export const PIN_COLOR_SELECTED = "#0A84FF";
export const CLUSTER_COLOR = "#F04A28";

export const COUNTRY_FILL_OPACITY = { countries: 0.55, cities: 0.1 } as const;
export const COUNTRY_LINE_OPACITY = { countries: 0.85, cities: 0 } as const;

/* ------------------------------------------------------------------------ */
/* Pin paint                                                                 */
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
 * `zoom` is only legal as the input to a *top-level* `step`/`interpolate`, so
 * every selected/unselected choice below sits inside the stops rather than
 * wrapping them. Wrapping an interpolate in a `case` type-checks perfectly and
 * is rejected at runtime.
 */
export const pinRadius = (selected: ExpressionSpecification): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  1,
  ["case", selected, 9, 4.5],
  4,
  ["case", selected, 11, 6],
  10,
  ["case", selected, 13, 8],
];

export const pinColor = (selected: ExpressionSpecification): ExpressionSpecification => [
  "case",
  selected,
  PIN_COLOR_SELECTED,
  PIN_COLOR,
];

export const pinStrokeWidth = (selected: ExpressionSpecification): ExpressionSpecification => [
  "case",
  selected,
  3,
  2,
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

export const labelSortKey = (selected: ExpressionSpecification): ExpressionSpecification => [
  "case",
  selected,
  1,
  0,
];

/** The unselected defaults, used when a layer is first installed. */
export const PIN_RADIUS_DEFAULT: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  1,
  4.5,
  4,
  6,
  10,
  8,
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
    modulePromise = import("maplibre-gl").catch((error) => {
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
