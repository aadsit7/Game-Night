import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

/**
 * Re-colours the basemap.
 *
 * The tiles come from OpenFreeMap, whose two styles are built for general-
 * purpose browsing: a photographic relief texture at world scale, periwinkle
 * water, orange motorways, a black sprite disc beside every city name, and — in
 * the dark style — land and sea fifteen RGB points apart, which at globe zoom
 * is a featureless black disc. None of that is wrong for a general map. It is
 * wrong for this one, where the basemap's only job is to be a quiet ground for
 * the traveller's own pins.
 *
 * Rather than fork and host a style, we recolour the one we are given. Layers
 * are matched by `source-layer` and type rather than by name, because the two
 * styles name the same things differently — liberty has `road_motorway`, dark
 * has `highway_major_inner` — and because a style that renames a layer tomorrow
 * should degrade to "not recoloured", never to a crash. Every write goes
 * through a guard that swallows unknown layers and unknown properties.
 *
 * Two mechanical facts drive the shape of this file:
 *
 * 1. **Neither style has a land polygon.** In both, land *is* the `background`
 *    layer. So the background colour is the land colour, and every landcover
 *    tone is chosen as a composite over it — including through whatever
 *    `fill-opacity` the style already baked in.
 * 2. **A layer that paints through `fill-pattern` ignores `fill-color`
 *    entirely.** Those are reached with `fill-opacity` or not at all.
 */

export type Palette = {
  /** Land. In both styles this is the `background` layer, not a land fill. */
  land: string;
  /** Ocean, seas, lakes — the single most important colour on a globe. */
  water: string;
  /** Rivers and canals: a shade of the water, never a separate hue. */
  waterway: string;
  /** Parks, forest, grass — held within a few L* of land so land reads as one surface. */
  green: string;
  /** Ice and glacier. The one deliberate exception to that rule. */
  ice: string;
  /** Desert and beach. */
  sand: string;
  /** Built-up areas, which appear from about zoom 9. */
  urban: string;
  building: string;
  buildingOutline: string;
  /** Major roads. Deliberately outside the pin's hue family. */
  road: string;
  roadCasing: string;
  roadMinor: string;
  roadRail: string;
  aeroway: string;
  boundary: string;
  boundaryMinor: string;
  label: string;
  labelHalo: string;
  /** Sea and river names, which sit on the water colour. */
  labelWater: string;
  /** Points of interest and road names — the quietest text on the map. */
  labelMinor: string;
  /** Natural Earth shaded relief, where a style has it. */
  reliefOpacity: number;
  /** The atmosphere, and the colour of the space the globe sits in. */
  sky: { sky: string; horizon: string; fog: string };
  /** Behind the canvas, so a frame without tiles is never a flash of the wrong colour. */
  backdrop: string;
};

/**
 * Light: a paper map, not a photograph.
 *
 * The Natural Earth relief goes to zero. At world scale it was the most
 * saturated and most textured thing on screen and the part of the picture the
 * traveller has no relationship with; with it gone, the globe's shape comes
 * from the land/water edge, which is what a map is. Water loses most of its
 * chroma for the same reason — at globe zoom the ocean is most of the display,
 * and a strong blue there leaves nowhere for a pin to be the brightest thing.
 *
 * Roads go white-on-warm-grey, the way every modern light basemap draws them.
 * That is not only taste: OpenFreeMap's motorways are `hsl(26,87%,62%)`, which
 * is the pin's own hue, so at city zoom the road network and the traveller's
 * places competed as the same kind of mark.
 */
const LIGHT: Palette = {
  land: "#EFECE6",
  water: "#B4C8D8",
  waterway: "#A6BCCF",
  green: "#E4E7DB",
  ice: "#F7F8F9",
  sand: "#F0EADD",
  urban: "rgba(228,223,214,0.55)",
  building: "#E6E2DB",
  buildingOutline: "#D9D4CC",
  road: "#FFFFFF",
  roadCasing: "#DCD7CE",
  roadMinor: "#FBF9F6",
  roadRail: "#DDD8D0",
  aeroway: "#E9E5DE",
  boundary: "#ADA69B",
  boundaryMinor: "#C9C3B9",
  label: "#4A5058",
  labelHalo: "rgba(248,246,242,0.92)",
  labelWater: "#4C6178",
  labelMinor: "#6B7178",
  reliefOpacity: 0,
  sky: { sky: "#A9C4E4", horizon: "#DCE6F0", fog: "#E9EFF4" },
  backdrop: "#E9EFF4",
};

/**
 * Dark: a planet at night, not a void.
 *
 * The one non-negotiable is that **land is lighter than sea**. OpenFreeMap's
 * dark style puts them at 1.14:1, which at globe zoom is a black disc with no
 * coastlines — you cannot see where you have been because you cannot see where
 * anything is. Lifting land to graphite over a blue-black ocean takes that to
 * 1.43:1 and gives the night globe its shape back without a relief layer.
 *
 * Roads are lifted above land for the same reason, which is the direction every
 * night map ships and the opposite of what this style did.
 */
