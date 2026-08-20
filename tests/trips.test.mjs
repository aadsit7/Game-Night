/**
 * Exercises trips: the day arithmetic behind Trip Detail, and the translation
 * between a trip and a row of the Trips tab.
 *
 * The interesting failures here are all invisible in a screenshot — a trip
 * that crosses a month or a new year numbering its days wrong, a blank trip
 * cell on an old row being read as a trip called "", a "remove from trip" that
 * sends nothing and so changes nothing.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  groupTripDays,
  isVisitOutsideTrip,
  placesInTrip,
  sortTrips,
  tripDayNumber,
  tripSummary,
} = await import("../lib/trips/tripDays.ts");

const {
  COLUMNS,
  TRIP_COLUMNS,
  fieldsFromChanges,
  fieldsFromTripChanges,
  indexHeaders,
  placeFromRow,
  tripsFromTable,
} = await import("../lib/sheets/mapping.ts");

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

const trip = (extra = {}) => ({
  id: "TRIP-0001",
  name: "Japan 2026",
  startDate: "2026-05-04",
  endDate: "2026-05-16",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const place = (name, from, extra = {}) => ({
  id: name,
  name,
  country: extra.country ?? "Japan",
  countryCode: extra.countryCode ?? "JP",
  latitude: 35,
  longitude: 135,
  visitedFrom: from,
  visitedTo: extra.visitedTo,
  tripId: "tripId" in extra ? extra.tripId : "TRIP-0001",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

console.log("trips");

/* ---------------------------------------------------------------- *
 * Day numbering
 * ---------------------------------------------------------------- */

test("counts the first day of a trip as day 1", () => {
  assert.equal(tripDayNumber("2026-05-04", "2026-05-04"), 1);
  assert.equal(tripDayNumber("2026-05-04", "2026-05-05"), 2);
  assert.equal(tripDayNumber("2026-05-04", "2026-05-16"), 13);
});

test("numbers days across a month boundary", () => {
  assert.equal(tripDayNumber("2026-01-30", "2026-02-01"), 3);
  // February to March, in a leap year and out of one.
  assert.equal(tripDayNumber("2024-02-28", "2024-03-01"), 3);
  assert.equal(tripDayNumber("2025-02-28", "2025-03-01"), 2);
});

test("numbers days across a new year", () => {
  assert.equal(tripDayNumber("2025-12-28", "2026-01-03"), 7);
  assert.equal(tripDayNumber("2025-12-31", "2026-01-01"), 2);
});

test("has no day number without a start date", () => {
  assert.equal(tripDayNumber(undefined, "2026-05-04"), null);
  assert.equal(tripDayNumber("2026-05-04", "not a date"), null);
});

/* ---------------------------------------------------------------- *
 * Grouping
 * ---------------------------------------------------------------- */

test("groups a trip's places into chronological days", () => {
  const grouping = groupTripDays(trip(), [
    place("Kyoto", "2026-05-06"),
    place("Tokyo", "2026-05-04"),
    place("TeamLab", "2026-05-05"),
    place("Shibuya Crossing", "2026-05-04"),
    place("Fushimi Inari", "2026-05-06"),
  ]);

  assert.deepEqual(
    grouping.days.map((day) => [day.dayNumber, day.places.map((p) => p.name)]),
    [
      [1, ["Shibuya Crossing", "Tokyo"]],
      [2, ["TeamLab"]],
      [3, ["Fushimi Inari", "Kyoto"]],
    ],
  );
  assert.equal(grouping.days[0].heading, "Monday, May 4");
});

test("leaves places belonging to other trips out", () => {
  const places = [
    place("Tokyo", "2026-05-04"),
    place("Seattle", "2026-05-05", { tripId: "TRIP-0002" }),
    place("Reykjavik", "2026-05-06", { tripId: undefined }),
  ];
  assert.deepEqual(placesInTrip(trip(), places).map((p) => p.name), ["Tokyo"]);
  assert.deepEqual(
    groupTripDays(trip(), places).days.flatMap((day) => day.places.map((p) => p.name)),
    ["Tokyo"],
  );
});

