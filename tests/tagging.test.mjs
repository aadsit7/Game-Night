/**
 * Tagging a handful of places into a trip in one go.
 *
 * The failures worth guarding against are quiet ones: rewriting a place that
 * already belongs to the trip (a wasted sheet write and a bumped timestamp),
 * and a toast that counts what was ticked rather than what actually moved.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  tagState, placesToRetag, canUntag, tagSummary, alreadyTaggedMessage,
} = await import("../lib/trips/tagging.ts");

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

console.log("trip tagging");

const place = (id, tripId) => ({ id, name: id, tripId });

test("a trip reads as ticked only when every selected place is in it", () => {
  const some = [place("a", "TRIP-0001"), place("b", undefined)];
  assert.equal(tagState(some, "TRIP-0001"), "some");
  assert.equal(tagState([place("a", "TRIP-0001")], "TRIP-0001"), "all");
  assert.equal(tagState(some, "TRIP-0002"), "none");
});

test("an empty selection is not silently 'all'", () => {
  assert.equal(tagState([], "TRIP-0001"), "none");
});

test("places already in the trip are not written again", () => {
  const selected = [place("a", "TRIP-0001"), place("b", undefined), place("c", "TRIP-0002")];
  assert.deepEqual(
    placesToRetag(selected, "TRIP-0001").map((p) => p.id),
    ["b", "c"],
  );
});

test("a blank trip and no trip are the same thing", () => {
  // The sheet stores "no trip" as an empty cell, which reaches the app as
  // either undefined or "". Treating those as different would rewrite every
  // untagged place every time.
  assert.deepEqual(placesToRetag([place("a", ""), place("b", undefined)], null), []);
});

test("removing from a trip only touches the places that were in one", () => {
  const selected = [place("a", "TRIP-0001"), place("b", undefined)];
  assert.deepEqual(placesToRetag(selected, null).map((p) => p.id), ["a"]);
});

test("the remove option is offered only when something would move", () => {
  assert.equal(canUntag([place("a", undefined), place("b", "")]), false);
  assert.equal(canUntag([place("a", undefined), place("b", "TRIP-0001")]), true);
});

test("the message counts what changed, not what was ticked", () => {
  assert.equal(tagSummary(3, "Japan 2026"), "3 places added to Japan 2026");
  assert.equal(tagSummary(1, "Japan 2026"), "1 place added to Japan 2026");
  assert.equal(tagSummary(2, null), "2 places removed from their trip");
});

test("nothing to do says why", () => {
  assert.equal(alreadyTaggedMessage(1, "Japan 2026"), "That place is already in Japan 2026");
  assert.equal(alreadyTaggedMessage(4, "Japan 2026"), "All 4 places are already in Japan 2026");
  assert.equal(alreadyTaggedMessage(2, null), "All 2 places are not in a trip");
});

process.exit(failures === 0 ? 0 : 1);
