/**
 * The celestial sphere behind the globe.
 *
 * Everything out there — the Sun, the Moon, the planets, the brightest stars —
 * has a fixed position on a sphere of infinite radius, given as a longitude
 * and latitude in the same frame the Earth's own coordinates use. Turning the
 * globe turns the camera, and the camera is all that moves: project each
 * body's direction through the current view and the whole sky slides,
 * planets rising over one limb and setting behind the other, exactly as it
 * would through a spacecraft window. Nothing in here animates on its own; the
 * sky is a place, and the traveller's hand is what moves it.
 *
 * Like the starfield, the arrangement is fixed and deliberate: from the
 * camera the app opens on, the Moon hangs in the upper-left field of sky,
 * Saturn upper-right, Mars and Jupiter low over the southern limb — and the
 * Sun waits half a turn to the west, so spinning the globe is what finds
 * the dawn.
 */

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

/**
 * A direction in the world frame: X out of (0°N, 0°E), Y out of the north
 * pole, Z out of (0°N, 90°E). The same frame MapLibre's globe rotates in.
 */
export function worldDir(longitude: number, latitude: number): Vec3 {
  const lat = latitude * RAD;
  const lng = longitude * RAD;
  const c = Math.cos(lat);
  return [c * Math.cos(lng), Math.sin(lat), c * Math.sin(lng)];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

/**
 * The camera's frame when it hangs over a point of the Earth: `forward` from
 * the planet's centre toward the camera, `east` to the right of the screen,
 * `up` toward the top. Rotation is locked off in the map (`dragRotate:
 * false`), so screen-up is always north at the centre and this basis is the
 * whole story.
 */
export type ViewBasis = { east: Vec3; up: Vec3; forward: Vec3 };

export function viewBasis(longitude: number, latitude: number): ViewBasis {
  const forward = worldDir(longitude, latitude);
  const lng = longitude * RAD;
  const east: Vec3 = [-Math.sin(lng), 0, Math.cos(lng)];
  // east × forward is +Y at the equator: up on screen is north at the centre.
  const up = normalize(cross(east, forward));
  return { east, up, forward };
}

/** A world direction in camera terms: right of screen, up screen, toward camera. */
export function toCamera(basis: ViewBasis, dir: Vec3): Vec3 {
  return [dot(dir, basis.east), dot(dir, basis.up), dot(dir, basis.forward)];
}

/**
 * Where a celestial direction lands on screen, as offsets from the point the
 * camera is looking at. Equidistant ("fisheye") rather than a pinhole
 * projection: a pinhole blows up long before a body is behind you, and a sky
 * has to stay well-behaved all the way round to where it sets.
 *
 * `y` is screen-down, matching every pixel coordinate in the app. `angle` is
 * the great-circle distance from the view centre in degrees — past ~90° a
 * body is over the shoulder of the planet, and the caller fades it away.
 */
export type SkyPoint = { x: number; y: number; angle: number };

export function projectDirection(basis: ViewBasis, dir: Vec3, pxPerDeg: number): SkyPoint {
  const [right, up, depth] = toCamera(basis, dir);
  const angle = Math.acos(Math.min(1, Math.max(-1, depth))) / RAD;
  const flat = Math.hypot(right, up);
  if (flat < 1e-9) return { x: 0, y: 0, angle };
  const scale = (angle * pxPerDeg) / flat;
  return { x: right * scale, y: -up * scale, angle };
}

/** The starfield tile's period, shared with the CSS that paints it. */
export const STAR_TILE = 1024;

/**
 * How many pixels one degree of sky is worth.
 *
 * Chosen so the sky rotates at about the rate the framed Earth's own limb
 * does — the planet fills most of a phone's width, so a point on its edge
 * moves ~R·π/180 per degree of spin, and the stars keeping station with it is
 * what makes the turn read as *you* orbiting rather than a backdrop sliding.
 *
 * Snapped so that a full turn of the globe is an exact number of starfield
 * tiles: spin all the way round and the very same sky is waiting, star for
 * star, which is the difference between a place and a pattern.
 */
export function skyPxPerDeg(width: number, height: number): number {
  const raw = Math.max(220, Math.min(width, height)) / 130;
  const tilesPerTurn = Math.max(1, Math.round((raw * 360) / STAR_TILE));
  return (tilesPerTurn * STAR_TILE) / 360;
}

/**
 * The rate the planets and the Sun move at, which follows the Earth when the
 * Earth is the bigger thing on screen.
 *
 * A point on the limb of a globe of radius R moves R·π/180 pixels per degree
 * of spin; matching it makes the sky and the planet turn as one rigid scene —
 * and, just as important, it keeps the sky *populated*: a traveller whose
 * places frame a large Earth would otherwise find every body hiding inside
 * the planet's silhouette, with only the emptiest reaches of sky left
 * showing. The starfield keeps the fixed tile-snapped rate above — points of
 * light moving a shade slower than the worlds is a depth cue, not an error.
 */
export function bodyPxPerDeg(
  width: number,
  height: number,
  earthRadius: number | null,
): number {
  const base = skyPxPerDeg(width, height);
  if (earthRadius === null || !Number.isFinite(earthRadius)) return base;
  // A shade over the limb's own rate, so the worlds ride just clear of the
  // planet's silhouette instead of grazing it — a body exactly at the
  // eye-to-limb angle would otherwise spend every framing half-swallowed.
  return Math.max(base, (earthRadius * Math.PI) / 180 * 1.08);
}

/**
 * The background starfield's translation for a view, wrapped to the tile so a
 * full turn of the globe brings the same stars back with no visible seam.
 * Centred on zero, so the painted layer only ever needs to overhang the
 * viewport by half a tile.
 */
export function starfieldOffset(
  longitude: number,
  latitude: number,
  pxPerDeg: number,
): { x: number; y: number } {
  const wrap = (value: number) =>
    ((value % STAR_TILE) + STAR_TILE * 1.5) % STAR_TILE - STAR_TILE / 2;
  return { x: wrap(-longitude * pxPerDeg), y: wrap(latitude * pxPerDeg) };
}

/* -------------------------------------------------------------------------- */
/* The solar system                                                            */
/* -------------------------------------------------------------------------- */

export type BodyKind =
  | "moon"
  | "mars"
  | "jupiter"
  | "saturn"
  | "venus"
  | "neptune"
  | "uranus"
  | "pluto";

export type SkyBody = {
  kind: BodyKind;
  /** Where the body hangs on the celestial sphere. */
  longitude: number;
  latitude: number;
  /** Apparent radius in CSS px on a 390px-wide phone; scaled with the screen. */
  radius: number;
  /** Where the body's north pole points — Saturn's lean is what tips its ring. */
  axis: { longitude: number; latitude: number };
  /** Polar flattening: 1 is a perfect sphere; gas giants bulge. */
  flatten: number;
  /** 0–1: how hard the disc darkens toward its edge. Airless rock barely does. */
  limb: number;
  /** 0–1: how much the baked height channel roughens the lighting. */
  bump: number;
  /** The thin bright air at the edge of the disc, and its colour. */
  atmosphere: [number, number, number];
  atmosphereStrength: number;
  /** Flat colour the disc wears for the frames before its texture is baked. */
  base: [number, number, number];
  /** Ring extents in planet radii, for the one body that has them. */
  ring?: { inner: number; outer: number };
};

/**
 * Positions are chosen against the camera the app opens on (lng 8°, lat 24°)
 * and a portrait phone, where the framed Earth spans nearly the full width
 * and the open sky is the bands above and below it: a first-quarter Moon
 * upper-left with its craters strung along the terminator, gibbous Saturn
 * upper-right with the rings open, Mars and Jupiter along the arc below the
 * southern limb, Neptune a blue point lower-left. The far side of the sphere
 * holds what a spin is for: the Sun, with a crescent Venus for a herald.
 */
export const SKY_BODIES: SkyBody[] = [
  {
    kind: "saturn",
    longitude: 95,
    latitude: 55,
    radius: 24,
    // Leaning 6° off the world's pole, so the rings open toward the camera at
    // about the angle the photographs do — and close to a knife-edge when the
    // view swings round the other side.
    axis: { longitude: -40, latitude: 84 },
    flatten: 0.9,
    limb: 0.55,
    bump: 0,
    atmosphere: [0.98, 0.93, 0.78],
    atmosphereStrength: 0.16,
    base: [0.87, 0.78, 0.58],
    ring: { inner: 1.24, outer: 2.3 },
  },
  {
    kind: "moon",
    longitude: -85,
    latitude: 60,
    radius: 25,
    axis: { longitude: 0, latitude: 90 },
    flatten: 1,
    // Airless rock: no limb darkening to speak of, no atmosphere at all —
    // the full Moon looks flat as a coin, and that flatness is lunar.
    limb: 0.12,
    bump: 1,
    atmosphere: [0, 0, 0],
    atmosphereStrength: 0,
    base: [0.72, 0.73, 0.76],
  },
  {
    kind: "mars",
    longitude: 60,
    latitude: -40,
    radius: 11,
    axis: { longitude: 30, latitude: 65 },
    flatten: 1,
    limb: 0.3,
    bump: 0.5,
    atmosphere: [0.95, 0.66, 0.48],
    atmosphereStrength: 0.14,
    base: [0.78, 0.45, 0.28],
  },
  {
    kind: "neptune",
    longitude: -50,
    latitude: -58,
    radius: 6,
    axis: { longitude: 0, latitude: 80 },
    flatten: 0.96,
    limb: 0.7,
    bump: 0,
    atmosphere: [0.55, 0.75, 1],
    atmosphereStrength: 0.3,
    base: [0.25, 0.42, 0.85],
  },
  {
    kind: "venus",
    longitude: -125,
    latitude: 8,
    radius: 8,
    axis: { longitude: 0, latitude: 90 },
    flatten: 1,
    limb: 0.5,
    bump: 0,
    atmosphere: [1, 0.95, 0.8],
    atmosphereStrength: 0.35,
    base: [0.91, 0.85, 0.72],
  },
  {
    kind: "jupiter",
    longitude: 25,
    latitude: -60,
    radius: 28,
    axis: { longitude: 0, latitude: 87 },
    flatten: 0.935,
    limb: 0.65,
    bump: 0,
    atmosphere: [0.85, 0.82, 0.72],
    atmosphereStrength: 0.12,
    base: [0.85, 0.76, 0.62],
  },
  // Far enough north to ride the top of the sky for the views the rest of
  // the solar system deserts — a Pacific-centred world, framed at the ±52°
  // ceiling a whole-planet collection is framed at — without slipping inside
  // the limb cone the way a true polar body would from up there.
  {
    kind: "uranus",
    longitude: -15,
    latitude: 68,
    radius: 10,
    // Knocked on its side, the way the real one famously is.
    axis: { longitude: 60, latitude: 8 },
    flatten: 0.97,
    limb: 0.75,
    bump: 0,
    atmosphere: [0.62, 0.9, 0.92],
    atmosphereStrength: 0.3,
    base: [0.55, 0.78, 0.81],
  },
  {
    kind: "pluto",
    longitude: 180,
    latitude: -65,
    radius: 4.5,
    axis: { longitude: 0, latitude: 60 },
    flatten: 1,
    limb: 0.25,
    bump: 0.4,
    atmosphere: [0, 0, 0],
    atmosphereStrength: 0,
    base: [0.75, 0.66, 0.58],
  },
];

/**
 * The Sun: a glare rather than a disc, nearly half a turn west of the opening
 * view. Every phase in the sky answers to this one position — bodies near it
 * show crescents, bodies opposite show full — and finding it is the reward
 * for spinning the globe toward yesterday.
 */
export const SUN = { longitude: -150, latitude: -10, radius: 150 };

/** Direction of sunlight, shared by every lit thing in the scene. */
export const SUN_DIR: Vec3 = worldDir(SUN.longitude, SUN.latitude);

/**
 * The handful of stars bright enough to earn a diffraction glint and a
 * twinkle. Spread so two or three ride every sky the globe can show.
 */
export const GLINT_STARS = [
  { longitude: -30, latitude: 44, scale: 1, period: 7, delay: 0 },
  { longitude: 120, latitude: 10, scale: 0.8, period: 9, delay: -3.2 },
  { longitude: 60, latitude: -28, scale: 0.9, period: 8, delay: -5.5 },
  { longitude: -140, latitude: -45, scale: 0.72, period: 11, delay: -1.8 },
  { longitude: 170, latitude: 55, scale: 0.85, period: 10, delay: -4.4 },
  { longitude: -78, latitude: -8, scale: 0.66, period: 8.5, delay: -2.6 },
  { longitude: 28, latitude: 74, scale: 0.78, period: 9.5, delay: -6.1 },
] as const;

/** Bodies grow a little with the screen, and never so much they rival Earth. */
export function sceneScale(width: number, height: number): number {
  return Math.min(1.5, Math.max(0.9, Math.min(width, height) / 390));
}

/**
 * A body's own frame, for turning a surface normal into texture coordinates:
 * `meridian` marks longitude zero, `axis` is the pole, `binormal` completes
 * the trihedron. Fixed per body, so the face you see is decided entirely by
 * where you stand — spin the globe and the far side of the Moon comes round.
 */
export type BodyFrame = { meridian: Vec3; axis: Vec3; binormal: Vec3 };

export function bodyFrame(body: SkyBody): BodyFrame {
  const axis = worldDir(body.axis.longitude, body.axis.latitude);
  // Any reference direction not parallel to the axis will do; every axis in
  // the scene points well away from the equator, so X is always safe.
  const seed: Vec3 = [1, 0, 0];
  const meridian = normalize([
    seed[0] - axis[0] * dot(seed, axis),
    seed[1] - axis[1] * dot(seed, axis),
    seed[2] - axis[2] * dot(seed, axis),
  ]);
  return { meridian, axis, binormal: cross(axis, meridian) };
}

/* -------------------------------------------------------------------------- */
/* Standing off another world                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A rotation, as its three rows. Applied with {@link applyMat3}.
 *
 * There is exactly one of these in the app, and it exists so that opening a
 * place on the Moon can bring *that* part of the Moon round to face you. The
 * body's own frame is fixed to the celestial sphere — which is what makes the
 * far side genuinely far — so the only honest way to look at a named crater is
 * to turn the whole world under it, once, and then let the camera go on
 * turning it from there.
 */
export type Mat3 = [Vec3, Vec3, Vec3];

export const NO_ROTATION: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
}

