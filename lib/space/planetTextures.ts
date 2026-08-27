/**
 * Equirectangular surface maps for the bodies in the sky, painted in code.
 *
 * Real photographs of the planets are copyright-clean but heavy, and a bundle
 * that ships megabytes of NASA plates to decorate a travel journal has its
 * priorities backwards. These are painted instead, from the same recipe every
 * planetary artist uses: fractal noise for terrain, latitude bands for gas
 * giants, craters stamped with a raised rim and a sunken floor. Each map is a
 * few dozen kilobytes of code and deterministic to the last texel — the same
 * seeded generator every load, because this sky is a place, not a shuffle.
 *
 * RGB carries albedo. Alpha carries *height*, which the renderer turns into
 * relief at the terminator — craters throw shadows at the Moon's edge of
 * night for the price of one extra channel.
 *
 * Everything here is pure typed-array arithmetic with no DOM in it, so the
 * tests can bake a small Moon in node and hold it still.
 */

import type { BodyKind } from "@/lib/space/celestial";

export type BakedTexture = { width: number; height: number; pixels: Uint8ClampedArray };

/** Power-of-two sizes, so WebGL1 can repeat and mipmap them. */
export const TEXTURE_SIZES: Record<BodyKind, [number, number]> = {
  moon: [512, 256],
  mars: [512, 256],
  jupiter: [512, 256],
  saturn: [512, 256],
  venus: [256, 128],
  neptune: [128, 64],
  uranus: [128, 64],
  pluto: [64, 32],
};

export const RING_STRIP_WIDTH = 512;

/* -------------------------------------------------------------------------- */
/* Seeded noise                                                                */
/* -------------------------------------------------------------------------- */

/** Small, fast, and the same numbers on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Noise3 = {
  /** Value noise in [-1, 1]. */
  noise: (x: number, y: number, z: number) => number;
  /** Fractal sum in roughly [-1, 1]. */
  fbm: (x: number, y: number, z: number, octaves: number) => number;
};

function makeNoise3(seed: number): Noise3 {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);
  const source = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [source[i], source[j]] = [source[j], source[i]];
  }
  for (let i = 0; i < 512; i += 1) perm[i] = source[i & 255];
  for (let i = 0; i < 256; i += 1) values[i] = rand() * 2 - 1;

  const lattice = (x: number, y: number, z: number) =>
    values[perm[(perm[(perm[x & 255] + y) & 255] + z) & 255]];

  const smooth = (t: number) => t * t * (3 - 2 * t);

  const noise = (x: number, y: number, z: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const fz = smooth(z - z0);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const c00 = lerp(lattice(x0, y0, z0), lattice(x0 + 1, y0, z0), fx);
    const c10 = lerp(lattice(x0, y0 + 1, z0), lattice(x0 + 1, y0 + 1, z0), fx);
    const c01 = lerp(lattice(x0, y0, z0 + 1), lattice(x0 + 1, y0, z0 + 1), fx);
    const c11 = lerp(lattice(x0, y0 + 1, z0 + 1), lattice(x0 + 1, y0 + 1, z0 + 1), fx);
    return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
  };

  const fbm = (x: number, y: number, z: number, octaves: number): number => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * noise(x * freq, y * freq, z * freq);
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  };

  return { noise, fbm };
}

/* -------------------------------------------------------------------------- */
/* Shared painting machinery                                                   */
/* -------------------------------------------------------------------------- */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