const DARK: Palette = {
  land: "#2B3138",
  water: "#0C121B",
  waterway: "#16202D",
  green: "#2E3630",
  ice: "#3C434C",
  sand: "#35392F",
  urban: "#343B45",
  building: "#333940",
  buildingOutline: "#262B31",
  road: "#3E444C",
  roadCasing: "#23282E",
  roadMinor: "#363C44",
  roadRail: "#2F353C",
  aeroway: "#31373E",
  boundary: "#545C69",
  boundaryMinor: "#3E444E",
  label: "#9BA3AE",
  labelHalo: "rgba(8,11,16,0.88)",
  labelWater: "#6E8398",
  labelMinor: "#7F8792",
  reliefOpacity: 0,
  sky: { sky: "#05070B", horizon: "#33517C", fog: "#0A0F16" },
  backdrop: "#05070B",
};

export const paletteFor = (dark: boolean): Palette => (dark ? DARK : LIGHT);

/** Country borders fade in as the globe becomes a map. */
const BOUNDARY_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  0.4,
  4,
  1,
];

/** Internal borders have no business at globe zoom at all. */
const BOUNDARY_MINOR_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4.5,
  0,
  5.5,
  1,
];

/**
 * Basemap labels at globe zoom are the loudest thing on screen and none of them
 * are the traveller's. The dark style is the worse offender: it draws suburbs,
 * villages, towns and administrative subdivisions from zoom 0, so a view of
 * Africa arrives captioned SOUSS-MASSA, TIBESTI and LIKOUALA.
 *
 * They are not removed — knowing which country a pin sits in is most of the
 * point of a travel map — only held back until the map is being read as a map
 * rather than as a planet. Ordered: the first pattern that matches wins, so
 * road names are classified before the `other` catch-all can claim
 * `highway_name_other`.
 */
const LABEL_MIN_ZOOM: Array<[RegExp, number]> = [
  [/highway|road|street|motorway/, 11],
  [/poi|transit|airport|aerodrome/, 12],
  [/water_name|waterway/, 4],
  [/country/, 2.6],
  [/capital|city/, 4],
  [/state|region|province/, 5],
  [/town/, 7],
  [/village|suburb|hamlet|neighbourhood|neighborhood|other/, 9],
];

/** Applies one paint property, if that layer exists and accepts it. */
function paint(map: MapLibreMap, id: string, property: string, value: unknown): void {
  try {
    if (!map.getLayer(id)) return;
    // The property names come from the vendor style, not from us, so they are
    // strings rather than a union the compiler can check. The guard above and
    // the catch below are what make that safe.
    (map.setPaintProperty as (a: string, b: string, c: unknown) => void)(id, property, value);
  } catch {
    // A style we do not control: an unknown layer or property is a no-op,
    // never a broken map.
  }
}

/** True when the id mentions any of these words. */
const has = (id: string, ...words: string[]) =>
  words.some((word) => id.includes(word));

/**
 * Borders drawn across open ocean.
 *
 * OpenStreetMap carries maritime boundaries in the same layer as land borders,
 * and lifting the border colour so land borders read at globe zoom lifts these
 * with it — leaving long pale lines ruled across empty sea. No modern consumer
 * map draws them. The existing filter is preserved and narrowed rather than
 * replaced, so nothing else the style was doing is lost.
 */
function hideMaritime(map: MapLibreMap, id: string, existing: unknown): void {
  const notMaritime = ["!=", ["get", "maritime"], 1];
  try {
    const next = existing ? ["all", existing, notMaritime] : notMaritime;
    (map.setFilter as (a: string, b: unknown) => void)(id, next);
  } catch {
    // A style without that field keeps every border it had.
  }
}

