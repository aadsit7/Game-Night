/**
 * Exercises the Google Maps links every saved place carries.
 *
 * The interesting failures are quiet ones: a link that drops the listing id
 * and opens a bare pin where the actual place was one parameter away, an
 * unencoded id that truncates the URL at a stray character, or coordinates
 * formatted differently here than in the sheet's own Map URL column.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { googleMapsUrl, googleMapsDirectionsUrl, googleMapsTripRouteUrl } = await import(
  "../lib/maps/googleMapsLinks.ts"
);

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

console.log("google maps links");

const EIFFEL = { latitude: 48.8584, longitude: 2.2945, googlePlaceId: "ChIJLU7jZClu5kcR4PcOOO6p3I0" };

test("a place with a listing id links to the listing, coordinates as fallback", () => {
  assert.equal(
    googleMapsUrl(EIFFEL),
    "https://www.google.com/maps/search/?api=1&query=48.858400%2C2.294500&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0",
  );
});

test("a place without one still links to the exact spot", () => {
  assert.equal(
    googleMapsUrl({ latitude: 48.8584, longitude: 2.2945 }),
    "https://www.google.com/maps/search/?api=1&query=48.858400%2C2.294500",
  );

  // Whitespace is not a listing.
  assert.equal(
    googleMapsUrl({ ...EIFFEL, googlePlaceId: "   " }).includes("query_place_id"),
    false,
  );
});

test("directions carry the same anchor as the view", () => {
  assert.equal(
    googleMapsDirectionsUrl(EIFFEL),
    "https://www.google.com/maps/dir/?api=1&destination=48.858400%2C2.294500&destination_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0",
  );
  assert.equal(
    googleMapsDirectionsUrl({ latitude: -33.856789, longitude: 151.215256 }),
    "https://www.google.com/maps/dir/?api=1&destination=-33.856789%2C151.215256",
  );
});

test("six decimals, exactly as the sheet's own Map URL writes them", () => {
  // The sheet derives its Map URL at six decimal places; the app's links
  // agree with it, so the same place never has two subtly different URLs.
  assert.equal(
    googleMapsUrl({ latitude: 35, longitude: 135 }),
    "https://www.google.com/maps/search/?api=1&query=35.000000%2C135.000000",
  );
});

test("an id never truncates or reshapes the URL", () => {
  // Real ids are URL-safe, but the URL must stay well-formed whatever is in
  // the cell — someone can type into the sheet by hand.
  const odd = googleMapsUrl({ ...EIFFEL, googlePlaceId: "ChIJ&x=1 #frag" });
  assert.equal(odd.includes("query_place_id=ChIJ%26x%3D1%20%23frag"), true);
});

console.log("trip route url");

const LISBON = { latitude: 38.7223, longitude: -9.1393, googlePlaceId: "ChIJlisbon" };
const PORTO = { latitude: 41.1579, longitude: -8.6291, googlePlaceId: "ChIJporto" };
const SINTRA = { latitude: 38.8029, longitude: -9.3817, googlePlaceId: "ChIJsintra" };

test("a route needs two stops; one or none is no route", () => {
  assert.equal(googleMapsTripRouteUrl([]), null);
  assert.equal(googleMapsTripRouteUrl([LISBON]), null);
});

test("two stops route end to end, ids anchoring both", () => {
  assert.equal(
    googleMapsTripRouteUrl([LISBON, PORTO]),
    "https://www.google.com/maps/dir/?api=1&origin=38.722300%2C-9.139300&destination=41.157900%2C-8.629100&origin_place_id=ChIJlisbon&destination_place_id=ChIJporto",
  );
});

test("stops between become waypoints, ids aligned with them", () => {
  assert.equal(
    googleMapsTripRouteUrl([LISBON, SINTRA, PORTO]),
    "https://www.google.com/maps/dir/?api=1&origin=38.722300%2C-9.139300&destination=41.157900%2C-8.629100&origin_place_id=ChIJlisbon&destination_place_id=ChIJporto&waypoints=38.802900%2C-9.381700&waypoint_place_ids=ChIJsintra",
  );
});

test("one unlinked waypoint drops every waypoint id, never misaligns them", () => {
  // waypoint_place_ids matches waypoints by position; with a gap, someone
  // else's listing would pin to the wrong stop. Coordinates alone are safe.
  const url = googleMapsTripRouteUrl([
    LISBON,
    SINTRA,
    { latitude: 40.2033, longitude: -8.4103 },
    PORTO,
  ]);
  assert.equal(url.includes("waypoints=38.802900%2C-9.381700%7C40.203300%2C-8.410300"), true);
  assert.equal(url.includes("waypoint_place_ids"), false);
  // The ends keep theirs — they ride separate parameters.
  assert.equal(url.includes("origin_place_id=ChIJlisbon"), true);
  assert.equal(url.includes("destination_place_id=ChIJporto"), true);
});

test("a long trip thins to nine waypoints, keeping the journey's shape", () => {
  // Eleven middle stops at recognisable latitudes; Google's URL takes nine.
  const middles = Array.from({ length: 11 }, (_, i) => ({ latitude: i, longitude: 0 }));
  const url = googleMapsTripRouteUrl([LISBON, ...middles, PORTO]);
  const waypoints = decodeURIComponent(url.match(/waypoints=([^&]+)/)[1]).split("|");
  assert.equal(waypoints.length, 9);
  // Both ends of the middle leg survive the thinning.
  assert.equal(waypoints[0], "0.000000,0.000000");
  assert.equal(waypoints[8], "10.000000,0.000000");
});

process.exit(failures === 0 ? 0 : 1);
