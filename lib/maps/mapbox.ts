import type { Map as MapboxMap } from "mapbox-gl";

/**
 * Mapbox lives behind this module so the rest of the app never touches the
 * token, the style ids, or the GL import directly.
 */

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

export const hasMapboxToken = MAPBOX_TOKEN.length > 0;

export const MAPBOX_STYLE = "mapbox://styles/mapbox/standard";

export const PIN_IMAGE = "travel-pin";
export const PIN_IMAGE_SELECTED = "travel-pin-selected";

export const SOURCE_ID = "visited-places";
export const LAYER_CLUSTER_GLOW = "visited-cluster-glow";
export const LAYER_CLUSTER = "visited-cluster";
export const LAYER_CLUSTER_COUNT = "visited-cluster-count";
export const LAYER_PIN_DOT = "visited-pin-dot";
export const LAYER_PIN = "visited-pin-label";
export const LAYER_COUNTRY_FILL = "visited-country-fill";
export const LAYER_COUNTRY_LINE = "visited-country-line";

/** Layers a tap can land on, in the order the tap handler considers them. */
export const INTERACTIVE_LAYERS = [LAYER_PIN_DOT, LAYER_CLUSTER, LAYER_CLUSTER_GLOW];

/** Everything that belongs to the city-pin view, hidden in Countries mode. */
export const CITY_LAYERS = [
  LAYER_CLUSTER_GLOW,
  LAYER_CLUSTER,
  LAYER_CLUSTER_COUNT,
  LAYER_PIN_DOT,
  LAYER_PIN,
];

/** The two ways of reading the map, borrowed from how travel maps are read. */
export type MapView = "countries" | "cities";

/** Camera the app opens on when there is nothing to frame. */
export const DEFAULT_CAMERA = { center: [8, 24] as [number, number], zoom: 1.35 };

/** The `mapboxgl` namespace object — `Map`, `Marker`, `LngLatBounds`, … */
export type MapboxGL = (typeof import("mapbox-gl"))["default"];

let modulePromise: Promise<MapboxGL> | null = null;

/**
 * Loaded on demand so ~250 KB of GL code stays out of the initial bundle and
 * the Places view can render before the globe is ready.
 */
export async function loadMapbox(): Promise<MapboxGL> {
  if (!modulePromise) {
    modulePromise = import("mapbox-gl")
      .then((mod) => {
        const mapbox = mod.default;
        mapbox.accessToken = MAPBOX_TOKEN;
        return mapbox;
      })
      .catch((error) => {
        modulePromise = null;
        throw error;
      });
  }
  return modulePromise;
}

/* -------------------------------------------------------------------------- */
/* Pin sprites                                                                 */
/* -------------------------------------------------------------------------- */

type PinSpec = {
  radius: number;
  tail: number;
  fill: string;
  fillDeep: string;
  ring: string;
  ringWidth: number;
  coreRadius: number;
  halo?: string;
};

const DPR = 2;

/**
 * Pins are drawn to a canvas rather than shipped as an image so the two states
 * stay in exact proportion and the colours can follow the theme.
 */
