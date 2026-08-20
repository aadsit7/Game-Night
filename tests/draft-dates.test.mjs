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

const { emptyDraft, withEndDateShown, withVisitStart } = await import("../lib/store/draft.ts");

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

if (failures > 0) {
  console.error(`\n${failures} draft date test(s) failed.`);
  process.exit(1);
}
console.log("  all draft date tests passed\n");
