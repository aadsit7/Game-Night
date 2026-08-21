/**
 * Exercises how the end date follows the start date in the add/edit form.
 *
 * The rule has to hold two things at once: spare someone the second trip
 * through the calendar, and never quietly overwrite an end date they actually
 * chose. Both are invisible in a screenshot and easy to break, so they are
 * pinned here.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { emptyDraft, withEndDateShown, withTrip, withVisitStart } =
  await import("../lib/store/draft.ts");

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

const draft = (from = "", to = "") => ({ ...emptyDraft(), visitedFrom: from, visitedTo: to });

console.log("draft dates");

test("setting the start date fills an empty end date with the same day", () => {
  const next = withVisitStart(draft(), "2026-04-01");
  assert.equal(next.visitedFrom, "2026-04-01");
  assert.equal(next.visitedTo, "2026-04-01", "a one-day trip needs no second pick");
});

test("an end date still matching the start follows the start", () => {
  // Nobody chose this end date — it was seeded. Moving the start moves it too.
  const next = withVisitStart(draft("2026-04-01", "2026-04-01"), "2026-06-15");
  assert.equal(next.visitedTo, "2026-06-15");
});

test("an end date the person actually chose is left alone", () => {
  const next = withVisitStart(draft("2026-04-01", "2026-04-09"), "2026-04-03");
  assert.equal(next.visitedFrom, "2026-04-03");
  assert.equal(next.visitedTo, "2026-04-09", "their nine-day trip is not silently shortened");
});

test("a start moved past a chosen end pulls the end with it", () => {
  // Otherwise the record would claim a trip that ended before it began.
  const next = withVisitStart(draft("2026-04-01", "2026-04-09"), "2026-05-20");
  assert.equal(next.visitedTo, "2026-05-20");
});

test("a start moved exactly onto the chosen end is fine", () => {
  const next = withVisitStart(draft("2026-04-01", "2026-04-09"), "2026-04-09");
  assert.equal(next.visitedTo, "2026-04-09");
});

test("clearing the start date does not invent an end date", () => {
  const next = withVisitStart(draft("2026-04-01", "2026-04-01"), "");
  assert.equal(next.visitedFrom, "");
  assert.equal(next.visitedTo, "", "nothing to follow, so nothing is kept");
});

test("clearing the start leaves a chosen end date in place", () => {
  const next = withVisitStart(draft("2026-04-01", "2026-04-09"), "");
  assert.equal(next.visitedTo, "2026-04-09");
});

test("revealing the end date seeds it from the start", () => {
  const next = withEndDateShown(draft("2026-04-01"));
  assert.equal(next.visitedTo, "2026-04-01", "the field opens on the trip, not on today");
});

test("revealing the end date never overwrites one already there", () => {
  const next = withEndDateShown(draft("2026-04-01", "2026-04-09"));
  assert.equal(next.visitedTo, "2026-04-09");
});

test("revealing the end date with no start date leaves it empty", () => {
  const next = withEndDateShown(draft());
  assert.equal(next.visitedTo, "");
});

test("neither helper mutates the draft it was given", () => {
  const original = draft("2026-04-01", "2026-04-01");
  const snapshot = JSON.stringify(original);
  withVisitStart(original, "2026-09-09");
  withEndDateShown(original);
  assert.equal(JSON.stringify(original), snapshot);
});

/* ---------------------------------------------------------------- *
 * Joining a trip
 * ---------------------------------------------------------------- */

const JAPAN = { startDate: "2026-05-04" };

test("a place added to a trip is dated to the trip's first day", () => {
  // Without this it lands in the trip's "no date yet" footnote rather than on
  // Day 1 — which is the opposite of what adding it to a trip was meant to do.
  const next = withTrip(emptyDraft(), "TRIP-0001", JAPAN);
  assert.equal(next.tripId, "TRIP-0001");
  assert.equal(next.visitedFrom, "2026-05-04");
  assert.equal(next.visitedTo, "2026-05-04");
});

test("a date already typed is never overwritten by the trip's", () => {
  const typed = { ...emptyDraft(), visitedFrom: "2026-05-09", visitedTo: "2026-05-11" };
  const next = withTrip(typed, "TRIP-0001", JAPAN);
  assert.equal(next.visitedFrom, "2026-05-09");
  assert.equal(next.visitedTo, "2026-05-11");
});

test("a place on the wishlist joins a trip without gaining a date", () => {
  const wished = { ...emptyDraft(), wantToGo: true };
  const next = withTrip(wished, "TRIP-0001", JAPAN);
  assert.equal(next.tripId, "TRIP-0001");
  assert.equal(next.visitedFrom, "");
});

test("a trip with no dates of its own leaves the date alone", () => {
  const next = withTrip(emptyDraft(), "TRIP-0001", { startDate: undefined });
  assert.equal(next.tripId, "TRIP-0001");
  assert.equal(next.visitedFrom, "");
});

test("leaving a trip clears the trip and keeps the dates", () => {
  const inTrip = withTrip(emptyDraft(), "TRIP-0001", JAPAN);
  const out = withTrip(inTrip, "", undefined);
  assert.equal(out.tripId, "");
  assert.equal(out.visitedFrom, "2026-05-04");
});

test("withTrip does not mutate the draft it was given", () => {
  const original = emptyDraft();
  const snapshot = JSON.stringify(original);
  withTrip(original, "TRIP-0001", JAPAN);
  assert.equal(JSON.stringify(original), snapshot);
});

if (failures > 0) {
  console.error(`\n${failures} draft date test(s) failed.`);
  process.exit(1);
}
console.log("  all draft date tests passed\n");
