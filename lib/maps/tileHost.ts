/**
 * Where the map's tiles come from, on its own, importable from anywhere.
 *
 * Split out of `basemap.ts` because the document's `<head>` needs it and
 * `basemap.ts` cannot be reached from there: it pulls in the renderer, which
 * is browser-only and megabytes wide, and importing it from a server component
 * drags the whole thing into a bundle that has no window to draw in.
 *
 * One constant, no imports, no side effects — safe on either side.
 */
export const TILE_ORIGIN = "https://tiles.openfreemap.org";
