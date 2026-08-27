/**
 * The Moon, as a place you can have been to.
 *
 * Two kinds of failure matter here and neither shows up in a screenshot. The
 * first is a lunar record leaking into the Earth's own machinery — a pin at
 * 0.67°N 23.47°E painted in the Indian Ocean, a country called "Moon" in the
 * flag rail, a Google search spent asking about Tranquility Base. The second
 * is the geometry: a mark placed with one formula and painted with another
 * lands on the wrong crater, and looks entirely convincing while doing it.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  MOON_SITES,
  MOON_WORLD,
  earthPlaces,
  isOffWorldPlace,
  moonSiteAt,
  searchMoonLocations,
  searchMoonSites,
  toMoonLocationResult,
} = await import("../lib/space/moonPlaces.ts");
const { newToJournal, searchAttribution } = await import("../lib/maps/placeSearch.ts");
const sky = await import("../lib/space/celestial.ts");

let failures = 0;
function test(name, body) {
  try {
    body();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log("the Moon as a place");

/* ---------------------------------------------------------------- *
 * Telling Earth from everywhere else
 * ---------------------------------------------------------------- */

const earth = { id: "e", name: "Lisbon", country: "Portugal", countryCode: "PT", latitude: 38.7, longitude: -9.1 };
const lunar = { id: "m", name: "Tranquility Base", country: "Moon", latitude: 0.6741, longitude: 23.473 };

test("a record is off Earth when its country says so, whatever the case", () => {
  assert.equal(isOffWorldPlace(lunar), true);
  assert.equal(isOffWorldPlace({ country: "  moon " }), true);
  assert.equal(isOffWorldPlace(earth), false);
  assert.equal(isOffWorldPlace({ country: "" }), false);
  // Never throws on the nothing the callers hand it while a sheet is empty.
  assert.equal(isOffWorldPlace(null), false);
  assert.equal(isOffWorldPlace(undefined), false);
});

test("the globe is handed the Earth's half of the collection and no more", () => {
  assert.deepEqual(
    earthPlaces([earth, lunar]).map((place) => place.id),
    ["e"],
    "a lunar pin on the Earth's map would land in the Indian Ocean",
  );
});

/* ---------------------------------------------------------------- *
 * Finding one
 * ---------------------------------------------------------------- */

const names = (query) => searchMoonSites(query).map((site) => site.name);

test("typing the world's name offers the world, first", () => {
  assert.equal(names("moon")[0], "The Moon");
  assert.equal(names("Moon")[0], "The Moon");
  assert.equal(names("lunar")[0], "The Moon");
  // And then its landmarks, so one search is a tour rather than a dead end.
  assert.ok(names("moon").length > 1);
});

test("a feature is found by its name, its Latin name, or the mission", () => {
  assert.ok(names("tranquility").includes("Sea of Tranquility"));
  assert.ok(names("mare tranquillitatis").includes("Sea of Tranquility"));
  assert.ok(names("apollo 11").includes("Tranquility Base"));
  assert.ok(names("apollo11").includes("Tranquility Base"));
  assert.ok(names("tycho").includes("Tycho Crater"));
  assert.ok(names("hadley").includes("Hadley–Apennine"));
});

test("an exact name outranks a mention of it", () => {
  // "Tranquility Base" mentions Apollo 11 in its blurb; the sea is named for
  // the words typed, so the sea leads.
  assert.equal(names("sea of tranquility")[0], "Sea of Tranquility");
});

test("an Earth search is never answered with the Moon", () => {
  assert.deepEqual(names("kyoto"), []);
  assert.deepEqual(names("lisbon"), []);
  // One letter is not a search.
  assert.deepEqual(names("m"), []);
});

test("a lunar answer arrives in the shape the add-a-place flow already takes", () => {
  const base = toMoonLocationResult(MOON_SITES.find((site) => site.id === "apollo-11"));
  assert.equal(base.name, "Tranquility Base");
  assert.equal(base.country, MOON_WORLD);
  assert.equal(base.source, "moon");
  // No ISO code, ever: a flag would put it on the Earth's painted countries.
  assert.equal(base.countryCode, undefined);
  assert.equal(base.googlePlaceId, undefined);
  assert.ok(Math.abs(base.latitude - 0.6741) < 1e-9);
  assert.ok(Math.abs(base.longitude - 23.473) < 1e-9);
});