test("surfaces a visit dated outside the trip rather than hiding it", () => {
  const grouping = groupTripDays(trip(), [
    place("Tokyo", "2026-05-04"),
    place("Osaka", "2026-06-20"),
  ]);

  assert.deepEqual(grouping.days.map((d) => d.places[0].name), ["Tokyo"]);
  assert.deepEqual(grouping.outside.map((d) => d.places[0].name), ["Osaka"]);
});

test("keeps a dateless place in the trip, with no day to sit under", () => {
  const grouping = groupTripDays(trip(), [
    place("Tokyo", "2026-05-04"),
    place("Somewhere", undefined),
  ]);

  assert.deepEqual(grouping.undated.map((p) => p.name), ["Somewhere"]);
  assert.equal(grouping.days.length, 1);
});

test("a trip with no dates of its own claims nothing is outside it", () => {
  const undated = trip({ startDate: undefined, endDate: undefined });
  assert.equal(isVisitOutsideTrip(undated, "1999-01-01"), false);
  assert.equal(groupTripDays(undated, [place("Tokyo", "1999-01-01")]).outside.length, 0);
});

/* ---------------------------------------------------------------- *
 * Summaries — all derived, never stored
 * ---------------------------------------------------------------- */

test("counts trip length inclusively from its own dates", () => {
  const summary = tripSummary(trip(), [place("Tokyo", "2026-05-04")]);
  assert.equal(summary.days, 13);
  assert.equal(summary.places, 1);
});

test("counts places, countries and cities from the visits themselves", () => {
  const summary = tripSummary(trip(), [
    place("Tokyo", "2026-05-04", { city: "Tokyo" }),
    place("Kyoto", "2026-05-06", { city: "Kyoto" }),
    place("Busan", "2026-05-10", { city: "Busan", country: "South Korea", countryCode: "KR" }),
    place("Seattle", "2026-05-12", { tripId: "TRIP-0002", city: "Seattle" }),
  ]);

  assert.equal(summary.places, 3);
  assert.deepEqual(summary.countries, ["Japan", "South Korea"]);
  assert.deepEqual(summary.cities, ["Tokyo", "Kyoto", "Busan"]);
});

test("falls back to the span its visits cover when the trip has no dates", () => {
  const undated = trip({ startDate: undefined, endDate: undefined });
  const summary = tripSummary(undated, [
    place("Tokyo", "2026-05-04"),
    place("Kyoto", "2026-05-06", { visitedTo: "2026-05-08" }),
  ]);
  assert.equal(summary.days, 5);
});

test("orders trips most recent first, undated ones last", () => {
  const ordered = sortTrips([
    trip({ id: "a", name: "Older", startDate: "2024-01-01" }),
    trip({ id: "b", name: "Undated", startDate: undefined, endDate: undefined }),
    trip({ id: "c", name: "Newer", startDate: "2026-05-04" }),
  ]);
  assert.deepEqual(ordered.map((t) => t.name), ["Newer", "Older", "Undated"]);
});

/* ---------------------------------------------------------------- *
 * The Trips tab
 * ---------------------------------------------------------------- */

const TRIP_TABLE = {
  headers: [
    TRIP_COLUMNS.id,
    TRIP_COLUMNS.name,
    TRIP_COLUMNS.startDate,
    TRIP_COLUMNS.endDate,
    TRIP_COLUMNS.description,
    TRIP_COLUMNS.coverPlaceId,
    TRIP_COLUMNS.createdAt,
    TRIP_COLUMNS.updatedAt,
    TRIP_COLUMNS.deleted,
  ],
  rows: [
    ["TRIP-0001", "Japan 2026", "2026-05-04", "2026-05-16", "Spring", "", "2026-01-01", "2026-01-02", "No"],
    ["TRIP-0002", "Iceland", "", "", "", "", "", "", "Yes"],
    ["", "Nameless row someone started", "", "", "", "", "", "", ""],
    ["TRIP-0001", "A duplicate id", "", "", "", "", "", "", "No"],
  ],
};

