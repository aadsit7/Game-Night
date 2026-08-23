/**
 * Trip membership at visit level, residences, and the timeline drawn from
 * visits: one place in several trips, the legacy place-level fallback, and
 * a year of living somewhere kept apart from the trip-day arithmetic.
 *
 * The silent failures this guards against: Salt Lake City's 2015 and 2024
 * trips collapsing into one; a place-level Trip ID being guessed onto the
 * wrong visit; a residence counted as a 285-day holiday; two visits to one
 * place colliding on one timeline key.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { effectiveVisitTripId, isResidenceVisit, splitResidences, visitStats } =
  await import("../lib/places/visits.ts");
const { groupTripDays, placesInTrip, tripMembership, tripSummary } =
  await import("../lib/trips/tripDays.ts");
const { buildScrubTrack, buildTimeline } = await import("../lib/timeline/buildTimeline.ts");

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

console.log("trip membership");

const NOW = "2026-01-01T00:00:00.000Z";

function place(extra = {}) {
  return {
    id: "PL-0001",
    name: "Salt Lake City",
    country: "United States",
    countryCode: "US",
    latitude: 40.7608,
    longitude: -111.891,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function visit(extra = {}) {
  return { id: "VIS-0001", placeId: "PL-0001", createdAt: NOW, updatedAt: NOW, ...extra };
}

function trip(extra = {}) {
  return { id: "TRIP-0001", name: "Ski trip", createdAt: NOW, updatedAt: NOW, ...extra };
}

/* ------------------------------------------------------------------ *
 * Visit-level membership
 * ------------------------------------------------------------------ */

test("visit-level Trip IDs decide membership", () => {
  const slc = place();
  const visits = [
    visit({ id: "V1", startDate: "2015-02-27", tripId: "TRIP-A" }),
    visit({ id: "V2", startDate: "2024-02-07", tripId: "TRIP-B" }),
  ];
  const inA = tripMembership(trip({ id: "TRIP-A" }), [slc], visits);
  const inB = tripMembership(trip({ id: "TRIP-B" }), [slc], visits);
  assert.deepEqual(inA.visits.map((v) => v.id), ["V1"]);
  assert.deepEqual(inB.visits.map((v) => v.id), ["V2"]);
  assert.deepEqual(inA.places.map((p) => p.id), ["PL-0001"]);
  assert.deepEqual(inB.places.map((p) => p.id), ["PL-0001"]);
});

test("the same place belongs to two trips through two visits", () => {
  const slc = place();
  const visits = [
    visit({ id: "V1", tripId: "TRIP-A", startDate: "2015-02-27" }),
    visit({ id: "V2", tripId: "TRIP-B", startDate: "2024-02-07" }),
  ];
  assert.equal(placesInTrip(trip({ id: "TRIP-A" }), [slc], visits).length, 1);
  assert.equal(placesInTrip(trip({ id: "TRIP-B" }), [slc], visits).length, 1);
});

test("a deleted visit carries no membership", () => {
  const membership = tripMembership(
    trip(),
    [place()],
    [visit({ tripId: "TRIP-0001", deletedAt: NOW })],
  );
  assert.equal(membership.visits.length, 0);
  assert.equal(membership.places.length, 0);
});

/* ------------------------------------------------------------------ *
 * The legacy place-level fallback
 * ------------------------------------------------------------------ */

test("a place-level Trip ID still works when no visit mentions any trip", () => {
  const legacy = place({ tripId: "TRIP-0001", visitedFrom: "2024-02-07" });
  const membership = tripMembership(trip(), [legacy], []);
  assert.deepEqual(membership.places.map((p) => p.id), ["PL-0001"]);
  assert.deepEqual(membership.legacyPlaces.map((p) => p.id), ["PL-0001"]);
});

test("a lone visit inherits the place's trip; several visits are never guessed", () => {
  const legacy = place({ tripId: "TRIP-0001" });
  const lone = visit({ id: "V1" });
  assert.equal(effectiveVisitTripId(lone, legacy, [lone]), "TRIP-0001");

  const many = [visit({ id: "V1" }), visit({ id: "V2" })];
  assert.equal(effectiveVisitTripId(many[0], legacy, many), undefined);
  assert.equal(effectiveVisitTripId(many[1], legacy, many), undefined);
  // The place still belongs to the trip — at place level, not per guessed visit.
  const membership = tripMembership(trip(), [legacy], many);
  assert.deepEqual(membership.legacyPlaces.map((p) => p.id), ["PL-0001"]);
  assert.equal(membership.visits.length, 0);
});

test("once any visit names a trip, visit rows own the whole story", () => {
  const legacy = place({ tripId: "TRIP-OLD" });
  const visits = [visit({ id: "V1", tripId: "TRIP-NEW" }), visit({ id: "V2" })];
  const oldTrip = tripMembership(trip({ id: "TRIP-OLD" }), [legacy], visits);
  assert.equal(oldTrip.places.length, 0, "the stale place-level pointer no longer binds");
  const newTrip = tripMembership(trip({ id: "TRIP-NEW" }), [legacy], visits);
  assert.deepEqual(newTrip.visits.map((v) => v.id), ["V1"]);
});

test("without visits every caller sees the old behaviour untouched", () => {
  const legacy = place({ tripId: "TRIP-0001" });
  assert.deepEqual(placesInTrip(trip(), [legacy]).map((p) => p.id), ["PL-0001"]);
});

/* ------------------------------------------------------------------ *
 * Days and summaries from visits
 * ------------------------------------------------------------------ */

