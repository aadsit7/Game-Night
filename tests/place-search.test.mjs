/**
 * Exercises the two geocoders behind the search that adds a place.
 *
 * The interesting failures here are the ones that make a search feel broken
 * without breaking: a landmark ranked below a house number, one place returned
 * four times with nothing to tell the rows apart, a Places result with no
 * coordinates quietly becoming a pin at 0°N 0°E.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const geocoding = await import("../lib/maps/geocoding.ts");
const { toLocationResult } = await import("../lib/maps/googlePlaces.ts");

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

console.log("place search");

/* ---------------------------------------------------------------- *
 * OpenStreetMap — the keyless default
 * ---------------------------------------------------------------- */

/** Photon's real shape, copied from live responses. */
const feature = (properties, coordinates = [2.2945, 48.8584]) => ({
  properties,
  geometry: { coordinates },
});

const parseOsm = (features) => geocoding.parseSearchResults({ features });

test("a landmark outranks a street address", () => {
  // The Eiffel Tower comes back from Photon as type "house" with an
  // osm_key of "man_made". Reading type first classified every landmark on
  // earth as an address and sorted it to the bottom — so the one row anyone
  // searching for a landmark wanted was the one pushed furthest down.
  const results = parseOsm([
    feature({ osm_id: 1, type: "house", housenumber: "12", street: "Rue Cler", city: "Paris", country: "France" }),
    feature({ osm_id: 2, name: "Eiffel Tower", type: "house", osm_key: "man_made", osm_value: "tower", city: "Paris", country: "France" }),
  ]);

  assert.equal(results[0].name, "Eiffel Tower");
  assert.equal(results[0].kind, "poi");
});

test("a named point of interest is a landmark whatever its geometry", () => {
  for (const key of ["tourism", "historic", "amenity", "leisure", "man_made", "natural"]) {
    const [result] = parseOsm([
      feature({ osm_id: 9, name: "Somewhere", type: "house", osm_key: key, country: "France" }),
    ]);
    assert.equal(result.kind, "poi", `osm_key "${key}" should read as a landmark`);
  }
});

test("an unnamed house is still an address", () => {
  const [result] = parseOsm([
    feature({ osm_id: 3, type: "house", housenumber: "12", street: "Rue Cler", city: "Paris", country: "France" }),
  ]);
  assert.equal(result.kind, "address");
});

test("one place returned several times becomes one row", () => {
  // OSM holds a building, its entrance and its name as separate objects, so
  // a single landmark can arrive four times over.
  const results = parseOsm([
    feature({ osm_id: 1, osm_type: "N", name: "Blue Bottle Coffee", osm_key: "amenity", street: "Mint Plaza", city: "San Francisco", country: "United States" }, [-122.409, 37.782]),
    feature({ osm_id: 2, osm_type: "W", name: "Blue Bottle Coffee", osm_key: "amenity", street: "Mint Plaza", city: "San Francisco", country: "United States" }, [-122.4090004, 37.7820004]),
  ]);
  assert.equal(results.length, 1);
});

test("two branches of the same shop are two rows", () => {
  const results = parseOsm([
    feature({ osm_id: 1, name: "Blue Bottle Coffee", osm_key: "amenity", street: "Mint Plaza", city: "San Francisco", country: "United States" }, [-122.409, 37.782]),
    feature({ osm_id: 2, name: "Blue Bottle Coffee", osm_key: "amenity", street: "Linden Street", city: "San Francisco", country: "United States" }, [-122.4241, 37.7761]),
  ]);
  assert.equal(results.length, 2);
  assert.notEqual(results[0].address, results[1].address);
});

test("an address line is built, and never just repeats the name", () => {
  const [result] = parseOsm([
    feature({ osm_id: 4, name: "Blue Bottle Coffee", osm_key: "amenity", housenumber: "66", street: "Mint Plaza", city: "San Francisco", postcode: "94103", state: "California", country: "United States" }, [-122.409, 37.782]),
  ]);
  assert.ok(result.address.includes("66 Mint Plaza"));
  assert.ok(!result.address.includes("Blue Bottle Coffee"));
});

test("a feature with no coordinates is skipped rather than pinned at nowhere", () => {
  assert.deepEqual(parseOsm([{ properties: { name: "Nowhere" }, geometry: {} }]), []);
});

/* ---------------------------------------------------------------- *
 * Google Places — used when the script has a key
 * ---------------------------------------------------------------- */

const GOOGLE_CAFE = {
  id: "ChIJ123",
  name: "Blue Bottle Coffee",
  address: "66 Mint Plaza, San Francisco, CA 94103, USA",
  latitude: 37.782,
  longitude: -122.409,
  city: "San Francisco",
  region: "California",
  country: "United States",
  countryCode: "US",
  types: ["cafe", "point_of_interest"],
};