test("reads trips from the Trips tab, skipping half-filled rows", () => {
  const trips = tripsFromTable(TRIP_TABLE, "2026-08-20T00:00:00.000Z");
  assert.deepEqual(trips.map((t) => t.id), ["TRIP-0001", "TRIP-0002"]);
  assert.equal(trips[0].name, "Japan 2026");
  assert.equal(trips[0].startDate, "2026-05-04");
  assert.equal(trips[0].endDate, "2026-05-16");
  assert.equal(trips[0].description, "Spring");
  // A trip with no dates is valid; the app just has less to show for it.
  assert.equal(trips[1].startDate, undefined);
});

test("marks a Deleted? trip as a tombstone rather than dropping it", () => {
  const trips = tripsFromTable(TRIP_TABLE, "2026-08-20T00:00:00.000Z");
  assert.equal(trips[0].deletedAt, undefined);
  assert.ok(trips[1].deletedAt);
});

test("a missing Trips tab is no trips, not a failure", () => {
  assert.deepEqual(tripsFromTable(undefined, "2026-08-20T00:00:00.000Z"), []);
  assert.deepEqual(tripsFromTable({ headers: [], rows: [] }, "2026-08-20T00:00:00.000Z"), []);
});

test("writes only the trip fields that changed", () => {
  assert.deepEqual(fieldsFromTripChanges({ name: "  Japan 2026  " }), {
    [TRIP_COLUMNS.name]: "Japan 2026",
  });

  const full = fieldsFromTripChanges({
    name: "Japan 2026",
    startDate: "2026-05-04",
    endDate: "2026-05-16",
    description: "Spring",
  });
  assert.equal(full[TRIP_COLUMNS.startDate], "2026-05-04");
  assert.equal(full[TRIP_COLUMNS.endDate], "2026-05-16");
  // Never sent: the script owns these, on every tab.
  assert.equal(TRIP_COLUMNS.createdAt in full, false);
  assert.equal(TRIP_COLUMNS.updatedAt in full, false);
});

/* ---------------------------------------------------------------- *
 * The trip cell on a Places row
 * ---------------------------------------------------------------- */

const PLACE_HEADERS = [
  COLUMNS.id,
  COLUMNS.name,
  COLUMNS.latitude,
  COLUMNS.longitude,
  COLUMNS.visitedFrom,
  COLUMNS.tripId,
];

test("reads a place's trip, and treats a blank cell as no trip", () => {
  const index = indexHeaders(PLACE_HEADERS);
  const withTrip = placeFromRow(
    ["PL-0001", "Tokyo", 35.68, 139.76, "2026-05-04", "TRIP-0001"],
    index,
    "2026-08-20T00:00:00.000Z",
  );
  const withoutTrip = placeFromRow(
    ["PL-0002", "Seattle", 47.6, -122.33, "2025-01-02", ""],
    index,
    "2026-08-20T00:00:00.000Z",
  );

  assert.equal(withTrip.tripId, "TRIP-0001");
  assert.equal(withoutTrip.tripId, undefined);
});

test("a Places tab with no trip column still loads", () => {
  const index = indexHeaders(PLACE_HEADERS.slice(0, 5));
  const parsed = placeFromRow(
    ["PL-0001", "Tokyo", 35.68, 139.76, "2026-05-04"],
    index,
    "2026-08-20T00:00:00.000Z",
  );
  assert.equal(parsed.name, "Tokyo");
  assert.equal(parsed.tripId, undefined);
});

test("assigning and clearing a trip both write the cell", () => {
  assert.equal(fieldsFromChanges({ tripId: "TRIP-0001" })[COLUMNS.tripId], "TRIP-0001");
  // Clearing has to send an empty string. Sending nothing would leave the old
  // trip in the cell, and "remove from trip" would silently do nothing.
  assert.equal(fieldsFromChanges({ tripId: undefined })[COLUMNS.tripId], "");
});

test("a save that never mentions the trip leaves the cell alone", () => {
  assert.equal(COLUMNS.tripId in fieldsFromChanges({ notes: "Rained all week" }), false);
});

process.exit(failures === 0 ? 0 : 1);