/** The body whose kind this is, or null for a kind the sky does not carry. */
export function bodyOfKind(kind: BodyKind): SkyBody | null {
  return SKY_BODIES.find((body) => body.kind === kind) ?? null;
}

/**
 * The world direction of one point on a body's surface.
 *
 * The inverse of what the shader does to find a texel: it turns a surface
 * normal into `lon = atan2(n·meridian, n·binormal)` and `lat = asin(n·axis)`,
 * so longitude zero lies along the binormal and the meridian is 90° east.
 * Read this and that together — a marker placed with this lands exactly on the
 * feature the map paints at those coordinates.
 */
export function bodySurfaceDir(
  frame: BodyFrame,
  longitude: number,
  latitude: number,
): Vec3 {
  const lat = latitude * RAD;
  const lng = longitude * RAD;
  const east = Math.cos(lat) * Math.sin(lng);
  const north = Math.sin(lat);
  const prime = Math.cos(lat) * Math.cos(lng);
  return normalize([
    east * frame.meridian[0] + north * frame.axis[0] + prime * frame.binormal[0],
    east * frame.meridian[1] + north * frame.axis[1] + prime * frame.binormal[1],
    east * frame.meridian[2] + north * frame.axis[2] + prime * frame.binormal[2],
  ]);
}

