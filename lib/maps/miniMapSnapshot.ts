import { loadMapLibre, styleFor } from "@/lib/maps/basemap";
import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Still pictures of the map, for the card.
 *
 * A live map inside every place card would mean a WebGL context competing
 * with the globe's on every open — exactly the kind of quiet jank this app
 * is trying not to have. Instead one hidden renderer, created lazily and
 * shared for the whole session, frames each place once and hands back a
 * plain image; the card shows a picture that costs nothing to scroll.
 *
 * Snapshots are remembered per place and theme for the session, jobs run
 * one at a time, and every failure — style unreachable, WebGL refused, a
 * render that never settles — resolves to null so the card can fall back
 * to its quiet coordinates box. A failure also rests the renderer for a
 * few minutes rather than retrying on every card open while offline.
 */

const SNAPSHOT_WIDTH = 640;
const SNAPSHOT_HEIGHT = 300;
/** City scale: enough streets to say "here", not a rooftop guessing game. */
const SNAPSHOT_ZOOM = 11;
/** A render that hasn't settled by now isn't going to feel instant anyway. */
const SNAPSHOT_TIMEOUT_MS = 8000;
const CACHE_MAX = 16;
const REST_AFTER_FAILURE_MS = 5 * 60_000;

const cache = new Map<string, string>();
let chain: Promise<unknown> = Promise.resolve();
let renderer: MapLibreMap | null = null;
let rendererDark: boolean | null = null;
let restingSince = 0;

function cacheKey(latitude: number, longitude: number, dark: boolean): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}:${dark ? "dark" : "light"}`;
}

async function ensureRenderer(dark: boolean): Promise<MapLibreMap> {
  const maplibregl = await loadMapLibre();

  if (renderer && rendererDark !== dark) {
    renderer.setStyle(styleFor(dark));
    rendererDark = dark;
    return renderer;
  }
  if (renderer) return renderer;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${SNAPSHOT_WIDTH}px;height:${SNAPSHOT_HEIGHT}px;pointer-events:none;`;
  document.body.appendChild(host);

  renderer = new maplibregl.Map({
    container: host,
    style: styleFor(dark),
    center: [0, 0],
    zoom: SNAPSHOT_ZOOM,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    // Without this the drawing buffer is cleared before it can be read.
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  rendererDark = dark;
  return renderer;
}

/** Everything drawn and settled — or the timeout, whichever speaks first. */
function settled(map: MapLibreMap): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), SNAPSHOT_TIMEOUT_MS);
    map.once("idle", () => {
      window.clearTimeout(timer);
      resolve(true);
    });
  });
}

async function takeSnapshot(
  latitude: number,
  longitude: number,
  dark: boolean,
): Promise<string | null> {
  try {
    const map = await ensureRenderer(dark);
    map.jumpTo({ center: [longitude, latitude], zoom: SNAPSHOT_ZOOM });
    if (!(await settled(map))) throw new Error("mini-map render timed out");
    return map.getCanvas().toDataURL("image/jpeg", 0.75);
  } catch (error) {
    console.warn("Mini-map snapshot failed; the card shows coordinates.", error);
    restingSince = Date.now();
    // A wedged renderer would fail every card from here on — let the next
    // attempt after the rest start from scratch instead.
    try {
      renderer?.remove();
    } catch {
      // Tearing down a broken map can itself throw; there is nothing to keep.
    }
    renderer = null;
    rendererDark = null;
    return null;
  }
}

/**
 * A picture of the map around the point, or null for any reason at all.
 * Never throws, never blocks the caller's frame — all work is queued.
 */
export function miniMapSnapshot(
  latitude: number,
  longitude: number,
  dark: boolean,
): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (Date.now() - restingSince < REST_AFTER_FAILURE_MS && restingSince > 0) {
    return Promise.resolve(null);
  }

  const key = cacheKey(latitude, longitude, dark);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  const job = chain.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    const uri = await takeSnapshot(latitude, longitude, dark);
    if (uri) {
      cache.set(key, uri);
      // Session-scoped and small, but bounded all the same.
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    return uri;
  });
  // The chain must survive a failed job, or one bad render stops them all.
  chain = job.catch(() => null);
  return job;
}
