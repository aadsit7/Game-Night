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

const { googleMapsUrl, googleMapsDirectionsUrl } = await import("../lib/maps/googleMapsLinks.ts");

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

process.exit(failures === 0 ? 0 : 1);