test("every site is a real coordinate with something to say about itself", () => {
  for (const site of MOON_SITES) {
    assert.ok(site.latitude >= -90 && site.latitude <= 90, `${site.name} latitude`);
    assert.ok(site.longitude >= -180 && site.longitude <= 180, `${site.name} longitude`);
    assert.ok(site.blurb.length > 0, `${site.name} blurb`);
    assert.ok(site.region.length > 0, `${site.name} region`);
  }
  const ids = MOON_SITES.map((site) => site.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate site ids");
});

test("a saved record finds the site it was saved from", () => {
  assert.equal(moonSiteAt(0.6741, 23.473)?.id, "apollo-11");
  // A hand-nudged pin a degree away is thirty kilometres away — not it.
  assert.equal(moonSiteAt(1.9, 23.473), null);
});

/* ---------------------------------------------------------------- *
 * Not offering what is already saved
 * ---------------------------------------------------------------- */

test("a lunar site already in the journal is not offered again", () => {
  const results = searchMoonLocations("tranquility");
  const saved = [{ name: "Sea of Tranquility", country: "Moon", googlePlaceId: undefined }];
  const offered = newToJournal(results, saved).map((result) => result.name);
  assert.ok(!offered.includes("Sea of Tranquility"));
  assert.ok(offered.includes("Tranquility Base"), "the base is a different place");
  // Nothing saved: the whole list is still on offer.
  assert.equal(newToJournal(results, []).length, results.length);
});

test("whoever answered is credited, and the app credits itself honestly", () => {
  const lunarOnly = searchMoonLocations("moon");
  assert.match(searchAttribution(lunarOnly), /gazetteer/);

  const google = [{ id: "g", name: "Paris", context: "", latitude: 0, longitude: 0, source: "google" }];
  assert.equal(searchAttribution(google), "Results from Google Maps");
  assert.equal(searchAttribution([...lunarOnly, ...google]), "Results from Google Maps · lunar sites from this app");
  assert.equal(searchAttribution([]), null);
});

/* ---------------------------------------------------------------- *
 * The geometry of standing off a world
 * ---------------------------------------------------------------- */

console.log("standing off a world");

const moon = sky.bodyOfKind("moon");

test("there is a Moon in the sky to stand off", () => {
  assert.ok(moon, "the sky carries no moon");
  assert.equal(sky.bodyOfKind("saturn").kind, "saturn");
});

test("a surface point reads back as the coordinates the shader would sample", () => {
  // The shader turns a normal into lon = atan2(n·meridian, n·binormal) and
  // lat = asin(n·axis). Anything else and a mark lands on the wrong crater.
  const frame = sky.bodyFrame(moon);
  const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  for (const [longitude, latitude] of [[0, 0], [23.473, 0.674], [-57.4, 18.4], [129.1, -20.4], [0, -89.9]]) {
    const dir = sky.bodySurfaceDir(frame, longitude, latitude);
    const lon = (Math.atan2(dotv(dir, frame.meridian), dotv(dir, frame.binormal)) * 180) / Math.PI;
    const lat = (Math.asin(Math.max(-1, Math.min(1, dotv(dir, frame.axis)))) * 180) / Math.PI;
    assert.ok(Math.abs(lat - latitude) < 1e-6, `latitude ${lat} vs ${latitude}`);
    // Longitude is undefined at the poles, where every meridian meets.
    if (Math.abs(latitude) < 89) {
      assert.ok(Math.abs(lon - longitude) < 1e-6, `longitude ${lon} vs ${longitude}`);
    }
    assert.ok(Math.abs(Math.hypot(...dir) - 1) < 1e-9, "not a unit direction");
  }
});

test("the named spot is brought round to face the camera, north up", () => {
  const site = { longitude: 23.473, latitude: 0.674 };
  const rotation = sky.siteFacingRotation(moon, site, 8, 24);
  const frame = sky.rotateBodyFrame(sky.bodyFrame(moon), rotation);
  const basis = sky.viewBasis(8, 24);

  const facing = sky.toCamera(basis, sky.bodySurfaceDir(frame, site.longitude, site.latitude));
  assert.ok(facing[2] > 0.999999, `site depth ${facing[2]} — it should be dead centre`);
  assert.ok(Math.abs(facing[0]) < 1e-5 && Math.abs(facing[1]) < 1e-5, "site off centre");

  // North on the body points up the screen, not sideways or downwards.
  const pole = sky.toCamera(basis, frame.axis);
  assert.ok(pole[1] > 0.9, `the pole should be up the screen, not at ${pole[1]}`);

  // The rotation is a rotation: the frame stays an orthonormal trihedron.
  const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dotv(frame.meridian, frame.axis)) < 1e-9);
  assert.ok(Math.abs(dotv(frame.axis, frame.binormal)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...frame.meridian) - 1) < 1e-9);
});

