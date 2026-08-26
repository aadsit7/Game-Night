/**
 * The travel dashboard's arithmetic: the figures the Stats tab leads with.
 *
 * The failures worth catching are the flattering ones — a residence counted
 * as a trip, a booked flight already in this year's total, a wishlist entry
 * inflating the country count — and the quietly wrong ones: a year compared
 * against the wrong year, a country called "new" in the year you went back to
 * it, a median dragged around by one sabbatical, a distance measured from
 * nowhere.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { buildDashboard, continentCoverage, continentsVisited, dashboardEntries, daysBetween } =
  await import("../lib/insights/dashboard.ts");
const { buildInsights } = await import("../lib/insights/insights.ts");

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

console.log("dashboard");

/** Pinned, so "how long ago" never depends on the day the suite is run. */
const TODAY = "2026-06-15";

let nextId = 0;
function place(name, country, countryCode, extra = {}) {
  nextId += 1;
  return {
    id: `PL-${nextId}`,
    name,
    country,
    countryCode,
    latitude: 0,
    longitude: 0,
    createdAt: "2020-01-01",
    updatedAt: "2020-01-01",
    ...extra,
  };
}

let nextVisit = 0;
function visit(placeId, startDate, endDate, extra = {}) {
  nextVisit += 1;
  return {
    id: `VIS-${nextVisit}`,
    placeId,
    startDate,
    endDate,
    createdAt: "2020-01-01",
    updatedAt: "2020-01-01",
    ...extra,
  };
}

/*
 * One journal, used by most of what follows: two countries, four years, a
 * residence, a booking and a wish.
 */
function journal() {
  const kyoto = place("Kyoto", "Japan", "JP", { latitude: 35.01, longitude: 135.77 });
  const tokyo = place("Tokyo", "Japan", "JP", { latitude: 35.68, longitude: 139.69 });
  const paris = place("Paris", "France", "FR", { latitude: 48.86, longitude: 2.35 });
  const provo = place("Provo", "United States", "US", { latitude: 40.23, longitude: -111.66 });
  const lisbon = place("Lisbon", "Portugal", "PT", {
    latitude: 38.72,
    longitude: -9.14,
    wantToGo: true,
  });

  const visits = [
    // 2024: Japan for the first time — two stays, eight days.
    visit(kyoto.id, "2024-04-01", "2024-04-05"),
    visit(tokyo.id, "2024-04-06", "2024-04-08"),
    // 2025: back to Japan, and France for the first time.
    visit(kyoto.id, "2025-07-10", "2025-07-12"),
    visit(paris.id, "2025-09-01", "2025-09-10"),
    // Living in Provo is not a trip to Provo.
    visit(provo.id, "2020-01-01", "2023-12-31", { status: "Lived there" }),
    // A booking is not a visit.
    visit(paris.id, "2026-12-01", "2026-12-08"),
  ];

  return { places: [kyoto, tokyo, paris, provo, lisbon], visits, kyoto, tokyo, paris, provo };
}

test("days between two calendar dates, and nothing when a date is missing", () => {
  assert.equal(daysBetween("2026-06-01", "2026-06-15"), 14);
  assert.equal(daysBetween("2026-06-15", "2026-06-15"), 0);
  assert.equal(daysBetween(undefined, "2026-06-15"), null);
  assert.equal(daysBetween("2026-06-15", "not a date"), null);
});

test("only stays that happened become entries", () => {
  const { places, visits } = journal();
  const entries = dashboardEntries(places, visits, { today: TODAY });
  // Four real stays: the residence, the booking and the wish are all out.
  assert.equal(entries.length, 4);
  assert.ok(entries.every((entry) => entry.place.name !== "Provo"));
  assert.ok(entries.every((entry) => (entry.visit.startDate ?? "") < "2026-01-01"));
});

test("the totals count trips, days, countries and places", () => {
  const { places, visits } = journal();
  const { totals } = buildDashboard(places, visits, { today: TODAY });
  assert.equal(totals.trips, 4);
  // 5 + 3 + 3 + 10, both ends counted.
  assert.equal(totals.days, 21);
  // Japan and France. Portugal is a wish, the United States an address.
  assert.equal(totals.countries, 2);
  assert.equal(totals.places, 3);
});

test("a year is measured against the year before it", () => {
  const { places, visits } = journal();
  const board = buildDashboard(places, visits, { year: 2025, today: TODAY });
  assert.equal(board.totals.trips, 2);
  assert.equal(board.totals.days, 13);
  assert.equal(board.previous?.year, 2024);
  assert.equal(board.previous?.totals.trips, 2);
  assert.equal(board.previous?.totals.days, 8);
  // All time has nothing to compare against, and says so.
  assert.equal(buildDashboard(places, visits, { today: TODAY }).previous, null);
});

