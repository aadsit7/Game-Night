/**
 * Builds the country-polygon asset used by the Countries view.
 *
 * OpenStreetMap vector tiles carry boundary *lines* but not country polygons,
 * so filling a country needs its own geometry. Natural Earth is public domain
 * and, at 1:110m, plenty for a shape read at globe zoom.
 *
 * The download is ~600 KB; everything here is about getting that down to
 * something reasonable to send to a phone: keep one property (the ISO code we
 * match places on), and round coordinates to two decimals — roughly a
 * kilometre, which is invisible at the zooms this layer is drawn at and
 * disappears entirely before the layer fades out.
 *
 * Run with `npm run countries`. The output is committed, so a build never
 * depends on the network.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "public", "geo", "countries.json");

const round = (value) => Math.round(value * 100) / 100;

/** Recursively rounds a coordinate tree of any nesting depth. */
function roundCoords(node) {
  if (typeof node[0] === "number") return [round(node[0]), round(node[1])];
  return node.map(roundCoords);
}

/** A ring that collapsed to fewer than four points is no longer a polygon. */
function keepViableRings(geometry) {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates.filter((ring) => ring.length >= 4);
    return rings.length > 0 ? { type: "Polygon", coordinates: rings } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates
      .map((rings) => rings.filter((ring) => ring.length >= 4))
      .filter((rings) => rings.length > 0);
    return polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : null;
  }
  return null;
}

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`Natural Earth download failed with ${response.status}`);
}
const source = await response.json();

const features = [];
for (const feature of source.features) {
  const code = feature.properties?.iso_a2;
  // Natural Earth uses "-99" for entities without an ISO code.
  if (!code || code === "-99" || code.length !== 2) continue;

  const geometry = keepViableRings({
    ...feature.geometry,
    coordinates: roundCoords(feature.geometry.coordinates),
  });
  if (!geometry) continue;

  features.push({
    type: "Feature",
    properties: { code: code.toUpperCase() },
    geometry,
  });
}

mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify({ type: "FeatureCollection", features });
writeFileSync(OUT, json);

console.log(
  `wrote ${OUT} — ${features.length} countries, ${(json.length / 1024).toFixed(0)} KB ` +
    `(from ${(JSON.stringify(source).length / 1024).toFixed(0)} KB)`,
);