const wrapDeg = (deg: number) => {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

type Surface = {
  width: number;
  height: number;
  /** Albedo as floats, RGB interleaved. */
  color: Float32Array;
  /** Height as floats around 0.5. */
  relief: Float32Array;
};

/**
 * Walks every texel, handing the painter its longitude/latitude in degrees
 * and the matching *unit sphere point* — noise is sampled on the sphere
 * itself, which is what keeps the seam at ±180° invisible and the poles from
 * pinching.
 */
function paintSphere(
  width: number,
  height: number,
  painter: (
    lon: number,
    lat: number,
    px: number,
    py: number,
    pz: number,
  ) => [number, number, number, number],
): Surface {
  const color = new Float32Array(width * height * 3);
  const relief = new Float32Array(width * height);
  const RAD = Math.PI / 180;
  for (let v = 0; v < height; v += 1) {
    const lat = 90 - ((v + 0.5) / height) * 180;
    const cosLat = Math.cos(lat * RAD);
    const sinLat = Math.sin(lat * RAD);
    for (let u = 0; u < width; u += 1) {
      const lon = ((u + 0.5) / width) * 360 - 180;
      const px = cosLat * Math.cos(lon * RAD);
      const py = sinLat;
      const pz = cosLat * Math.sin(lon * RAD);
      const [r, g, b, h] = painter(lon, lat, px, py, pz);
      const i = v * width + u;
      color[i * 3] = r;
      color[i * 3 + 1] = g;
      color[i * 3 + 2] = b;
      relief[i] = h;
    }
  }
  return { width, height, color, relief };
}

/**
 * Stamps a crater: a sunken bowl, a raised rim, and matching light and shadow
 * in the albedo. Works in degrees on the sphere so a crater near a pole stays
 * round instead of smearing across the whole map row.
 */
function stampCrater(
  surface: Surface,
  lonC: number,
  latC: number,
  radiusDeg: number,
  depth: number,
  tone: number,
): void {
  const { width, height, color, relief } = surface;
  const RAD = Math.PI / 180;
  const cosLatC = Math.max(0.18, Math.cos(latC * RAD));
  const vC = ((90 - latC) / 180) * height - 0.5;
  const dv = (radiusDeg / 180) * height * 1.45;
  const du = ((radiusDeg / 180) * width * 1.45) / 2 / cosLatC;
  const uC = ((lonC + 180) / 360) * width - 0.5;

  const v0 = Math.max(0, Math.floor(vC - dv));
  const v1 = Math.min(height - 1, Math.ceil(vC + dv));
  for (let v = v0; v <= v1; v += 1) {
    const lat = 90 - ((v + 0.5) / height) * 180;
    const dy = (lat - latC) / radiusDeg;
    for (let du2 = -Math.ceil(du); du2 <= Math.ceil(du); du2 += 1) {
      const u = (((Math.round(uC) + du2) % width) + width) % width;
      const lon = ((u + 0.5) / width) * 360 - 180;
      const dx = (wrapDeg(lon - lonC) * Math.cos(lat * RAD)) / radiusDeg;
      const rho = Math.hypot(dx, dy);
      if (rho > 1.35) continue;
      const bowl = 1 - smoothstep(0, 0.85, rho);
      const rimT = (rho - 0.95) / 0.17;
      const rim = Math.exp(-rimT * rimT);
      const i = v * width + u;
      relief[i] += -depth * bowl + depth * 0.75 * rim;
      const shade = tone * (rim * 0.9 - bowl * 0.65);
      color[i * 3] += shade;
      color[i * 3 + 1] += shade;
      color[i * 3 + 2] += shade;
    }
  }
}

function pack(surface: Surface): BakedTexture {
  const { width, height, color, relief } = surface;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = clamp01(color[i * 3]) * 255;
    pixels[i * 4 + 1] = clamp01(color[i * 3 + 1]) * 255;
    pixels[i * 4 + 2] = clamp01(color[i * 3 + 2]) * 255;
    pixels[i * 4 + 3] = clamp01(relief[i]) * 255;
  }
  return { width, height, pixels };
}

