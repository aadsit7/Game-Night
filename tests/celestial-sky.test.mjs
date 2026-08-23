/**
 * The sky behind the globe.
 *
 * The celestial scene is geometry plus procedural painting, and both fail the
 * way the framing math used to fail: code that reads plausibly and puts
 * Saturn behind the viewer's ear, or bakes a Moon with a visible seam down
 * the antimeridian. Nothing but a screenshot would catch it — these
 * assertions are what a screenshot was doing.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const sky = await import("../lib/space/celestial.ts");
const paint = await import("../lib/space/planetTextures.ts");
const { DEFAULT_CAMERA } = await import("../lib/maps/basemap.ts");

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log("  ✓", label);
  } catch (error) {
    failures += 1;
    console.log("  ✗", label, "—", error.message.split("\n")[0]);
  }
};

console.log("projecting the celestial sphere");

check("the point you look at projects to the centre of the screen", () => {
  const basis = sky.viewBasis(8, 24);
  const at = sky.projectDirection(basis, sky.worldDir(8, 24), 3);
  assert.ok(Math.abs(at.x) < 1e-6 && Math.abs(at.y) < 1e-6);
  assert.ok(at.angle < 1e-3);
});

check("a body due east lands right of centre, at its angular distance", () => {
  const basis = sky.viewBasis(0, 0);
  const at = sky.projectDirection(basis, sky.worldDir(40, 0), 3);
  assert.ok(Math.abs(at.angle - 40) < 1e-6, `angle ${at.angle}`);
  assert.ok(Math.abs(at.x - 120) < 1e-6, `x ${at.x}`);
  assert.ok(Math.abs(at.y) < 1e-6, `y ${at.y}`);
});

check("a body north of the view rises toward the top of the screen", () => {
  const basis = sky.viewBasis(0, 0);
  const at = sky.projectDirection(basis, sky.worldDir(0, 50), 3);
  assert.ok(Math.abs(at.y + 150) < 1e-6, `y ${at.y}`);
  assert.ok(Math.abs(at.x) < 1e-6);
});

check("the antipode is behind you, and says so", () => {
  const basis = sky.viewBasis(10, 20);
  const at = sky.projectDirection(basis, sky.worldDir(-170, -20), 3);
  assert.ok(Math.abs(at.angle - 180) < 1e-3, `angle ${at.angle}`);
});

check("turning the globe east slides the sky west", () => {
  const dir = sky.worldDir(40, 10);
  const before = sky.projectDirection(sky.viewBasis(0, 0), dir, 3);
  const after = sky.projectDirection(sky.viewBasis(10, 0), dir, 3);
  assert.ok(after.x < before.x, `${after.x} not west of ${before.x}`);
});

check("the seam at the antimeridian is no seam", () => {
  const dir = sky.worldDir(150, 5);
  const a = sky.projectDirection(sky.viewBasis(179.5, 10), dir, 3);
  const b = sky.projectDirection(sky.viewBasis(-180.5, 10), dir, 3);
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
});

check("a body's frame is an honest trihedron", () => {
  for (const body of sky.SKY_BODIES) {
    const frame = sky.bodyFrame(body);
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    assert.ok(Math.abs(dot(frame.meridian, frame.axis)) < 1e-9, body.kind);
    assert.ok(Math.abs(dot(frame.meridian, frame.meridian) - 1) < 1e-9, body.kind);
    assert.ok(Math.abs(dot(frame.binormal, frame.binormal) - 1) < 1e-9, body.kind);
  }
});

console.log("the starfield's wrap");

check("a full turn of the globe brings the very same stars back", () => {
  const pxPerDeg = sky.skyPxPerDeg(390, 740);
  const before = sky.starfieldOffset(123.4, 31, pxPerDeg);
  const after = sky.starfieldOffset(123.4 + 360, 31, pxPerDeg);
  assert.ok(Math.abs(before.x - after.x) < 1e-6, `${before.x} vs ${after.x}`);
  assert.ok(Math.abs(before.y - after.y) < 1e-6);
});

check("offsets stay within half a tile, so the painted layer always covers", () => {
  const pxPerDeg = sky.skyPxPerDeg(1200, 800);
  for (const lng of [-720, -191, -45, 0, 13.7, 179, 359, 1080]) {
    const offset = sky.starfieldOffset(lng, 48, pxPerDeg);
    assert.ok(Math.abs(offset.x) <= sky.STAR_TILE / 2 + 1e-6, `x ${offset.x} at ${lng}`);
    assert.ok(Math.abs(offset.y) <= sky.STAR_TILE / 2 + 1e-6, `y ${offset.y}`);
  }
});

console.log("the sky the app opens on");

/*
 * A portrait phone, the default camera, and the framed Earth filling most of
 * the width: the composition the CSS planets used to hard-code is now a
 * consequence of where the bodies hang, so it is asserted rather than styled.
 */
const phone = { width: 390, height: 740 };
const origin = { x: phone.width / 2, y: phone.height / 2 };
// The framed planet spans nearly the full width of a phone.
const earthRadius = phone.width / 2 - 10;
const basis = sky.viewBasis(DEFAULT_CAMERA.center[0], DEFAULT_CAMERA.center[1]);
const pxPerDeg = sky.bodyPxPerDeg(phone.width, phone.height, earthRadius);
const screenAt = (longitude, latitude) => {
  const at = sky.projectDirection(basis, sky.worldDir(longitude, latitude), pxPerDeg);
  return { x: origin.x + at.x, y: origin.y + at.y, angle: at.angle };
};
const bodyAt = (kind) => {
  const body = sky.SKY_BODIES.find((candidate) => candidate.kind === kind);
  return screenAt(body.longitude, body.latitude);
};