test("a spot on the far side is brought round too — that is the whole point", () => {
  const site = { longitude: 177.6, latitude: -45.4 };
  const rotation = sky.siteFacingRotation(moon, site, -120, -30);
  const frame = sky.rotateBodyFrame(sky.bodyFrame(moon), rotation);
  const facing = sky.toCamera(sky.viewBasis(-120, -30), sky.bodySurfaceDir(frame, site.longitude, site.latitude));
  assert.ok(facing[2] > 0.999999, `far-side depth ${facing[2]}`);
});

test("a pole faces the camera as squarely as anywhere else", () => {
  // The alignment's "up" reference is the body's own axis, which is parallel
  // to the site direction at a pole; a naive triad divides by zero there.
  const site = { longitude: 0, latitude: -89.9 };
  const rotation = sky.siteFacingRotation(moon, site, 8, 24);
  const frame = sky.rotateBodyFrame(sky.bodyFrame(moon), rotation);
  const facing = sky.toCamera(sky.viewBasis(8, 24), sky.bodySurfaceDir(frame, site.longitude, site.latitude));
  assert.ok(Number.isFinite(facing[2]), "the pole produced a non-number");
  assert.ok(facing[2] > 0.999, `pole depth ${facing[2]}`);
});

test("the camera turns toward the daylight, and only as far as it must", () => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lit = (view) => dot(sky.worldDir(view.longitude, view.latitude), sky.SUN_DIR);

  // Already in daylight: left exactly where it was, so leaving Earth still
  // starts from wherever the traveller was looking.
  const sunward = { longitude: sky.SUN.longitude, latitude: sky.SUN.latitude };
  assert.deepEqual(sky.sunlitView(sunward.longitude, sunward.latitude), sunward);

  // The night side: turned until the near face is lit, and no further.
  for (const [lng, lat] of [[8, 24], [140, 35], [0, -80], [30, 60]]) {
    const turned = sky.sunlitView(lng, lat);
    assert.ok(lit(turned) > 0.49, `${lng},${lat} arrived at ${lit(turned).toFixed(3)}`);
    assert.ok(lit(turned) < 0.55, `${lng},${lat} overshot to ${lit(turned).toFixed(3)}`);
  }

  // Facing dead away from the Sun has no shortest way round; any turn will do,
  // and it must still be a number.
  const antisolar = sky.sunlitView(sky.SUN.longitude + 180, -sky.SUN.latitude);
  assert.ok(Number.isFinite(antisolar.longitude) && Number.isFinite(antisolar.latitude));
  assert.ok(lit(antisolar) > 0.49);
});

test("the approach starts in the sky and ends filling the view", () => {
  const inSky = { x: 40, y: 90, radius: 25 };
  const focus = { kind: "moon", amount: 0, originX: 200, originY: 300, radius: 140 };

  assert.deepEqual(sky.focusedPlacement(inSky, focus), inSky, "nothing has moved yet");
  assert.deepEqual(sky.focusedPlacement(inSky, null), inSky, "no focus, no journey");

  const arrived = sky.focusedPlacement(inSky, { ...focus, amount: 1 });
  assert.deepEqual(arrived, { x: 200, y: 300, radius: 140 });

  // Halfway is halfway, and the ease never overshoots either end.
  const half = sky.focusedPlacement(inSky, { ...focus, amount: 0.5 });
  assert.ok(Math.abs(half.x - 120) < 1e-9, `half x ${half.x}`);
  assert.equal(sky.focusEase(-1), 0);
  assert.equal(sky.focusEase(2), 1);
});

test("the Earth is only a disc while it is one on screen", () => {
  // A radius the projection could not measure, or one so large the map has
  // become a wall rather than a planet, is no disc to hug with an atmosphere.
  assert.equal(sky.visibleEarthRadius(null, 390, 780), null);
  assert.equal(sky.visibleEarthRadius(4, 390, 780), null);
  assert.equal(sky.visibleEarthRadius(4000, 390, 780), null);
  assert.equal(sky.visibleEarthRadius(180, 390, 780), 180);
});

process.exit(failures === 0 ? 0 : 1);