test("a country is new only in the year you first saw it", () => {
  const { places, visits } = journal();
  // 2024 was Japan's first year; 2025 added France and returned to Japan.
  assert.equal(buildDashboard(places, visits, { year: 2024, today: TODAY }).newCountries, 1);
  assert.equal(buildDashboard(places, visits, { year: 2025, today: TODAY }).newCountries, 1);
  // Nothing happened in 2023 but the residence.
  assert.equal(buildDashboard(places, visits, { year: 2023, today: TODAY }).newCountries, 0);
});

test("the calendar keeps every year, whatever year the lens is set to", () => {
  const { places, visits } = journal();
  const board = buildDashboard(places, visits, { year: 2025, today: TODAY });
  assert.deepEqual(board.years.map((row) => row.year), [2024, 2025]);
  assert.deepEqual(board.years.map((row) => row.newCountries), [1, 1]);
  assert.deepEqual(board.years.map((row) => row.days), [8, 13]);
  assert.deepEqual(board.span, { from: 2024, to: 2025 });
});

test("the months hold twelve, and name the busiest one", () => {
  const { places, visits } = journal();
  const board = buildDashboard(places, visits, { today: TODAY });
  assert.equal(board.months.length, 12);
  // April: 5 + 3 days. September: 10.
  assert.equal(board.months[3].days, 8);
  assert.equal(board.months[3].trips, 2);
  assert.equal(board.months[8].days, 10);
  // Ranked by visits — the default — April wins; ranked by days, September.
  assert.equal(board.busiestMonth?.month, 3);
  assert.equal(
    buildDashboard(places, visits, { metric: "days", today: TODAY }).busiestMonth?.month,
    8,
  );
});

test("the records are the longest stay, a typical one, and the latest", () => {
  const { places, visits } = journal();
  const board = buildDashboard(places, visits, { today: TODAY });
  assert.equal(board.longest?.place.name, "Paris");
  assert.equal(board.longest?.days, 10);
  assert.equal(board.longest?.label, "Sep 2025");
  // 3, 3, 5, 10 — the middle pair averages to 4.
  assert.equal(board.typicalDays, 4);
  assert.equal(board.last?.place.name, "Paris");
  assert.equal(board.last?.daysAgo, daysBetween("2025-09-01", TODAY));
});

test("home comes from the residence, and distance is measured from it", () => {
  const { places, visits } = journal();
  const board = buildDashboard(places, visits, { today: TODAY });
  assert.equal(board.home?.name, "Provo");
  assert.equal(board.furthest?.fromHome, true);
  // Provo to Kyoto is about 9,170 km — further than Tokyo or Paris.
  assert.equal(board.furthest?.place.name, "Kyoto");
  assert.ok(board.furthest.km > 9_000 && board.furthest.km < 9_400);
});

test("with nowhere lived, distance is measured from the middle of the map", () => {
  const { places, visits } = journal();
  const noResidence = visits.filter((row) => row.status !== "Lived there");
  const board = buildDashboard(places, noResidence, { today: TODAY });
  assert.equal(board.home, null);
  assert.equal(board.furthest?.fromHome, false);
  // The centre of two Japanese places and one French one sits in Asia, so
  // Paris is the outlier.
  assert.equal(board.furthest?.place.name, "Paris");
});

test("the horizon holds the bookings and the wishlist, and nothing done", () => {
  const { places, visits } = journal();
  const board = buildDashboard(places, visits, { today: TODAY });
  assert.equal(board.upcoming.length, 1);
  assert.equal(board.upcoming[0].place.name, "Paris");
  assert.equal(board.upcoming[0].inDays, daysBetween(TODAY, "2026-12-01"));
  // Lisbon is a wish, and Portugal would be a country you have never seen.
  assert.deepEqual(board.wishlist, { places: 1, newCountries: 1 });
});

test("a planned visit to a wishlist place still reaches the horizon", () => {
  const oslo = place("Oslo", "Norway", "NO", { wantToGo: true });
  const board = buildDashboard([oslo], [visit(oslo.id, "2026-08-01", "2026-08-07")], {
    today: TODAY,
  });
  assert.equal(board.upcoming.length, 1);
  assert.equal(board.upcoming[0].place.name, "Oslo");
  // It is still a plan, so it counts towards nothing that happened.
  assert.equal(board.totals.trips, 0);
});

