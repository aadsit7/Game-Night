/**
 * Exercises the startup cache — the copy of the sheet a returning browser
 * opens on before the network has said a word.
 *
 * The failure worth catching is quiet: a cache written by an older build that
 * silently discards everything (a blank first paint), or capabilities that
 * fail to round-trip — which would put every cold start back to the fallback
 * geocoder until the sheet answers.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

// cache.ts touches window.localStorage only inside its functions, so a stub
// installed before import is all the browser it needs.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

const { loadCache, saveCache, clearCache } = await import("../lib/sheets/cache.ts");

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

console.log("sheet cache");

const KEY = "travel-globe.sheet-cache.v1";

const snapshot = {
  places: [{ id: "PL-1", name: "Kyoto", latitude: 35, longitude: 135 }],
  trips: [],
  visits: [],
  travelPhotos: [],
  media: [],
  visitHeaders: ["Place ID"],
  lookups: { Status: ["Been"] },
  settings: {},
  capabilities: {
    placesSearch: true,
    placeDetails: true,
    photoUpload: false,
    visits: true,
    travelPhotos: false,
    googlePhotosPicker: false,
    googlePhotosConnected: false,
    deviceMediaUpload: false,
  },
};

test("what the script could do survives to the next visit", () => {
  saveCache(snapshot);
  const cached = loadCache();
  assert.equal(cached.capabilities.placesSearch, true);
  assert.equal(cached.capabilities.placeDetails, true);
  assert.equal(cached.places[0].name, "Kyoto");
  assert.equal(typeof cached.cachedAt, "string");
});

test("a cache from before capabilities still opens on the history", () => {
  const older = { ...snapshot, cachedAt: "2026-01-01" };
  delete older.capabilities;
  window.localStorage.setItem(KEY, JSON.stringify(older));
  const cached = loadCache();
  assert.equal(cached.capabilities, undefined);
  assert.equal(cached.places.length, 1);
});

test("garbage in the slot reads as no cache, never as a crash", () => {
  window.localStorage.setItem(KEY, "{not json");
  assert.equal(loadCache(), null);
  window.localStorage.setItem(KEY, JSON.stringify({ places: "nope" }));
  assert.equal(loadCache(), null);
});

test("clearing forgets everything", () => {
  saveCache(snapshot);
  clearCache();
  assert.equal(loadCache(), null);
});

process.exit(failures === 0 ? 0 : 1);
