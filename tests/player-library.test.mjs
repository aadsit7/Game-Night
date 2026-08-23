/**
 * The Player tab's library: which trips and places earn an entry, and in
 * what order.
 *
 * The silent failures this guards against: a place or trip with nothing to
 * play cluttering the list (or worse, opening an empty player); a deleted
 * photo resurrecting an entry; a tombstoned place or trip coming back as a
 * playable card; media reaching a trip's entry only when attached directly
 * rather than through a member place; and an order that shuffles between
 * devices because a tie had no rule.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  buildPlayerLibrary,
  formatLibrarySummary,
  latestMediaMoment,
} = await import("../lib/photos/playerLibrary.ts");

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

console.log("player library");

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const NOW = "2026-01-01T00:00:00.000Z";
let sequence = 0;

function media(extra = {}) {
  sequence += 1;
  return {
    id: `TPHOTO-${String(sequence).padStart(4, "0")}`,
    source: "google-photos",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function video(extra = {}) {
  return media({ mimeType: "video/mp4", videoDriveFileId: "drive-clip", ...extra });
}

function place(id, name, extra = {}) {
  return {
    id,
    name,
    country: "Japan",
    latitude: 35,
    longitude: 135,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function trip(id, name, extra = {}) {
  return { id, name, createdAt: NOW, updatedAt: NOW, ...extra };
}

/* ------------------------------------------------------------------ *
 * Membership: only things with something to play
 * ------------------------------------------------------------------ */

test("a place with media gets an entry; a place without stays out", () => {
  const photos = [media({ placeId: "P1" })];
  const library = buildPlayerLibrary(
    photos,
    [],
    [place("P1", "Kyoto"), place("P2", "Nara")],
    [],
  );
  assert.deepEqual(
    library.places.map((entry) => entry.place.id),
    ["P1"],
  );
});

test("a trip with media gets an entry; a trip without stays out", () => {
  const photos = [media({ tripId: "TRIP-1" })];
  const library = buildPlayerLibrary(
    photos,
    [trip("TRIP-1", "Japan"), trip("TRIP-2", "Nowhere Yet")],
    [],
    [],
  );
  assert.deepEqual(
    library.trips.map((entry) => entry.trip.id),
    ["TRIP-1"],
  );
});

test("a member place's photo reaches its trip's entry", () => {
  const photos = [media({ placeId: "P1" })];
  const library = buildPlayerLibrary(
    photos,
    [trip("TRIP-1", "Japan")],
    [place("P1", "Kyoto", { tripId: "TRIP-1" })],
    [],
  );
  assert.equal(library.trips.length, 1);
  assert.equal(library.trips[0].playlist.length, 1);
});

test("visit-level trip membership reaches the trip's entry too", () => {
  const photos = [media({ placeId: "P1" })];
  const visit = {
    id: "VIS-1",
    placeId: "P1",
    tripId: "TRIP-1",
    startDate: "2026-02-01",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const library = buildPlayerLibrary(
    photos,
    [trip("TRIP-1", "Japan")],
    [place("P1", "Kyoto")],
    [visit],
  );
  assert.equal(library.trips.length, 1);
  assert.equal(library.trips[0].playlist.length, 1);
});

test("deleted media cannot hold an entry open", () => {
  const photos = [media({ placeId: "P1", deletedAt: NOW })];
  const library = buildPlayerLibrary(photos, [], [place("P1", "Kyoto")], []);
  assert.equal(library.places.length, 0);
});

test("tombstoned places and trips stay out, media or not", () => {
  const photos = [media({ placeId: "P1" }), media({ tripId: "TRIP-1" })];
  const library = buildPlayerLibrary(
    photos,
    [trip("TRIP-1", "Japan", { deletedAt: NOW })],
    [place("P1", "Kyoto", { deletedAt: NOW })],
    [],
  );
  assert.equal(library.trips.length, 0);
  assert.equal(library.places.length, 0);
});

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

test("an entry counts its photos and videos apart", () => {
  const photos = [
    media({ placeId: "P1" }),
    media({ placeId: "P1" }),
    video({ placeId: "P1" }),
  ];
  const library = buildPlayerLibrary(photos, [], [place("P1", "Kyoto")], []);
  assert.deepEqual(library.places[0].counts, { photos: 2, videos: 1 });
});

/* ------------------------------------------------------------------ *
 * Order
 * ------------------------------------------------------------------ */

test("newest memories first, by capture time", () => {
  const photos = [
    media({ placeId: "P1", takenAt: "2026-03-05T10:00:00Z" }),
    media({ placeId: "P2", takenAt: "2026-04-01T10:00:00Z" }),
  ];
  const library = buildPlayerLibrary(
    photos,
    [],
    [place("P1", "Kyoto"), place("P2", "Oslo")],
    [],
  );
  assert.deepEqual(
    library.places.map((entry) => entry.place.id),
    ["P2", "P1"],
  );
});

test("a photo with no capture time falls back to its import time", () => {
  assert.equal(
    latestMediaMoment([
      media({ takenAt: "2026-03-05T10:00:00Z" }),
      media({ createdAt: "2026-05-01T00:00:00.000Z" }),
    ]),
    "2026-05-01T00:00:00.000Z",
  );
});

test("a deleted photo never sets the moment", () => {
  assert.equal(
    latestMediaMoment([
      media({ takenAt: "2026-03-05T10:00:00Z" }),
      media({ takenAt: "2026-09-01T10:00:00Z", deletedAt: NOW }),
    ]),
    "2026-03-05T10:00:00Z",
  );
});

test("moment ties fall back to the name, so every device agrees", () => {
  const photos = [
    media({ placeId: "P1", takenAt: "2026-03-05T10:00:00Z" }),
    media({ placeId: "P2", takenAt: "2026-03-05T10:00:00Z" }),
  ];
  const library = buildPlayerLibrary(
    photos,
    [],
    [place("P1", "Zurich"), place("P2", "Aarhus")],
    [],
  );
  assert.deepEqual(
    library.places.map((entry) => entry.place.name),
    ["Aarhus", "Zurich"],
  );
});

/* ------------------------------------------------------------------ *
 * The header line
 * ------------------------------------------------------------------ */

test("the summary names what there is, and only what there is", () => {
  const photos = [media({ placeId: "P1" }), media({ tripId: "TRIP-1" })];
  const both = buildPlayerLibrary(
    photos,
    [trip("TRIP-1", "Japan")],
    [place("P1", "Kyoto")],
    [],
  );
  assert.equal(formatLibrarySummary(both), "1 trip · 1 place");

  const placesOnly = buildPlayerLibrary(
    [media({ placeId: "P1" }), media({ placeId: "P2" })],
    [],
    [place("P1", "Kyoto"), place("P2", "Oslo")],
    [],
  );
  assert.equal(formatLibrarySummary(placesOnly), "2 places");

  assert.equal(formatLibrarySummary(buildPlayerLibrary([], [], [], [])), "");
});

if (failures > 0) {
  console.error(`\n${failures} player library test(s) failed.`);
  process.exit(1);
}
console.log("  all player library tests passed\n");
