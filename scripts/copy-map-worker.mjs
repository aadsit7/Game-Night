/**
 * Copies MapLibre's worker into `public/` so the app can serve it itself.
 *
 * MapLibre works out where its worker lives from `import.meta.url`:
 *
 *   let e = import.meta.url;
 *   if (!/^https?:/.test(e)) return "";        // <- bundlers land here
 *
 * Under a bundler that rewrites `import.meta.url` — Turbopack does — that test
 * fails, the function returns an empty string, and MapLibre calls
 * `new Worker("", { type: "module" })`. The worker never starts, and because
 * every vector tile, every GeoJSON source and every glyph is parsed *in* that
 * worker, the map renders nothing but its raster relief layer: no pins, no
 * clusters, no country fills, no labels. It fails silently — the worker's
 * error event carries no message and the map still reports its style as
 * loaded.
 *
 * So we serve the worker ourselves and point MapLibre at it with
 * `setWorkerUrl()` (see lib/maps/basemap.ts). The worker imports
 * `./maplibre-gl-shared.mjs`, which is why both files are copied and why they
 * must stay side by side.
 *
 * Run automatically before `dev` and `build`, so the copies can never drift
 * from the installed version. `public/maplibre/` is generated, not committed.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "maplibre");

/** The worker, and the module it imports. Order doesn't matter; both must land. */
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const version = JSON.parse(
  await readFile(join(root, "node_modules", "maplibre-gl", "package.json"), "utf8"),
).version;

await mkdir(to, { recursive: true });
for (const file of FILES) {
  await copyFile(join(from, file), join(to, file));
}

console.log(`maplibre worker ${version} → public/maplibre/ (${FILES.join(", ")})`);