const mix3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Piecewise-linear colour by latitude — the whole anatomy of a gas giant. */
function bandColor(
  stops: Array<[number, [number, number, number]]>,
  lat: number,
): [number, number, number] {
  if (lat <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (lat <= stops[i][0]) {
      const t = (lat - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return mix3(stops[i - 1][1], stops[i][1], t);
    }
  }
  return stops[stops.length - 1][1];
}

/* -------------------------------------------------------------------------- */
/* The bodies                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The lunar seas, where they actually are.
 *
 * Noise alone makes a body that reads as *a* moon; it does not make *the*
 * Moon, and it cannot, because the Moon's face is not a texture — it is a
 * particular arrangement of basalt floods that every human being has looked
 * at. Painting them at their published selenographic centres does two things
 * at once: the world in the sky becomes recognisably ours, and a place saved
 * at "Sea of Tranquility, 8.5°N 31.4°E" lands on the sea it names rather than
 * near it.
 *
 * `[longitude, latitude, radius in degrees, darkness]`. One lunar degree is
 * about 30 km, so the radii are each mare's own half-width. The larger
 * irregular floods — Procellarum most of all — are several overlapping
 * circles, which is closer to their true shape than any one circle is.
 */
const MARIA: Array<[number, number, number, number]> = [
  // Oceanus Procellarum, the great western flood, in four laps.
  [-57, 18, 23, 1],
  [-52, 34, 16, 0.95],
  [-58, 2, 17, 0.9],
  [-45, 10, 14, 0.85],
  // Imbrium and its neighbours, north.
  [-15.6, 32.8, 19, 1],
  [1.4, 56, 11, 0.75],
  [-25, 58, 10, 0.7],
  [22, 54, 9, 0.7],
  // The eastern seas of the near side.
  [17.5, 28, 12, 1],
  [31.4, 8.5, 14.5, 1],
  [3.6, 13.3, 5, 0.8],
  [51.3, -7.8, 12, 0.95],
  [35.5, -15.2, 6.5, 0.9],
  [59.1, 17, 9, 1],
  // The southern seas.
  [-16.6, -21.3, 11, 0.9],
  [-38.6, -24.4, 7, 0.85],
  [-30.9, 7.5, 6, 0.7],
  // The far side keeps almost none — which is itself the point.
  [-92.8, -19.4, 6.5, 0.85],
  [147.9, 27.3, 4.5, 0.8],
  [163.5, -33.7, 5.5, 0.75],
  [129.1, -20.4, 2, 0.9],
];

/**
 * The named craters, at their own coordinates: the bright young ones that
 * give the near side its punctuation, and the dark-floored old ones.
 * `[longitude, latitude, radius in degrees, depth, tone]`.
 */
const NAMED_CRATERS: Array<[number, number, number, number, number]> = [
  [-20.08, 9.62, 1.6, 0.14, 0.2], // Copernicus
  [-11.36, -43.31, 1.5, 0.15, 0.24], // Tycho
  [-38, 8.1, 0.6, 0.1, 0.22], // Kepler
  [-47.4, 23.7, 0.7, 0.11, 0.26], // Aristarchus, the brightest spot there is
  [-9.3, 51.6, 1.7, 0.06, -0.1], // Plato, flooded dark
  [-14.4, -58.4, 3.9, 0.09, 0.08], // Clavius
  [-68.3, -5.5, 2.9, 0.05, -0.12], // Grimaldi, darker than the sea beside it
  [15.5, -9, 1.2, 0.09, 0.1], // Theophilus, near the Apollo 16 highlands
  [0, -89.9, 1.2, 0.12, 0.06], // Shackleton, at the pole
];

/** Radians per degree, for the great-circle work the maria need. */
const DEG = Math.PI / 180;

function bakeMoon(width: number, height: number): BakedTexture {
  const n = makeNoise3(101);

  /* Each mare as a unit vector and a pair of cosine thresholds. Comparing
     dot products against those is the same test as "within so many degrees"
     with none of the arc-cosines — and this runs once per texel per sea. */
  const seas = MARIA.map(([lon, lat, radius, depth]) => {
    const c = Math.cos(lat * DEG);
    return {
      x: c * Math.cos(lon * DEG),
      y: Math.sin(lat * DEG),
      z: c * Math.sin(lon * DEG),
      inner: Math.cos(radius * 0.72 * DEG),
      outer: Math.cos(Math.min(89, radius * 1.16) * DEG),
      depth,
    };
  });

  const surface = paintSphere(width, height, (lon, lat, x, y, z) => {
    const rough = n.fbm(x * 3.1, y * 3.1, z * 3.1, 5);

    /* The maria: vast basalt floods, darker and flatter than the highlands.
       Their edges are roughened by the same noise the surface is made of, so
       a sea meets its shore in bays and headlands rather than on a circle. */
    const ragged = 0.055 * n.fbm(x * 5.2 + 11.3, y * 5.2, z * 5.2, 3);
    let mare = 0;
    for (const sea of seas) {
      const towards = x * sea.x + y * sea.y + z * sea.z;
      if (towards <= sea.outer) continue;
      const edge = smoothstep(sea.outer, sea.inner, towards + ragged);
      mare = Math.max(mare, edge * sea.depth);
    }

    // A whisper of the old noise, so the highlands are never uniformly bright.
    const mottle = 0.06 * smoothstep(0.2, 0.55, n.fbm(x * 1.35 + 4.2, y * 1.35, z * 1.35, 4));

    const high = 0.63 + 0.1 * rough - mottle;
    const grey = high * (1 - mare) + (0.335 + 0.05 * rough) * mare;
    return [
      grey * 1.02,
      grey,
      grey * (1 - mare * 0.02) * 1.01,
      0.52 + 0.14 * rough - mare * 0.11,
    ];
  });

  const rand = mulberry32(9001);
  for (let i = 0; i < 140; i += 1) {
    const lat = (Math.asin(2 * rand() - 1) * 180) / Math.PI;
    const lon = rand() * 360 - 180;
    const radius = 1.4 + 13 * Math.pow(rand(), 2.6);
    const depth = 0.06 + 0.12 * Math.min(radius / 9, 1);
    // Most craters are old and soft; a few young ones flash a bright floor.
    const tone = rand() < 0.16 ? 0.16 : 0.09;
    stampCrater(surface, lon, Math.max(-76, Math.min(76, lat)), radius, depth, tone);
  }

  // The ones with names go last, so nothing anonymous is stamped over them.
  for (const [lon, lat, radius, depth, tone] of NAMED_CRATERS) {
    stampCrater(surface, lon, lat, radius, depth, tone);
  }
  // Tycho's rays, which reach a quarter of the way round the world.
  stampRays(surface, -11.36, -43.31, 34, 0.115, makeNoise3(717));
  stampRays(surface, -20.08, 9.62, 15, 0.075, makeNoise3(919));
  return pack(surface);
}

/**
 * The bright splash around a young crater: ejecta thrown out along great
 * circles and thinning with distance. Streaked by noise rather than drawn as
 * spokes — real ray systems are ragged, and a clean starburst reads as a
 * decal stuck on the Moon rather than as something that happened to it.
 */
function stampRays(
  surface: Surface,
  lonC: number,
  latC: number,
  reachDeg: number,
  strength: number,
  noise: Noise3,
): void {
  const { width, height, color } = surface;
  const cosLatC = Math.cos(latC * DEG);
  const centre = {
    x: cosLatC * Math.cos(lonC * DEG),
    y: Math.sin(latC * DEG),
    z: cosLatC * Math.sin(lonC * DEG),
  };
  const outer = Math.cos(Math.min(89.5, reachDeg) * DEG);

  for (let v = 0; v < height; v += 1) {
    const lat = 90 - ((v + 0.5) / height) * 180;
    const cosLat = Math.cos(lat * DEG);
    const sinLat = Math.sin(lat * DEG);
    for (let u = 0; u < width; u += 1) {
      const lon = ((u + 0.5) / width) * 360 - 180;
      const px = cosLat * Math.cos(lon * DEG);
      const py = sinLat;
      const pz = cosLat * Math.sin(lon * DEG);
      const towards = px * centre.x + py * centre.y + pz * centre.z;
      if (towards <= outer) continue;

      // Fades from the rim outward; the crater itself is stamped separately.
      const fall = smoothstep(outer, 1, towards);
      const streak = Math.max(0, noise.fbm(px * 14, py * 14, pz * 14, 3));
      const bright = strength * fall * fall * (0.25 + 1.35 * streak * streak);
      const i = v * width + u;
      color[i * 3] += bright;
      color[i * 3 + 1] += bright;
      color[i * 3 + 2] += bright;
    }
  }
}

function bakeMars(width: number, height: number): BakedTexture {
  const n = makeNoise3(202);
  const surface = paintSphere(width, height, (lon, lat, x, y, z) => {
    const dust = 0.5 + 0.5 * n.fbm(x * 2.2, y * 2.2, z * 2.2, 5);
    let [r, g, b] = mix3([0.62, 0.32, 0.18], [0.87, 0.56, 0.34], dust);
    // The dark volcanic mottling that gives Mars its face.
    const basalt = smoothstep(0.22, 0.5, n.fbm(x * 1.7 + 9.1, y * 1.7, z * 1.7, 4));
    [r, g, b] = mix3([r, g, b], [0.33, 0.2, 0.14], basalt * 0.72);
    // Polar caps, their edges gnawed by the seasons.
    const gnaw = 5 * n.fbm(x * 3.3, y * 3.3, z * 3.3 + 3.7, 3);
    const capN = smoothstep(77 + gnaw, 81 + gnaw, lat);
    const capS = smoothstep(75 - gnaw, 80 - gnaw, -lat);
    const cap = Math.max(capN, capS * 0.9);
    [r, g, b] = mix3([r, g, b], [0.93, 0.9, 0.88], cap);
    return [r, g, b, 0.5 + 0.13 * n.fbm(x * 3.6, y * 3.6, z * 3.6, 5) - basalt * 0.05];
  });
  const rand = mulberry32(9202);
  for (let i = 0; i < 48; i += 1) {
    const lat = (Math.asin(2 * rand() - 1) * 180) / Math.PI;
    stampCrater(
      surface,
      rand() * 360 - 180,
      Math.max(-70, Math.min(70, lat)),
      1 + 5 * Math.pow(rand(), 2.4),
      0.05,
      0.05,
    );
  }
  return pack(surface);
}

function bakeJupiter(width: number, height: number): BakedTexture {
  const n = makeNoise3(303);
  const stops: Array<[number, [number, number, number]]> = [
    [-90, [0.71, 0.65, 0.54]],
    [-56, [0.8, 0.74, 0.62]],
    [-42, [0.92, 0.88, 0.78]],
    [-30, [0.73, 0.52, 0.38]],
    [-18, [0.94, 0.9, 0.8]],
    [-8, [0.78, 0.57, 0.4]],
    [0, [0.93, 0.89, 0.8]],
    [9, [0.76, 0.55, 0.4]],
    [19, [0.95, 0.91, 0.82]],
    [31, [0.74, 0.55, 0.41]],
    [44, [0.9, 0.86, 0.76]],
    [60, [0.79, 0.72, 0.6]],
    [90, [0.69, 0.63, 0.53]],
  ];
  return pack(
    paintSphere(width, height, (lon, lat, x, y, z) => {
      // Bands wander: sampled with longitude stretched so the turbulence
      // shears sideways, the way belts actually curdle.
      const warp = n.fbm(x * 1.1, y * 4.5, z * 1.1, 4) * 4.6;
      let [r, g, b] = bandColor(stops, lat + warp);
      const streak = n.fbm(x * 2.4, y * 9, z * 2.4, 4) * 0.05;
      r += streak;
      g += streak;
      b += streak * 0.9;
      // The Great Red Spot, with its pale collar and inner swirl.
      const dx = wrapDeg(lon - 135) * Math.cos((lat * Math.PI) / 180);
      const rho = Math.hypot(dx / 16, (lat + 21) / 9);
      if (rho < 1.5) {
        const core = 1 - smoothstep(0.55, 1.05, rho);
        const swirl = 0.05 * Math.sin(rho * 8.5) * core;
        [r, g, b] = mix3([r, g, b], [0.79, 0.4, 0.29], core * 0.85);
        const collarT = (rho - 1.18) / 0.16;
        const collar = Math.exp(-collarT * collarT) * 0.5;
        [r, g, b] = mix3([r, g, b], [0.95, 0.92, 0.84], collar);
        r += swirl;
        g += swirl;
        b += swirl;
      }
      return [r, g, b, 0.5];
    }),
  );
}

function bakeSaturn(width: number, height: number): BakedTexture {
  const n = makeNoise3(404);
  const stops: Array<[number, [number, number, number]]> = [
    [-90, [0.62, 0.57, 0.46]],
    [-52, [0.78, 0.7, 0.53]],
    [-26, [0.87, 0.79, 0.6]],
    [-9, [0.93, 0.86, 0.67]],
    [4, [0.9, 0.83, 0.64]],
    [19, [0.94, 0.88, 0.69]],
    [38, [0.85, 0.77, 0.58]],
    [62, [0.75, 0.68, 0.52]],
    // The teal wash the polar hexagon photographs show.
    [90, [0.55, 0.58, 0.53]],
  ];
  return pack(
    paintSphere(width, height, (lon, lat, x, y, z) => {
      const warp = n.fbm(x * 1.2, y * 3.8, z * 1.2, 4) * 2.4;
      let [r, g, b] = bandColor(stops, lat + warp);
      const streak = n.fbm(x * 2.1, y * 8, z * 2.1, 3) * 0.028;
      r += streak;
      g += streak;
      b += streak;
      return [r, g, b, 0.5];
    }),
  );
}

function bakeVenus(width: number, height: number): BakedTexture {
  const n = makeNoise3(505);
  return pack(
    paintSphere(width, height, (lon, lat, x, y, z) => {
      // Sulphuric cloud chevrons, sheared toward the equator.
      const shear = (lon / 90) * (lat / 40);
      const v = n.fbm(x * 2.1, y * 2.6 + shear, z * 2.1, 4);
      const w = n.fbm(x * 4.6, y * 5.2, z * 4.6, 3) * 0.02;
      const base: [number, number, number] = [0.9, 0.84, 0.69];
      const [r, g, b] = mix3(base, [0.78, 0.7, 0.55], smoothstep(-0.1, 0.45, v) * 0.5);
      return [r + w, g + w, b + w * 0.8, 0.5];
    }),
  );
}

function bakeNeptune(width: number, height: number): BakedTexture {
  const n = makeNoise3(606);
  return pack(
    paintSphere(width, height, (lon, lat, x, y, z) => {
      const zone = Math.cos((lat * Math.PI) / 60);
      let [r, g, b] = mix3([0.16, 0.28, 0.68], [0.35, 0.52, 0.92], clamp01(zone));
      const wisp = clamp01(n.fbm(x * 2.2, y * 6, z * 2.2, 3)) * 0.16;
      r += wisp;
      g += wisp;
      b += wisp * 0.6;
      const dx = wrapDeg(lon - 80) * Math.cos((lat * Math.PI) / 180);
      const spot = 1 - smoothstep(6, 14, Math.hypot(dx, (lat + 28) * 1.6));
      [r, g, b] = mix3([r, g, b], [0.1, 0.16, 0.45], spot * 0.7);
      return [r, g, b, 0.5];
    }),
  );
}

function bakeUranus(width: number, height: number): BakedTexture {
  const n = makeNoise3(808);
  return pack(
    paintSphere(width, height, (lon, lat, x, y, z) => {
      // Almost featureless: the palest cyan, a breath of banding, a brighter
      // hood over the sunlit pole — which, on its side, is an equator's worth
      // of strangeness.
      const band = n.fbm(x * 1.4, y * 3.2, z * 1.4, 3) * 0.03;
      const hood = smoothstep(35, 75, lat) * 0.05;
      return [0.5 + band + hood, 0.76 + band + hood, 0.8 + band * 0.6 + hood, 0.5];
    }),
  );
}

function bakePluto(width: number, height: number): BakedTexture {
  const n = makeNoise3(909);
  const surface = paintSphere(width, height, (lon, lat, x, y, z) => {
    const grain = n.fbm(x * 3, y * 3, z * 3, 4);
    let [r, g, b] = mix3([0.55, 0.45, 0.38], [0.78, 0.7, 0.62], 0.5 + 0.5 * grain);
    // The bright plain and the dark whale beside it.
    const dx = wrapDeg(lon - 20) * Math.cos((lat * Math.PI) / 180);
    const heart = 1 - smoothstep(20, 42, Math.hypot(dx, (lat + 5) * 1.5));
    [r, g, b] = mix3([r, g, b], [0.92, 0.88, 0.82], heart * 0.8);
    const dw = wrapDeg(lon + 60) * Math.cos((lat * Math.PI) / 180);
    const whale = 1 - smoothstep(18, 40, Math.hypot(dw, (lat + 10) * 1.7));
    [r, g, b] = mix3([r, g, b], [0.32, 0.24, 0.19], whale * 0.7);
    return [r, g, b, 0.5 + 0.12 * grain];
  });
  return pack(surface);
}

export function bakeBodyTexture(kind: BodyKind): BakedTexture {
  const [width, height] = TEXTURE_SIZES[kind];
  switch (kind) {
    case "moon":
      return bakeMoon(width, height);
    case "mars":
      return bakeMars(width, height);
    case "jupiter":
      return bakeJupiter(width, height);
    case "saturn":
      return bakeSaturn(width, height);
    case "venus":
      return bakeVenus(width, height);
    case "neptune":
      return bakeNeptune(width, height);
    case "uranus":
      return bakeUranus(width, height);
    case "pluto":
      return bakePluto(width, height);
  }
}

/* -------------------------------------------------------------------------- */
/* Saturn's rings                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A one-texel-tall radial profile of the rings, from the inner edge of the C
 * ring to just past the A ring's rim: colour in RGB, opacity in alpha. The
 * classic anatomy is all here — translucent C, bright B, the Cassini
 * division's empty lane, the A ring with the hairline Encke gap — plus a
 * grain of noise, because a thousand ringlets is what the rings are.
 */
export function bakeRingStrip(width: number = RING_STRIP_WIDTH): BakedTexture {
  const inner = 1.24;
  const outer = 2.3;
  const n = makeNoise3(707);
  const pixels = new Uint8ClampedArray(width * 4);

  const band = (rho: number, from: number, to: number, feather: number) =>
    smoothstep(from - feather, from + feather, rho) *
    (1 - smoothstep(to - feather, to + feather, rho));

  for (let u = 0; u < width; u += 1) {
    const rho = inner + ((u + 0.5) / width) * (outer - inner);
    let alpha =
      band(rho, 1.25, 1.52, 0.015) * 0.2 +
      band(rho, 1.52, 1.72, 0.012) * 0.92 +
      band(rho, 1.72, 1.95, 0.012) * 0.74 +
      band(rho, 1.95, 2.02, 0.008) * 0.04 +
      band(rho, 2.02, 2.27, 0.012) * 0.58;
    // The Encke gap: a groove a needle would miss.
    const enckeT = (rho - 2.21) / 0.012;
    alpha *= 1 - 0.85 * Math.exp(-enckeT * enckeT);
    // Ringlets: fine radial grain, never organised enough to read as stripes.
    alpha *= 0.8 + 0.34 * n.noise(rho * 61, 3.7, 1.2);

    const dusty = band(rho, 1.25, 1.52, 0.02);
    const shine = 0.9 + 0.14 * n.noise(rho * 29, 8.5, 4.1);
    const r = (0.86 - dusty * 0.3) * shine;
    const g = (0.79 - dusty * 0.28) * shine;
    const b = (0.65 - dusty * 0.22) * shine;

    pixels[u * 4] = clamp01(r) * 255;
    pixels[u * 4 + 1] = clamp01(g) * 255;
    pixels[u * 4 + 2] = clamp01(b) * 255;
    pixels[u * 4 + 3] = clamp01(alpha) * 255;
  }
  return { width, height: 1, pixels };
}