export function applyBasemapTheme(map: MapLibreMap, palette: Palette): void {
  let layers: Array<Record<string, unknown>>;
  try {
    layers = (map.getStyle()?.layers ?? []) as unknown as Array<Record<string, unknown>>;
  } catch {
    return;
  }

  for (const layer of layers) {
    const id = String(layer.id ?? "").toLowerCase();
    const source = String(layer["source-layer"] ?? "");
    const type = String(layer.type ?? "");
    const paintSpec = (layer.paint ?? {}) as Record<string, unknown>;
    const layoutSpec = (layer.layout ?? {}) as Record<string, unknown>;

    if (type === "background") {
      // Land, in both styles. There is no land polygon to colour.
      paint(map, id, "background-color", palette.land);
      continue;
    }

    if (type === "raster") {
      paint(map, id, "raster-opacity", palette.reliefOpacity);
      continue;
    }

    /* Symbols are classified before anything else, because several of them
       belong to sources that would otherwise capture them — `waterway_line_label`
       is a symbol on the waterway source, `highway_name_motorway` a symbol on
       transportation — and writing `line-color` to a symbol is a silent no-op
       that leaves the shipped colour in place. */
    if (type === "symbol") {
      // Route-number shields are navigation furniture. A travel journal has no
      // use for them, and their sprite badges are full-colour.
      if (has(id, "shield")) {
        paint(map, id, "icon-opacity", 0);
        paint(map, id, "text-opacity", 0);
        continue;
      }

      const water = source === "water_name" || has(id, "water_name", "waterway");
      paint(map, id, "text-color", water ? palette.labelWater : palette.label);
      paint(map, id, "text-halo-color", palette.labelHalo);
      // Several layers ship a halo colour but no width, where the colour alone
      // does nothing.
      paint(map, id, "text-halo-width", 1.1);

      /* Both styles draw a solid sprite disc beside every settlement name from
         about zoom 3. On the new light land that dot measures 17.8:1 while the
         traveller's own pin measures 4.4:1 — the basemap's cities four times
         more salient than the user's places, in the identical visual form. The
         icon is hidden rather than unset, so it keeps its collision slot and no
         label reflows. */
      if (source === "place" && layoutSpec["icon-image"]) {
        paint(map, id, "icon-opacity", 0);
      } else if (layoutSpec["icon-image"]) {
        paint(map, id, "icon-opacity", 0.5);
      }

      const rule = LABEL_MIN_ZOOM.find(([pattern]) => pattern.test(id));
      if (rule) {
        try {
          const max = typeof layer.maxzoom === "number" ? layer.maxzoom : 24;
          const min = typeof layer.minzoom === "number" ? layer.minzoom : 0;
          // Never invert the range: a layer that already stops before our floor
          // is left alone.
          if (rule[1] < max) map.setLayerZoomRange(id, Math.max(rule[1], min), max);
        } catch {
          // Same guard as everything else here.
        }
      }
      continue;
    }

    /* A patterned fill ignores fill-color completely, so the only lever is its
       opacity. Covers liberty's wetland hatch and pedestrian areas, and dark's
       wood pattern. */
    if (paintSpec["fill-pattern"]) {
      paint(map, id, "fill-opacity", has(id, "wetland") ? 0.18 : 0.25);
      continue;
    }

    const fillProperty =
      type === "fill-extrusion" ? "fill-extrusion-color" : type === "line" ? "line-color" : "fill-color";

    if (source === "water") {
      paint(map, id, fillProperty, palette.water);
      // The dark style ships `fill-antialias: false`. That cost nothing while
      // the coastline was invisible; now that the land/water edge carries the
      // whole globe view, every coastline in the world would stair-step.
      if (type === "fill") paint(map, id, "fill-antialias", true);
      continue;
    }

    if (source === "waterway") {
      paint(map, id, fillProperty, palette.waterway);
      continue;
    }

    if (source === "landcover" || source === "landuse" || source === "park") {
      const tone = has(id, "ice", "glacier", "snow")
        ? palette.ice
        : has(id, "sand", "beach", "desert")
          ? palette.sand
          : has(id, "wood", "forest", "grass", "park", "pitch", "cemetery", "golf")
            ? palette.green
            : has(id, "residential", "commercial", "industrial", "built")
              ? palette.urban
              : palette.land;
      paint(map, id, fillProperty, tone);
      // liberty's park ships a saturated green hairline in `fill-outline-color`,
      // which survives a fill-color write and outlines every park in the world.
      if (type === "fill" && paintSpec["fill-outline-color"]) {
        paint(map, id, "fill-outline-color", tone);
      }
      continue;
    }

    if (source === "building") {
      paint(map, id, fillProperty, palette.building);
      if (type === "fill") paint(map, id, "fill-outline-color", palette.buildingOutline);
      continue;
    }

    if (source === "boundary") {
      const country = has(id, "country") || /(^|_)boundary_2($|_)|disputed/.test(id);
      paint(map, id, "line-color", country ? palette.boundary : palette.boundaryMinor);
      // liberty ramps `boundary_2` but not `boundary_disputed`, so at globe zoom
      // the disputed borders were 2.5x the strength of every real one. Dark
      // ramps nothing at all. Normalising both styles fixes both.
      paint(map, id, "line-opacity", country ? BOUNDARY_OPACITY : BOUNDARY_MINOR_OPACITY);
      hideMaritime(map, id, layer.filter);
      continue;
    }

    if (source === "aeroway" || has(id, "aeroway")) {
      paint(map, id, fillProperty, palette.aeroway);
      continue;
    }

    if (source === "transportation" || has(id, "road_", "bridge_", "tunnel_", "highway", "railway")) {
      if (type !== "line" && type !== "fill") continue;
      const tone = has(id, "rail")
        ? palette.roadRail
        : has(id, "casing")
          ? palette.roadCasing
          : has(id, "motorway", "trunk", "primary", "major", "link")
            ? palette.road
            : palette.roadMinor;
      paint(map, id, fillProperty, tone);
      continue;
    }
  }
}