function drawPin(spec: PinSpec): { width: number; height: number; data: Uint8Array } | null {
  if (typeof document === "undefined") return null;

  const { radius, tail, ringWidth } = spec;
  const shadow = 6;
  const halo = spec.halo ? 7 : 0;
  const pad = ringWidth + shadow + halo;

  const width = Math.ceil((radius * 2 + pad * 2) * DPR);
  const height = Math.ceil((radius * 2 + tail + pad * 2 + shadow) * DPR);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(DPR, DPR);

  const cx = radius + pad;
  const cy = radius + pad;
  const tipY = cy + radius + tail;

  const a0 = Math.PI * 0.9;
  const a1 = Math.PI * 2.1;
  const p0 = { x: cx + radius * Math.cos(a0), y: cy + radius * Math.sin(a0) };
  const p1 = { x: cx + radius * Math.cos(a1), y: cy + radius * Math.sin(a1) };

  const teardrop = () => {
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.quadraticCurveTo(p0.x - radius * 0.06, p0.y + radius * 0.5, p0.x, p0.y);
    ctx.arc(cx, cy, radius, a0, a1);
    ctx.quadraticCurveTo(p1.x + radius * 0.06, p1.y + radius * 0.5, cx, tipY);
    ctx.closePath();
  };

  // Selection halo — a soft ring that reads at a glance without a hard border.
  if (spec.halo) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + ringWidth + 4.5, 0, Math.PI * 2);
    ctx.fillStyle = spec.halo;
    ctx.fill();
  }

  ctx.save();
  ctx.shadowColor = "rgba(10, 14, 22, 0.42)";
  ctx.shadowBlur = shadow;
  ctx.shadowOffsetY = 2;

  const gradient = ctx.createLinearGradient(cx, cy - radius, cx, tipY);
  gradient.addColorStop(0, spec.fill);
  gradient.addColorStop(1, spec.fillDeep);

  teardrop();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  teardrop();
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = spec.ring;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, spec.coreRadius, 0, Math.PI * 2);
  ctx.fillStyle = spec.ring;
  ctx.fill();

  const image = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8Array(image.data.buffer) };
}

/**
 * Registers both pin states with the style. Safe to call again after a style
 * reload; existing images are replaced rather than duplicated.
 */
export function registerPinImages(map: MapboxMap): void {
  const base = drawPin({
    radius: 9.5,
    tail: 9,
    fill: "#FF6A4D",
    fillDeep: "#EA3F1E",
    ring: "#FFFFFF",
    ringWidth: 2.4,
    coreRadius: 3.1,
  });

  const selected = drawPin({
    radius: 12.5,
    tail: 12,
    fill: "#FF7A5C",
    fillDeep: "#E22E0C",
    ring: "#FFFFFF",
    ringWidth: 3,
    coreRadius: 4.2,
    halo: "rgba(255, 106, 77, 0.32)",
  });

  for (const [id, image] of [
    [PIN_IMAGE, base],
    [PIN_IMAGE_SELECTED, selected],
  ] as const) {
    if (!image) continue;
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, image, { pixelRatio: DPR });
  }
}

/* -------------------------------------------------------------------------- */
/* Static imagery                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A place with no photograph still deserves a picture. Rather than a grey box,
 * we show satellite imagery of the exact coordinates — a small postcard of the
 * spot, generated from data we already have.
 */
export function staticImageUrl(options: {
  latitude: number;
  longitude: number;
  width: number;
  height: number;
  zoom?: number;
}): string | null {
  if (!hasMapboxToken) return null;
  const { latitude, longitude, width, height, zoom = 11.5 } = options;
  const w = Math.min(1280, Math.max(1, Math.round(width)));
  const h = Math.min(1280, Math.max(1, Math.round(height)));
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    attribution: "false",
    logo: "false",
  });
  return (
    `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
    `${longitude.toFixed(5)},${latitude.toFixed(5)},${zoom},0/${w}x${h}@2x?${params}`
  );
}

/** Small labelled map used on the detail screen. */
export function locatorImageUrl(options: {
  latitude: number;
  longitude: number;
  width: number;
  height: number;
  dark: boolean;
  zoom?: number;
}): string | null {
  if (!hasMapboxToken) return null;
  const { latitude, longitude, width, height, dark, zoom = 12 } = options;
  const w = Math.min(1280, Math.max(1, Math.round(width)));
  const h = Math.min(1280, Math.max(1, Math.round(height)));
  const style = dark ? "dark-v11" : "light-v11";
  const marker = `pin-l+ff5a3c(${longitude.toFixed(5)},${latitude.toFixed(5)})`;
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    attribution: "false",
    logo: "false",
  });
  return (
    `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${marker}/` +
    `${longitude.toFixed(5)},${latitude.toFixed(5)},${zoom},0/${w}x${h}@2x?${params}`
  );
}