test("the trip-type lens narrows every figure the same way", () => {
  const kyoto = place("Kyoto", "Japan", "JP");
  const paris = place("Paris", "France", "FR");
  const rows = [
    visit(kyoto.id, "2025-04-01", "2025-04-04", { tripType: "Family" }),
    visit(paris.id, "2025-09-01", "2025-09-10", { tripType: "Solo" }),
  ];
  const family = buildDashboard([kyoto, paris], rows, { tripType: "family", today: TODAY });
  assert.equal(family.totals.trips, 1);
  assert.equal(family.totals.days, 4);
  assert.equal(family.totals.countries, 1);
  assert.equal(family.years[0].year, 2025);
  assert.equal(family.years[0].days, 4);
});

test("continents roll the same places up, biggest first", () => {
  const { places, visits } = journal();
  const board = buildDashboard(places, visits, { today: TODAY });
  assert.deepEqual(
    board.continents.map((row) => row.name),
    ["Asia", "Europe"],
  );
  assert.equal(board.continents[0].places, 2);
  assert.equal(board.continents[0].countries, 1);
});

test("an empty journal answers with zeroes rather than a crash", () => {
  const board = buildDashboard([], [], { today: TODAY });
  assert.deepEqual(board.totals, { trips: 0, days: 0, countries: 0, places: 0 });
  assert.equal(board.months.length, 12);
  assert.deepEqual(board.years, []);
  assert.equal(board.longest, null);
  assert.equal(board.typicalDays, 0);
  assert.equal(board.busiestMonth, null);
  assert.equal(board.last, null);
  assert.equal(board.home, null);
  assert.equal(board.furthest, null);
  assert.equal(board.span, null);
  assert.deepEqual(board.upcoming, []);
  assert.deepEqual(board.wishlist, { places: 0, newCountries: 0 });
});

test("a place with dates and no visit rows still counts once", () => {
  const rome = place("Rome", "Italy", "IT", {
    visitedFrom: "2022-05-01",
    visitedTo: "2022-05-04",
  });
  const board = buildDashboard([rome], [], { today: TODAY });
  assert.equal(board.totals.trips, 1);
  assert.equal(board.totals.days, 4);
  assert.equal(board.years[0].year, 2022);
});

test("the region lens narrows every figure to one continent", () => {
  const { places, visits } = journal();
  const asia = buildDashboard(places, visits, { continent: "Asia", today: TODAY });
  // Kyoto and Tokyo, 2024 only. France and the residence are elsewhere.
  assert.equal(asia.totals.trips, 3);
  assert.equal(asia.totals.countries, 1);
  assert.equal(asia.totals.places, 2);
  assert.deepEqual(asia.years.map((row) => row.year), [2024, 2025]);
  assert.equal(asia.longest?.place.name, "Kyoto");
  // Home stays home — an address is not inside the lens.
  assert.equal(asia.home?.name, "Provo");
  assert.equal(asia.continents.length, 1);
  // The Paris booking and the Lisbon wish are both European, so neither
  // reaches an Asian horizon.
  assert.equal(asia.upcoming.length, 0);
  assert.deepEqual(asia.wishlist, { places: 0, newCountries: 0 });
});

test("the region lens reaches the leaderboards too", () => {
  const { places, visits } = journal();
  const europe = buildInsights(places, visits, { continent: "Europe" });
  assert.deepEqual(europe.countries.map((row) => row.label), ["France"]);
  assert.equal(europe.totals.places, 1);
});

test("the coverage strip ignores the region it is used to choose", () => {
  const { places, visits } = journal();
  const coverage = continentCoverage(places, visits, { continent: "Asia", today: TODAY });
  // Asked while looking at Asia, it still knows about Europe — or the strip
  // would have no way back out.
  assert.deepEqual(coverage.map((row) => row.name).sort(), ["Asia", "Europe"]);
  // A year still narrows it: 2025 held one Japanese stay and one French one.
  const in2025 = continentCoverage(places, visits, { year: 2025, today: TODAY });
  assert.deepEqual(in2025.map((row) => row.name).sort(), ["Asia", "Europe"]);
  assert.equal(in2025.find((row) => row.name === "Asia")?.places, 1);
});

test("the region vocabulary is only continents you have been to", () => {
  const { places, visits } = journal();
  assert.deepEqual(continentsVisited(places, visits), ["Asia", "Europe"]);
});

if (failures > 0) {
  console.error(`\n${failures} dashboard test(s) failed.`);
  process.exit(1);
}
console.log("  all dashboard tests passed\n");