export function rotateBodyFrame(frame: BodyFrame, rotation: Mat3): BodyFrame {
  return {
    meridian: applyMat3(rotation, frame.meridian),
    axis: applyMat3(rotation, frame.axis),
    binormal: applyMat3(rotation, frame.binormal),
  };
}

/** An orthonormal trihedron whose first leg is `primary`. */
function triad(primary: Vec3, secondary: Vec3): [Vec3, Vec3, Vec3] {
  const first = normalize(primary);
  const along = dot(secondary, first);
  let second: Vec3 = [
    secondary[0] - first[0] * along,
    secondary[1] - first[1] * along,
    secondary[2] - first[2] * along,
  ];
  if (Math.hypot(second[0], second[1], second[2]) < 1e-6) {
    // `secondary` was parallel to `primary`; any perpendicular will do.
    const seed: Vec3 = Math.abs(first[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const proj = dot(seed, first);
    second = [seed[0] - first[0] * proj, seed[1] - first[1] * proj, seed[2] - first[2] * proj];
  }
  second = normalize(second);
  return [first, second, cross(first, second)];
}

/**
 * The rotation that carries `from` onto `to`, with `fromUp` swung as near
 * `toUp` as a rotation allows. Two trihedra and one matrix product — the
 * standard way to say "point this at that, and keep it the right way up".
 */
export function alignRotation(from: Vec3, fromUp: Vec3, to: Vec3, toUp: Vec3): Mat3 {
  const [a1, a2, a3] = triad(from, fromUp);
  const [b1, b2, b3] = triad(to, toUp);
  const row = (i: number): Vec3 => [
    b1[i] * a1[0] + b2[i] * a2[0] + b3[i] * a3[0],
    b1[i] * a1[1] + b2[i] * a2[1] + b3[i] * a3[1],
    b1[i] * a1[2] + b2[i] * a2[2] + b3[i] * a3[2],
  ];
  return [row(0), row(1), row(2)];
}

/**
 * The one turn that brings a named spot on a body round to face the camera,
 * north up, for a camera pointing at (`viewLongitude`, `viewLatitude`).
 *
 * Frozen once, when a lunar place is opened, rather than recomputed per frame:
 * a rotation that chased the camera would nail the site to the middle of the
 * screen and leave dragging doing nothing at all. Fixed, the site arrives
 * facing you and the Moon turns under your finger from there — which is the
 * difference between looking at a world and looking at a picture of one.
 */
export function siteFacingRotation(
  body: SkyBody,
  site: { longitude: number; latitude: number },
  viewLongitude: number,
  viewLatitude: number,
): Mat3 {
  const frame = bodyFrame(body);
  const basis = viewBasis(viewLongitude, viewLatitude);
  return alignRotation(
    bodySurfaceDir(frame, site.longitude, site.latitude),
    frame.axis,
    basis.forward,
    basis.up,
  );
}

/**
 * A body pulled out of the sky and made the subject.
 *
 * `amount` runs 0 → 1 as the camera leaves the Earth behind: at 0 the body is
 * exactly where the celestial sphere puts it, at its own apparent size; at 1
 * it sits at (`originX`, `originY`) filling `radius`. Everything between is
 * one journey across the sky, which is what the eye needs in order to believe
 * the thing it is now looking at is the thing that was hanging up there.
 */
export type SkyFocus = {
  kind: BodyKind;
  amount: number;
  originX: number;
  originY: number;
  radius: number;
  /** The frozen turn from {@link siteFacingRotation}, if a site was named. */
  rotation?: Mat3;
  /** The spot to mark on the surface, in the body's own coordinates. */
  site?: { longitude: number; latitude: number };
};

/** Ease in and out, so the approach starts and settles rather than snapping. */
export function focusEase(amount: number): number {
  const t = Math.min(1, Math.max(0, amount));
  return t * t * (3 - 2 * t);
}

/** Where a focused body actually lands, shared by the renderer and the marker. */
export function focusedPlacement(
  sky: { x: number; y: number; radius: number },
  focus: SkyFocus | null,
): { x: number; y: number; radius: number } {
  if (!focus || focus.amount <= 0) return sky;
  const t = focusEase(focus.amount);
  const lerp = (from: number, to: number) => from + (to - from) * t;
  return {
    x: lerp(sky.x, focus.originX),
    y: lerp(sky.y, focus.originY),
    radius: lerp(sky.radius, focus.radius),
  };
}

/**
 * The Earth's drawn radius when it is a disc on screen rather than a wall of
 * map — the one number the sky needs from the renderer, and the same test on
 * both sides of it so the marker and the world it marks never disagree.
 */
export function visibleEarthRadius(
  earthRadius: number | null,
  width: number,
  height: number,
): number | null {
  if (earthRadius === null || !Number.isFinite(earthRadius)) return null;
  return earthRadius > 24 && earthRadius < Math.max(width, height) * 1.15 ? earthRadius : null;
}

/**
 * A camera direction from which a focused world's near face is in daylight.
 *
 * The whole sky is lit by one fixed Sun, and the face a world shows is decided
 * by where you stand — so opening a place on the Moon from a camera pointed
 * away from the Sun means arriving at a crater in the dark. This turns the
 * camera the shortest way toward the dawn, and only as far as it has to: a
 * view already in daylight is left exactly where it was, so leaving Earth
 * still starts from wherever you were looking.
 *
 * `minLight` is the cosine of the angle between the camera and the Sun — 0.5
 * puts the terminator sixty degrees out, which is a fat gibbous with the
 * shadows still showing at the limb rather than a flat coin.
 */
export function sunlitView(
  longitude: number,
  latitude: number,
  minLight = 0.5,
): { longitude: number; latitude: number } {
  const forward = worldDir(longitude, latitude);
  const towardSun = dot(forward, SUN_DIR);
  if (towardSun >= minLight) return { longitude, latitude };

  const apart = Math.acos(Math.min(1, Math.max(-1, towardSun)));
  const wanted = Math.acos(minLight);
  const sin = Math.sin(apart);
  /* Dead in line with the Sun, either way round, leaves no shortest arc to
     turn along — every great circle is as short as every other. Standing where
     the Sun stands is one of them, and the simplest to name. */
  if (Math.abs(sin) < 1e-6) return { longitude: SUN.longitude, latitude: SUN.latitude };

  const t = Math.min(1, Math.max(0, (apart - wanted) / apart));
  const a = Math.sin((1 - t) * apart) / sin;
  const b = Math.sin(t * apart) / sin;
  const turned = normalize([
    forward[0] * a + SUN_DIR[0] * b,
    forward[1] * a + SUN_DIR[1] * b,
    forward[2] * a + SUN_DIR[2] * b,
  ]);

  return {
    longitude: (Math.atan2(turned[2], turned[0]) * 180) / Math.PI,
    latitude: (Math.asin(Math.min(1, Math.max(-1, turned[1]))) * 180) / Math.PI,
  };
}
