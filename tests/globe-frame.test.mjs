/**
 * Where the camera goes when the app opens.
 *
 * This is geometry on a sphere, and it is exactly the kind of thing that looks
 * plausible in code and is wrong on screen: the previous version asked
 * `fitBounds` for a rectangle on the flat Mercator plane, which for a
 * collection reaching from Chile to Svalbard to New Zealand answered with a
 * patch of the North Atlantic and the traveller's places around the far side.
 * Nothing caught it but a screenshot. These assertions are what a screenshot
 * was doing.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const geo = await import("../lib/utils/geo.ts");

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

const at = (latitude, longitude) => ({ latitude, longitude });

console.log("the centre of a handful of places");

check("a single place is its own centre", () => {
  const centre = geo.sphericalCentre([at(35.01, 135.77)]);
  assert.ok(Math.abs(centre.latitude - 35.01) < 1e-6);
  assert.ok(Math.abs(centre.longitude - 135.77) < 1e-6);
});

check("a pair either side of the antimeridian centres on the Pacific", () => {
  // Tokyo and San Francisco. Averaging the two longitudes as plain numbers
  // gives 12°E — the middle of Europe, on the opposite side of the planet from
  // both of them. This is the bug the vector mean exists to prevent.
  const centre = geo.sphericalCentre([at(35.68, 139.65), at(37.77, -122.42)]);
  assert.ok(
    Math.abs(centre.longitude) > 150,
    `centred on ${centre.longitude.toFixed(1)}°, which is not the Pacific`,
  );
});

check("the distance between two places is the great-circle one", () => {
  // Antipodes are half a turn apart, whatever route you imagine between them.
  assert.ok(Math.abs(geo.angularDistance(at(0, 0), at(0, 180)) - 180) < 1e-6);
  assert.ok(Math.abs(geo.angularDistance(at(90, 0), at(-90, 0)) - 180) < 1e-6);
  assert.ok(Math.abs(geo.angularDistance(at(0, 0), at(0, 90)) - 90) < 1e-6);
});

console.log("choosing how far back to stand");

/*
 * The zoom search, with a stand-in for the renderer.
 *
 * `fits` in the app projects every place through MapLibre and asks whether
 * they all landed on screen; here it is a threshold, which is the same shape:
 * true up to some zoom, false past it.
 */
const upTo = (limit) => (zoom) => zoom <= limit;

check("the answer is the furthest in you can go and still see everything", () => {
  const zoom = geo.largestZoomThatFits(upTo(3.7), 0.4, 11);
  assert.ok(Math.abs(zoom - 3.7) < 0.01, `landed on ${zoom.toFixed(3)}, not 3.7`);
  assert.ok(zoom <= 3.7, "overshot into a frame that cuts a place off");
});

check("a frame that fits at full zoom does not get searched for", () => {
  assert.equal(geo.largestZoomThatFits(upTo(20), 0.4, 11), 11);
});

check("when nothing fits, stand as far back as the camera goes", () => {
  // Places on both sides of the planet: no zoom shows them all, and the honest
  // answer is the whole globe rather than an arbitrary compromise.
  assert.equal(geo.largestZoomThatFits(() => false, 0.4, 11), 0.4);
});

check("the search never reports a zoom it did not verify", () => {
  for (const limit of [0.5, 1.234, 4, 8.9, 10.99]) {
    const zoom = geo.largestZoomThatFits(upTo(limit), 0.4, 11);
    assert.ok(upTo(limit)(zoom), `reported ${zoom.toFixed(3)}, which does not fit`);
  }
});

console.log(failures ? `\n${failures} failing.` : "\nAll framing rules hold.");
process.exit(failures ? 1 : 0);