test("one place sits under two different days through two visits", () => {
  const slc = place();
  const visits = [
    visit({ id: "V1", tripId: "TRIP-0001", startDate: "2024-02-07" }),
    visit({ id: "V2", tripId: "TRIP-0001", startDate: "2024-02-09" }),
  ];
  const grouping = groupTripDays(trip({ startDate: "2024-02-07", endDate: "2024-02-10" }), [slc], visits);
  assert.deepEqual(grouping.days.map((d) => d.date), ["2024-02-07", "2024-02-09"]);
  assert.ok(grouping.days.every((d) => d.places[0].id === "PL-0001"));
});

test("summaries count member places through visits", () => {
  const a = place({ id: "PL-A", name: "A" });
  const b = place({ id: "PL-B", name: "B", city: "Bcity" });
  const visits = [
    visit({ id: "V1", placeId: "PL-A", tripId: "TRIP-0001", startDate: "2024-02-07" }),
    visit({ id: "V2", placeId: "PL-B", tripId: "TRIP-0001", startDate: "2024-02-08" }),
    visit({ id: "V3", placeId: "PL-B", tripId: "TRIP-OTHER", startDate: "2019-06-18" }),
  ];
  const summary = tripSummary(trip({ startDate: "2024-02-07", endDate: "2024-02-10" }), [a, b], visits);
  assert.equal(summary.places, 2);
  assert.equal(summary.days, 4);
});

/* ------------------------------------------------------------------ *
 * Residences
 * ------------------------------------------------------------------ */

console.log("residences");

test("'Lived there' is a residence, in any of its casual spellings", () => {
  assert.ok(isResidenceVisit(visit({ status: "Lived there" })));
  assert.ok(isResidenceVisit(visit({ status: "lived here" })));
  assert.ok(!isResidenceVisit(visit({ status: "Been" })));
  assert.ok(!isResidenceVisit(visit({})));
});

test("residence records stay distinct from stays", () => {
  const rows = [
    visit({ id: "R1", status: "Lived there", startDate: "2014-08-01", endDate: "2015-05-12" }),
    visit({ id: "V1", status: "Been", startDate: "2019-06-18", endDate: "2019-06-24" }),
    visit({ id: "V2", status: "Been", startDate: "2024-02-07", endDate: "2024-02-10" }),
  ];
  const { residences, stays } = splitResidences(rows);
  assert.deepEqual(residences.map((r) => r.id), ["R1"]);
  assert.deepEqual(stays.map((s) => s.id), ["V1", "V2"]);
});

test("stats sum visit days, never the residence and never the calendar span", () => {
  const stats = visitStats([
    visit({ id: "R1", status: "Lived there", startDate: "2014-08-01", endDate: "2015-05-12" }),
    visit({ id: "V1", startDate: "2015-02-27", endDate: "2015-03-03" }), // 5 days
    visit({ id: "V2", startDate: "2019-06-18", endDate: "2019-06-24" }), // 7 days
    visit({ id: "V3", startDate: "2024-02-07", endDate: "2024-02-10" }), // 4 days
  ]);
  assert.equal(stats.count, 3, "the residence is not one more visit");
  assert.equal(stats.daysTotal, 16, "5 + 7 + 4, not nine years");
  assert.ok(stats.hasResidence);
  assert.equal(stats.residenceDays, 285);
  assert.equal(stats.firstYear, "2014", "living there first is still the first time there");
});

/* ------------------------------------------------------------------ *
 * The timeline, drawn from visits
 * ------------------------------------------------------------------ */

console.log("timeline from visits");

test("multiple visits to one place appear as independent events", () => {
  const slc = place();
  const timeline = buildTimeline(
    [slc],
    [
      visit({ id: "V1", startDate: "2015-02-27", endDate: "2015-03-03" }),
      visit({ id: "V2", startDate: "2024-02-07", endDate: "2024-02-10" }),
    ],
  );
  assert.equal(timeline.years.length, 2);
  const ids = timeline.years.flatMap((y) => y.entries.map((e) => e.id));
  assert.deepEqual(ids, ["V1", "V2"], "entry ids are visit ids, unique per stay");
  assert.equal(timeline.totals.days, 5 + 4);
});

test("a residence is marked and kept out of the travel-day totals", () => {
  const timeline = buildTimeline(
    [place()],
    [
      visit({ id: "R1", status: "Lived there", startDate: "2014-08-01", endDate: "2015-05-12" }),
      visit({ id: "V1", startDate: "2019-06-18", endDate: "2019-06-24" }),
    ],
  );
  const entries = timeline.years.flatMap((y) => y.entries);
  const residence = entries.find((e) => e.id === "R1");
  assert.ok(residence?.residence, "the residence entry says so");
  assert.equal(timeline.totals.days, 7, "285 residence days do not inflate 'days away'");
});

test("deleted visits fall back to the place's own dates, not broken entries", () => {
  const slc = place({ visitedFrom: "2019-06-18", visitedTo: "2019-06-24" });
  const timeline = buildTimeline([slc], [visit({ id: "V1", deletedAt: NOW })]);
  const entries = timeline.years.flatMap((y) => y.entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, slc.id, "place-derived entry keeps the place id");
});

test("the scrubber lands on entries, so twin visits stay reachable", () => {
  const timeline = buildTimeline(
    [place()],
    [
      visit({ id: "V1", startDate: "2024-02-07" }),
      visit({ id: "V2", startDate: "2024-06-01" }),
    ],
  );
  const track = buildScrubTrack(timeline.years);
  assert.deepEqual(track.stops.map((s) => s.entryId), ["V1", "V2"]);
  assert.ok(track.stops.every((s) => s.placeId === "PL-0001"));
});

if (failures > 0) {
  console.error(`\n${failures} trip membership test(s) failed.`);
  process.exit(1);
}
console.log("  all trip membership tests passed\n");