check("at least four worlds share the opening sky", () => {
  const visible = sky.SKY_BODIES.filter((body) => {
    const at = screenAt(body.longitude, body.latitude);
    return (
      at.angle < 112 &&
      at.x > 0 &&
      at.x < phone.width &&
      at.y > 0 &&
      at.y < phone.height
    );
  });
  assert.ok(visible.length >= 4, `only ${visible.map((b) => b.kind).join(", ")}`);
});

check("the worlds ride the open bands of sky, clear of the framed Earth", () => {
  // Anything the opening sky promises has to stand further from the centre
  // than the framed planet's limb.
  for (const kind of ["moon", "saturn", "mars", "jupiter"]) {
    const at = bodyAt(kind);
    const stand = Math.hypot(at.x - origin.x, at.y - origin.y);
    assert.ok(stand > earthRadius, `${kind} at ${Math.round(stand)}px is behind the Earth`);
  }
});

check("a traveller whose places frame a larger Earth still gets a sky", () => {
  // A collection spanning the Pacific frames the planet bigger than the
  // phone is wide, and centres it where the fixed sky is at its thinnest.
  // The body rate following the limb is what keeps a world or two in view.
  const bigEarth = 270;
  const rate = sky.bodyPxPerDeg(phone.width, phone.height, bigEarth);
  const pacific = sky.viewBasis(-175, 35);
  const inTheRing = sky.SKY_BODIES.filter((body) => {
    const at = sky.projectDirection(pacific, sky.worldDir(body.longitude, body.latitude), rate);
    const stand = Math.hypot(at.x, at.y);
    // A body whose centre is on screen shows at least half its face.
    return (
      stand > bigEarth &&
      at.angle < 100 &&
      Math.abs(at.x) < phone.width / 2 &&
      Math.abs(at.y) < phone.height / 2
    );
  });
  assert.ok(inTheRing.length >= 1, "the Pacific sky is empty");
});

check("the Moon opens upper-left, Saturn upper-right, Mars and Jupiter below", () => {
  const moon = bodyAt("moon");
  const saturn = bodyAt("saturn");
  assert.ok(moon.x < origin.x && moon.y < origin.y, `moon at ${moon.x},${moon.y}`);
  assert.ok(saturn.x > origin.x && saturn.y < origin.y, `saturn at ${saturn.x},${saturn.y}`);
  assert.ok(bodyAt("mars").y > origin.y);
  assert.ok(bodyAt("jupiter").y > origin.y);
});

check("the Sun is not given away — it has to be found", () => {
  const at = screenAt(sky.SUN.longitude, sky.SUN.latitude);
  assert.ok(at.angle > 120, `the sun opens ${at.angle.toFixed(0)}° from centre`);
});

console.log("the baked worlds");

check("the same seed paints the same planet, byte for byte", () => {
  const first = paint.bakeBodyTexture("venus");
  const second = paint.bakeBodyTexture("venus");
  assert.equal(first.pixels.length, second.pixels.length);
  for (let i = 0; i < first.pixels.length; i += 1) {
    if (first.pixels[i] !== second.pixels[i]) {
      assert.fail(`differs at byte ${i}`);
    }
  }
});

const moon = paint.bakeBodyTexture("moon");

check("the Moon is a moon: grey, varied, and carrying relief", () => {
  let min = 255;
  let max = 0;
  let hMin = 255;
  let hMax = 0;
  for (let i = 0; i < moon.pixels.length; i += 4) {
    const r = moon.pixels[i];
    if (r < min) min = r;
    if (r > max) max = r;
    const h = moon.pixels[i + 3];
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  assert.ok(max - min > 60, `albedo spread ${max - min}`);
  assert.ok(hMax - hMin > 40, `relief spread ${hMax - hMin}`);
});

check("the Moon wraps seamlessly at the antimeridian", () => {
  // The two edge columns are one texel of longitude apart; the middle column
  // is half a world away. A seam shows up as the edges differing like
  // strangers while true neighbours agree.
  const columnDiff = (a, b) => {
    let sum = 0;
    for (let v = 0; v < moon.height; v += 1) {
      sum += Math.abs(moon.pixels[(v * moon.width + a) * 4] - moon.pixels[(v * moon.width + b) * 4]);
    }
    return sum / moon.height;
  };
  const seam = columnDiff(0, moon.width - 1);
  const far = columnDiff(0, moon.width / 2);
  assert.ok(seam < far, `seam diff ${seam.toFixed(1)} vs far diff ${far.toFixed(1)}`);
  assert.ok(seam < 14, `seam diff ${seam.toFixed(1)}`);
});

check("Saturn's rings carry their anatomy", () => {
  const strip = paint.bakeRingStrip();
  const inner = 1.24;
  const outer = 2.3;
  const alphaNear = (rho) => {
    const u = Math.round(((rho - inner) / (outer - inner)) * (strip.width - 1));
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, u - 4); i <= Math.min(strip.width - 1, u + 4); i += 1) {
      sum += strip.pixels[i * 4 + 3];
      count += 1;
    }
    return sum / count;
  };
  const bBright = alphaNear(1.62);
  const cassini = alphaNear(1.985);
  const aRing = alphaNear(2.14);
  assert.ok(bBright > 110, `B ring ${bBright.toFixed(0)}`);
  assert.ok(cassini < 30, `Cassini division ${cassini.toFixed(0)}`);
  assert.ok(aRing > 60, `A ring ${aRing.toFixed(0)}`);
  assert.ok(cassini < bBright / 4 && cassini < aRing / 2, "the division does not divide");
});

process.exit(failures > 0 ? 1 : 0);
