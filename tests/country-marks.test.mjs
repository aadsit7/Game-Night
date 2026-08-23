/**
 * The countries view's marks.
 *
 * What makes this worth its own suite is that every rule in it is a rule about
 * *whose* places count and *where* the flag goes, and both are invisible when
 * wrong: a wishlist country quietly joining the ones you have been to reads as
 * a bug in the data rather than in the code, and a mark that averages the
 * whole collection instead of one country's share of it lands in the sea and
 * looks like a rendering glitch.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const marks = await import("../lib/maps/countryMarks.ts");
const paint = await import("../lib/maps/basemap.ts");
const {
  createPropertyExpression,
  latest: styleSpec,
} = await import("@maplibre/maplibre-gl-style-spec");

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

let next = 0;
const place = (extra = {}) => ({
  id: `p${(next += 1)}`,
  name: `Place ${next}`,
  country: "Japan",
  countryCode: "JP",
  latitude: 35,
  longitude: 135,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const byCode = (list) => Object.fromEntries(marks.countryMarks(list).map((m) => [m.code, m]));

console.log("which countries get a mark");

check("one mark per country, however many places are in it", () => {
  const result = marks.countryMarks([
    place(),
    place(),
    place({ country: "Portugal", countryCode: "PT", latitude: 38.7, longitude: -9.1 }),
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((mark) => [mark.code, mark.count]).sort(),
    [["JP", 2], ["PT", 1]],
  );
});

check("somewhere you want to go is not somewhere you have been", () => {
  // The fill under these marks makes the same exclusion. A flag floating over
  // an unpainted country would be the two of them disagreeing in public.
  const result = byCode([
    place(),
    place({ country: "Chile", countryCode: "CL", wantToGo: true, latitude: -33, longitude: -70 }),
  ]);
  assert.ok(result.JP, "the visited country lost its mark");
  assert.equal(result.CL, undefined, "a wishlist country was marked as visited");
});

check("a wish inside a country you have been to does not inflate its count", () => {
  const result = byCode([place(), place({ wantToGo: true })]);
  assert.equal(result.JP.count, 1);
});

check("a place the geocoder could not place is left out entirely", () => {
  const result = marks.countryMarks([
    place({ countryCode: undefined }),
    place({ countryCode: "" }),
    place({ countryCode: "XYZ" }),
    place({ latitude: Number.NaN }),
  ]);
  assert.deepEqual(result, []);
});

check("the country's name is the one the places themselves use", () => {
  const result = byCode([place({ country: "日本", countryCode: "JP" })]);
  assert.equal(result.JP.name, "日本");
});

check("the same collection always produces the same marks, in the same order", () => {
  const collection = [
    place({ country: "Portugal", countryCode: "PT", latitude: 38.7, longitude: -9.1 }),
    place(),
    place(),
    place({ country: "Spain", countryCode: "ES", latitude: 37.4, longitude: -6 }),
  ];
  const once = marks.countryMarks(collection).map((mark) => mark.code);
  const again = marks.countryMarks([...collection].reverse()).map((mark) => mark.code);
  assert.deepEqual(once, again);
  assert.deepEqual(once, ["JP", "ES", "PT"], "busiest first, then by code");
});

console.log("where the mark goes");

check("a country's mark sits among that country's own places", () => {
  /* The mean direction of *your* places in it, not of the whole collection and
     not of the country itself. Tokyo and Osaka average to somewhere between
     them; adding a place in Portugal must not drag Japan's flag west. */
  const alone = byCode([
    place({ latitude: 35.68, longitude: 139.65 }),
    place({ latitude: 34.69, longitude: 135.5 }),
  ]).JP;
  const alongside = byCode([
    place({ latitude: 35.68, longitude: 139.65 }),
    place({ latitude: 34.69, longitude: 135.5 }),
    place({ country: "Portugal", countryCode: "PT", latitude: 38.7, longitude: -9.1 }),
  ]).JP;

  assert.ok(Math.abs(alone.longitude - alongside.longitude) < 1e-9, "another country moved this one");
  assert.ok(alone.longitude > 135 && alone.longitude < 140, `landed at ${alone.longitude.toFixed(1)}°`);
  assert.ok(alone.latitude > 34 && alone.latitude < 36, `landed at ${alone.latitude.toFixed(1)}°`);
});

check("a country either side of the antimeridian is not marked in Africa", () => {
  // Averaging longitudes as plain numbers sends this to 0°, off Ghana.
  const fiji = byCode([
    place({ country: "Fiji", countryCode: "FJ", latitude: -17.8, longitude: 177.4 }),
    place({ country: "Fiji", countryCode: "FJ", latitude: -16.8, longitude: -179.9 }),
  ]).FJ;
  assert.ok(Math.abs(fiji.longitude) > 170, `landed at ${fiji.longitude.toFixed(1)}°`);
});

console.log("how the mark is drawn");

const SPEC = {
  "icon-size": styleSpec.layout_symbol["icon-size"],
  "icon-opacity": styleSpec.paint_symbol["icon-opacity"],
  "symbol-sort-key": styleSpec.layout_symbol["symbol-sort-key"],
};
const compile = (property, value) => {
  const result = createPropertyExpression(value, property, SPEC[property]);
  if (result.result === "error") {
    throw new Error(result.value.map((e) => e.message).join("; "));
  }
  return result.value;
};

check("the layout the renderer is handed is one it accepts", () => {
  compile("icon-size", paint.countryChipSize());
  compile("icon-opacity", paint.COUNTRY_CHIP_OPACITY);
  compile("symbol-sort-key", paint.COUNTRY_CHIP_SORT);
});

check("a country's mark is larger than a single place's", () => {
  // At globe zoom this is the entire content of the view; there is nothing else
  // on screen for it to defer to.
  const country = compile("icon-size", paint.countryChipSize());
  const one = compile("icon-size", paint.MARKER_ICON_SIZE_DEFAULT);
  for (const zoom of [0, 1, 3]) {
    const big = country.evaluate({ zoom }, {});
    const small = one.evaluate({ zoom }, {});
    assert.ok(big > small, `at zoom ${zoom} a country (${big}) is not bigger than a place (${small})`);
  }
});

check("the mark is gone by the time you are inside the country", () => {
  const opacity = compile("icon-opacity", paint.COUNTRY_CHIP_OPACITY);
  assert.equal(opacity.evaluate({ zoom: 0 }, {}), 1, "invisible at globe zoom");
  assert.equal(opacity.evaluate({ zoom: 3 }, {}), 1, "faded too early");
  assert.equal(opacity.evaluate({ zoom: 6 }, {}), 0, "still pinned to the middle of a country");
});

check("the busier country is the one drawn on top", () => {
  // Portugal and Spain are one chip apart at globe zoom. Icons here are allowed
  // to overlap, and the spec lets a higher sort key overlap a lower one.
  const sort = compile("symbol-sort-key", paint.COUNTRY_CHIP_SORT);
  assert.ok(
    sort.evaluate({ zoom: 1 }, { properties: { count: 9 } }) >
      sort.evaluate({ zoom: 1 }, { properties: { count: 2 } }),
    "a country with more places does not sort above one with fewer",
  );
});

console.log(failures ? `\n${failures} failing.` : "\nAll country-mark rules hold.");
process.exit(failures ? 1 : 0);
