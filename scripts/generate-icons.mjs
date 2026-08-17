/**
 * Generates the app icons as real PNGs.
 *
 * Written by hand rather than pulled from a design tool so the icon set can be
 * regenerated from source with `npm run icons` and no binary assets need to be
 * committed blind. Everything is drawn at 3× and box-filtered down, which is
 * what gives the curves clean edges.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "public", "icons");
const APP_DIR = resolve(HERE, "..", "app");

const SS = 3; // supersampling factor

/* -------------------------------------------------------------------------- */
/* Tiny raster canvas                                                          */
/* -------------------------------------------------------------------------- */

function createCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) };
}

function blend(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  const d = canvas.data;
  const a = Math.min(1, alpha);
  d[i] = d[i] * (1 - a) + r * a;
  d[i + 1] = d[i + 1] * (1 - a) + g * a;
  d[i + 2] = d[i + 2] * (1 - a) + b * a;
  d[i + 3] = d[i + 3] * (1 - a) + 255 * a;
}

/** Fills every pixel where `shape(x, y)` returns a colour and coverage. */
function paint(canvas, shape) {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      const hit = shape(x + 0.5, y + 0.5);
      if (hit) blend(canvas, x, y, hit.color, hit.alpha);
    }
  }
}

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function roundedRectCoverage(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  if (dx === 0 && dy === 0) return 1;
  return Math.hypot(dx, dy) <= radius ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* The artwork                                                                 */
/* -------------------------------------------------------------------------- */

const NAVY_TOP = [12, 18, 36];
const NAVY_BOTTOM = [24, 40, 74];
const OCEAN_LIGHT = [64, 124, 214];
const OCEAN_DARK = [12, 42, 100];
const CORAL = [255, 122, 92];
const CORAL_DEEP = [226, 46, 12];
const WHITE = [255, 255, 255];

function drawIcon(size, { maskable = false } = {}) {
  const S = size * SS;
  const canvas = createCanvas(S);
  const radius = maskable ? 0 : S * 0.225;

  // Background plate.
  paint(canvas, (x, y) => {
    const coverage = maskable ? 1 : roundedRectCoverage(x, y, S, radius);
    if (!coverage) return null;
    return { color: mix(NAVY_TOP, NAVY_BOTTOM, y / S), alpha: coverage };
  });

  // The globe. Maskable icons keep their content inside the safe zone.
  const scale = maskable ? 0.72 : 1;
  const gx = S * 0.5;
  const gy = S * (maskable ? 0.53 : 0.545);
  const gr = S * 0.29 * scale;

  paint(canvas, (x, y) => {
    const d = Math.hypot(x - gx, y - gy);
    if (d > gr + 1) return null;
    // Light falls from the upper left, the way it does on the real globe view.
    const shade = Math.min(1, Math.max(0, (x - gx + gr) / (2 * gr) * 0.6 + (y - gy + gr) / (2 * gr) * 0.4));
    return { color: mix(OCEAN_LIGHT, OCEAN_DARK, shade), alpha: Math.min(1, gr + 1 - d) };
  });

  // Latitude and longitude lines, drawn as thin ellipse outlines.
  const lineWidth = Math.max(1, S * 0.006);
  const rings = [
    { rx: gr, ry: gr * 0.34 },
    { rx: gr * 0.86, ry: gr * 0.86 },
    { rx: gr * 0.42, ry: gr },
  ];
  for (const ring of rings) {
    paint(canvas, (x, y) => {
      const inside = Math.hypot(x - gx, y - gy);
      if (inside > gr) return null;
      const nx = (x - gx) / ring.rx;
      const ny = (y - gy) / ring.ry;
      const value = Math.hypot(nx, ny);
      const edge = Math.abs(value - 1) * Math.min(ring.rx, ring.ry);
      if (edge > lineWidth) return null;
      return { color: WHITE, alpha: 0.22 * (1 - edge / lineWidth) };
    });
  }

  // The pin: a circle plus a tapering tail, sitting proud of the globe.
  const pr = S * 0.115 * scale;
  const px = gx;
  const py = gy - gr * 0.26;
  const tipY = py + pr * 2.45;

  paint(canvas, (x, y) => {
    const dx = x - px;
    const dy = y - py;
    const circle = Math.hypot(dx, dy) - pr;
    // Width of the tail shrinks linearly from the circle down to the tip.
    const t = (y - py) / (tipY - py);
    const tail =
      t >= 0 && t <= 1 ? Math.abs(dx) - pr * 0.92 * (1 - t) * (1 - t * 0.15) : Infinity;
    const d = Math.min(circle, tail);
    if (d > 1) return null;
    const shade = Math.min(1, Math.max(0, (y - py + pr) / (tipY - py + pr)));
    return { color: mix(CORAL, CORAL_DEEP, shade), alpha: Math.min(1, 1 - d) };
  });

  // White core.
  paint(canvas, (x, y) => {
    const d = Math.hypot(x - px, y - py) - pr * 0.38;
    if (d > 1) return null;
    return { color: WHITE, alpha: Math.min(1, 1 - d) };
  });

  return downsample(canvas, size);
}

function downsample(canvas, size) {
  const out = Buffer.alloc(size * size * 4);
  const { data, size: S } = canvas;
  const area = SS * SS;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          a += data[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / area);
      out[o + 1] = Math.round(g / area);
      out[o + 2] = Math.round(b / area);
      out[o + 3] = Math.round(a / area);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* PNG encoding                                                                */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { path: resolve(OUT_DIR, "icon-192.png"), size: 192 },
  { path: resolve(OUT_DIR, "icon-512.png"), size: 512 },
  { path: resolve(OUT_DIR, "icon-maskable-512.png"), size: 512, maskable: true },
  { path: resolve(APP_DIR, "apple-icon.png"), size: 180 },
  { path: resolve(APP_DIR, "icon.png"), size: 64 },
];

for (const target of targets) {
  const png = encodePng(drawIcon(target.size, { maskable: target.maskable }), target.size);
  writeFileSync(target.path, png);
  console.log(`wrote ${target.path} (${png.length} bytes)`);
}