test("a Places result becomes the same record the form expects", () => {
  const result = toLocationResult(GOOGLE_CAFE, 0);

  assert.equal(result.id, "ChIJ123");
  assert.equal(result.name, "Blue Bottle Coffee");
  assert.equal(result.context, "San Francisco, California, United States");
  assert.equal(result.address, GOOGLE_CAFE.address);
  assert.equal(result.countryCode, "US");
  assert.equal(result.kind, "poi");
  assert.equal(result.source, "google");
});

test("Places types map onto the icons the list draws", () => {
  const kindFor = (types) => toLocationResult({ ...GOOGLE_CAFE, types }, 0).kind;

  assert.equal(kindFor(["country", "political"]), "country");
  assert.equal(kindFor(["administrative_area_level_1"]), "region");
  assert.equal(kindFor(["locality", "political"]), "place");
  assert.equal(kindFor(["tourist_attraction", "point_of_interest"]), "poi");
  assert.equal(kindFor(["street_address"]), "address");
  // Anything unrecognised is still somewhere on the map.
  assert.equal(kindFor(["something_new"]), "place");
});

test("a result the app could not draw is dropped, not guessed at", () => {
  assert.equal(toLocationResult({ ...GOOGLE_CAFE, latitude: undefined }, 0), null);
  assert.equal(toLocationResult({ ...GOOGLE_CAFE, name: "  " }, 0), null);
  // 0,0 is a real coordinate in the Gulf of Guinea; NaN is not a coordinate.
  assert.equal(toLocationResult({ ...GOOGLE_CAFE, longitude: Number.NaN }, 0), null);
  assert.ok(toLocationResult({ ...GOOGLE_CAFE, latitude: 0, longitude: 0 }, 0));
});

test("an address that only repeats the subtitle is not shown twice", () => {
  const city = toLocationResult(
    {
      id: "ChIJcity",
      name: "Kyoto",
      address: "Kyoto, Japan",
      latitude: 35.0116,
      longitude: 135.7681,
      city: "Kyoto",
      country: "Japan",
      countryCode: "JP",
      types: ["locality"],
    },
    0,
  );

  assert.equal(city.context, "Japan");
  assert.equal(city.address, "Kyoto, Japan");

  // And when the two would read identically, only the subtitle survives.
  const same = toLocationResult(
    { id: "x", name: "Somewhere", address: "Japan", latitude: 1, longitude: 1, country: "Japan", types: [] },
    0,
  );
  assert.equal(same.address, undefined);
});

test("a Places result with no id still gets a stable one", () => {
  const result = toLocationResult({ ...GOOGLE_CAFE, id: undefined }, 3);
  assert.equal(result.id, "google-3");
});

test("the Google listing id rides along, and is never invented", () => {
  assert.equal(toLocationResult(GOOGLE_CAFE, 0).googlePlaceId, GOOGLE_CAFE.id);

  // The fallback row id is a list key, not a listing — a place saved from it
  // must not claim a Google identity it doesn't have.
  assert.equal(toLocationResult({ ...GOOGLE_CAFE, id: undefined }, 3).googlePlaceId, undefined);
  assert.equal(toLocationResult({ ...GOOGLE_CAFE, id: "   " }, 3).googlePlaceId, undefined);
});

/* ---------------------------------------------------------------- *
 * The globe search's merging, and the search memory's key
 * ---------------------------------------------------------------- */

const { newToJournal, searchCacheKey } = await import("../lib/maps/placeSearch.ts");

test("results already saved in the journal are not offered as additions", () => {
  const row = (id, googlePlaceId) => ({
    id,
    name: id,
    context: "",
    latitude: 1,
    longitude: 2,
    googlePlaceId,
  });
  const results = [row("a", "ChIJeiffel"), row("b", "ChIJlouvre"), row("c", undefined)];
  const places = [{ googlePlaceId: "ChIJeiffel" }, { googlePlaceId: undefined }];
  assert.deepEqual(
    newToJournal(results, places).map((result) => result.id),
    ["b", "c"],
    "the saved listing is dropped; the unlinked result is kept",
  );
});

test("the cache key hears the same question through globe nudges", () => {
  assert.equal(
    searchCacheKey("Kyoto", [135.4, 34.6], "en"),
    searchCacheKey("kyoto", [135.44, 34.61], "en"),
  );
  // A different vantage, tongue, or wording is a different question.
  assert.notEqual(
    searchCacheKey("kyoto", [135.4, 34.6], "en"),
    searchCacheKey("kyoto", [-9.1, 38.7], "en"),
  );
  assert.notEqual(searchCacheKey("kyoto", undefined, "en"), searchCacheKey("kyoto", undefined, "fr"));
});

process.exit(failures === 0 ? 0 : 1);
