/**
 * Exercises the back-catalogue sweep's judgement — which place it asks about
 * next, and how long an unanswerable question stays answered.
 *
 * The failures worth catching: a place asked about again on every visit
 * because its "no match" note was lost, a linked or deleted place searched
 * for anyway, and a note that never expires — a listing created next year
 * would then never be found.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { nextSweepCandidate, pruneTried } = await import("../lib/maps/autoLinkSweep.ts");

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

console.log("auto-link sweep");

const place = (id, extra = {}) => ({
  id,
  name: id,
  latitude: 0,
  longitude: 0,
  ...extra,
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_756_000_000_000;

test("the first unlinked, living, unasked place is next", () => {
  const places = [
    place("a", { googlePlaceId: "ChIJa" }),
    place("b", { deletedAt: "2026-01-01" }),
    place("c"),
    place("d"),
  ];
  assert.equal(nextSweepCandidate(places, {}, NOW)?.id, "c");
});

test("a place asked about recently is passed over — until a month passes", () => {
  const places = [place("c"), place("d")];
  const tried = { c: NOW - 5 * DAY };
  assert.equal(nextSweepCandidate(places, tried, NOW)?.id, "d");
  // The month elapses; the question is worth asking again.
  assert.equal(nextSweepCandidate(places, { c: NOW - 31 * DAY }, NOW)?.id, "c");
});

test("with everything linked or noted, there is no candidate at all", () => {
  const places = [place("a", { googlePlaceId: "ChIJa" }), place("c")];
  assert.equal(nextSweepCandidate(places, { c: NOW - DAY }, NOW), null);
});

test("pruning forgets exactly the notes old enough to retry", () => {
  const tried = { fresh: NOW - DAY, stale: NOW - 40 * DAY, edge: NOW - 29 * DAY };
  assert.deepEqual(Object.keys(pruneTried(tried, NOW)).sort(), ["edge", "fresh"]);
});

process.exit(failures === 0 ? 0 : 1);
