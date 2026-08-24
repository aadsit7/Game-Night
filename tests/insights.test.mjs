/**
 * Exercises the Stats tab's arithmetic: what counts as a stay, how places
 * rank, and what a matrix cell holds.
 *
 * The failures worth catching are inflations: a wishlist entry ranked as a
 * visit, a residence counted as a stay, a booked-but-future trip already on
 * the leaderboard, or the implicit visit double-counted next to real rows.
 * A dashboard that flatters is worse than none.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { buildInsights, tallyPlace, scopeMembers } = await import("../lib/insights/insights.ts");
const { continentOf, UNKNOWN_CONTINENT } = await import("../lib/insights/continents.ts");

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

console.log("insights");

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

test("continents know their countries, and admit what they don't", () => {
  assert.equal(continentOf("JP"), "Asia");
  assert.equal(continentOf("fr"), "Europe");
  assert.equal(continentOf("US"), "North America");
  assert.equal(continentOf("AU"), "Oceania");
  assert.equal(continentOf("BR"), "South America");
  assert.equal(continentOf("ZZ"), UNKNOWN_CONTINENT);
  assert.equal(continentOf(undefined), UNKNOWN_CONTINENT);
});

test("a place's tally counts stays that happened, and nothing else", () => {
  const disneyland = place("Disneyland", "United States", "US");
  const rows = [
    visit(disneyland.id, "2019-06-01", "2019-06-03"),
    visit(disneyland.id, "2022-06-10", "2022-06-14"),
    // Living somewhere is not visiting it.
    visit(disneyland.id, "2020-01-01", "2020-12-31", { status: "Lived there" }),
    // Booked is not been.
    visit(disneyland.id, "2100-01-01", "2100-01-05"),
  ];

  const tally = tallyPlace(disneyland, rows);
  assert.equal(tally.stays, 2);
  assert.equal(tally.days, 3 + 5);
  assert.deepEqual(tally.years.get(2019), { stays: 1, days: 3 });
  assert.deepEqual(tally.years.get(2022), { stays: 1, days: 5 });
});

test("dates alone imply one visit; real rows silence the implication", () => {
  const dated = place("Lisbon", "Portugal", "PT", {
    visitedFrom: "2023-09-12",
    visitedTo: "2023-09-19",
  });
  assert.equal(tallyPlace(dated, []).stays, 1);
  assert.equal(tallyPlace(dated, []).days, 8);

  // One real row means the place columns are derived from it — counting both
  // would turn one trip into two.
  const withRow = tallyPlace(dated, [visit(dated.id, "2023-09-12", "2023-09-19")]);
  assert.equal(withRow.stays, 1);
});

test("wishes and residences never reach the board", () => {
  const wish = place("Petra", "Jordan", "JO", { wantToGo: true, visitedFrom: undefined });
  assert.equal(tallyPlace(wish, []), null);

  const home = place("Home", "United States", "US");
  assert.equal(
    tallyPlace(home, [visit(home.id, "2010-01-01", "2020-01-01", { status: "Lived there" })]),
    null,
  );
});

/* One journal, built to have shape: a favourite theme park, a favourite
   country, and a scattering of singles. */
function journal() {
  const disneyland = place("Disneyland", "United States", "US");
  const kyoto = place("Kyoto", "Japan", "JP");
  const osaka = place("Osaka", "Japan", "JP");
  const lisbon = place("Lisbon", "Portugal", "PT", {
    visitedFrom: "2023-09-12",
    visitedTo: "2023-09-19",
  });
  const places = [disneyland, kyoto, osaka, lisbon];
  const visits = [
    visit(disneyland.id, "2019-06-01", "2019-06-03"),
    visit(disneyland.id, "2022-06-10", "2022-06-14"),
    visit(disneyland.id, "2024-06-01", "2024-06-02"),
    visit(kyoto.id, "2019-03-25", "2019-04-02"),
    visit(kyoto.id, "2024-03-20", "2024-03-27"),
    visit(osaka.id, "2024-03-27", "2024-03-29"),
  ];
  return { places, visits, disneyland, kyoto };
}

test("the regulars are the repeats, most-visited first", () => {
  const { places, visits } = journal();
  const insights = buildInsights(places, visits);

  assert.deepEqual(
    insights.regulars.map((tally) => [tally.place.name, tally.stays]),
    [["Disneyland", 3], ["Kyoto", 2]],
  );
  // Lisbon has been visited once; once is not a regular.
  assert.equal(insights.regulars.some((t) => t.place.name === "Lisbon"), false);
});

test("countries and continents roll the same stays up, twice", () => {
  const { places, visits } = journal();
  const { countries, continents, totals } = buildInsights(places, visits);

  // Days are inclusive, the way the place card counts them: Mar 25 – Apr 2
  // is nine days, not eight.
  const japan = countries.find((row) => row.label === "Japan");
  assert.deepEqual([japan.places, japan.stays, japan.days], [2, 3, 20]);

  const asia = continents.find((row) => row.label === "Asia");
  assert.deepEqual([asia.places, asia.stays], [2, 3]);
  const europe = continents.find((row) => row.label === "Europe");
  assert.deepEqual([europe.places, europe.stays], [1, 1]);

  assert.deepEqual(totals, { places: 4, countries: 3, stays: 7, days: 38 });
});

test("the matrix holds each country's years, and only years that happened", () => {
  const { places, visits } = journal();
  const { matrix } = buildInsights(places, visits);

  assert.deepEqual(matrix.years, [2019, 2022, 2023, 2024]);
  assert.deepEqual(matrix.cells.get("jp:2024"), { stays: 2, days: 11 });
  assert.deepEqual(matrix.cells.get("us:2022"), { stays: 1, days: 5 });
  assert.equal(matrix.cells.get("jp:2022"), undefined);
});

test("a drill shows the scope's own numbers, not the lifetime ones", () => {
  const { places, visits } = journal();

  const japanAllTime = scopeMembers({ level: "country", key: "jp" }, places, visits);
  assert.deepEqual(
    japanAllTime.map((t) => [t.place.name, t.stays]),
    [["Kyoto", 2], ["Osaka", 1]],
  );

  const japan2024 = scopeMembers({ level: "country", key: "jp", year: 2024 }, places, visits);
  assert.deepEqual(
    japan2024.map((t) => [t.place.name, t.stays, t.days]),
    [["Kyoto", 1, 8], ["Osaka", 1, 3]],
  );

  const europe = scopeMembers({ level: "continent", key: "Europe" }, places, visits);
  assert.deepEqual(europe.map((t) => t.place.name), ["Lisbon"]);
});

process.exit(failures === 0 ? 0 : 1);
