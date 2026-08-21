/**
 * Exercises the chronology the timeline tab is drawn from.
 *
 * Date arithmetic is where a timeline goes quietly wrong: a trip that crosses
 * new year, a visit with no end, an end typed before its start, a duration
 * measured across a daylight-saving boundary. None of those are visible in a
 * screenshot, and all of them are here.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { buildTimeline, formatDays, gapLabel } = await import("../lib/timeline/buildTimeline.ts");

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

const place = (name, from, to, extra = {}) => ({
  id: name,
  name,
  country: extra.country ?? "Japan",
  countryCode: extra.countryCode ?? "JP",
  latitude: 0,
  longitude: 0,
  visitedFrom: from,
  visitedTo: to,
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  ...extra,
});

console.log("timeline");

test("a place you only want to go to has no place in the chronology", () => {
  const t = buildTimeline([
    place("Kyoto", "2024-03-25", "2024-04-02"),
    // Dated or not, a wish has not happened: it belongs on neither the
    // timeline nor the "waiting for dates" list underneath it.
    place("Patagonia", undefined, undefined, { wantToGo: true }),
    place("Petra", "2030-01-01", "2030-01-05", { wantToGo: true }),
  ]);

  assert.deepEqual(t.years.flatMap((y) => y.entries.map((e) => e.place.name)), ["Kyoto"]);
  assert.deepEqual(t.undated.map((p) => p.name), []);
  assert.equal(t.totals.places, 1);
});

test("groups places into years, oldest first", () => {
  const t = buildTimeline([
    place("Kyoto", "2024-03-25", "2024-04-02"),
    place("Lisbon", "2019-09-12", "2019-09-19"),
    place("Banff", "2021-07-18", "2021-07-25"),
  ]);

  assert.deepEqual(t.years.map((y) => y.year), [2019, 2021, 2024]);
  assert.equal(t.totals.years, 3);
});

test("orders entries chronologically inside a year", () => {
  const t = buildTimeline([
    place("December", "2024-12-01", "2024-12-03"),
    place("January", "2024-01-05", "2024-01-09"),
    place("June", "2024-06-02", "2024-06-04"),
  ]);

  assert.deepEqual(t.years[0].entries.map((e) => e.place.name), ["January", "June", "December"]);
});

test("counts days inclusively — a day trip is one day", () => {
  const t = buildTimeline([
    place("One day", "2024-05-01", "2024-05-01"),
    place("Nine days", "2024-06-01", "2024-06-09"),
  ]);

  const [first, second] = t.years[0].entries;
  assert.equal(first.days, 1);
  assert.equal(second.days, 9);
});

test("a duration spanning a daylight-saving change is still a whole number", () => {
  // Across most of the northern hemisphere the clocks move inside this range,
  // making the two local midnights 23 or 25 hours apart.
  const t = buildTimeline([place("Spring forward", "2024-03-08", "2024-03-15")]);
  assert.equal(t.years[0].entries[0].days, 8);
});

test("a visit with no end date is a single day, not an open range", () => {
  const t = buildTimeline([place("Just arrived", "2024-05-01", undefined)]);
  const entry = t.years[0].entries[0];
  assert.equal(entry.days, 1);
  assert.equal(entry.end, "2024-05-01");
});

test("an end typed before the start is treated as a typo, not a negative trip", () => {
  const t = buildTimeline([place("Backwards", "2024-05-10", "2024-05-01")]);
  const entry = t.years[0].entries[0];
  assert.equal(entry.days, 1, "never negative");
  assert.equal(entry.end, "2024-05-10");
});

test("a trip across new year belongs to the year it began in", () => {
  const t = buildTimeline([place("New Year", "2023-12-28", "2024-01-03")]);

  assert.deepEqual(t.years.map((y) => y.year), [2023]);
  assert.equal(t.years[0].entries[0].days, 7);
});

test("places with no usable date are set aside rather than dropped", () => {
  const t = buildTimeline([
    place("Dated", "2024-05-01", "2024-05-02"),
    place("No date", undefined, undefined),
    place("Nonsense", "not-a-date", undefined),
    place("Impossible", "2024-02-31", undefined),
  ]);

  assert.equal(t.years.length, 1);
  assert.deepEqual(t.undated.map((p) => p.name), ["Impossible", "No date", "Nonsense"]);
  assert.equal(t.totals.places, 1, "totals describe the dated chronology");
});

test("counts distinct countries by code, not by spelling", () => {
  const t = buildTimeline([
    place("Kyoto", "2024-01-01", "2024-01-02", { country: "Japan", countryCode: "JP" }),
    place("Osaka", "2024-02-01", "2024-02-02", { country: "japan", countryCode: "jp" }),
    place("Lisbon", "2024-03-01", "2024-03-02", { country: "Portugal", countryCode: "PT" }),
  ]);

  assert.equal(t.years[0].countries, 2);
  assert.equal(t.totals.countries, 2);
});

test("falls back to the country name when there is no code", () => {
  const t = buildTimeline([
    place("A", "2024-01-01", "2024-01-02", { country: "Narnia", countryCode: undefined }),
    place("B", "2024-02-01", "2024-02-02", { country: "narnia", countryCode: undefined }),
  ]);
  assert.equal(t.totals.countries, 1);
});

test("busiest year sets the histogram scale", () => {
  const t = buildTimeline([
    place("A", "2020-01-01", "2020-01-02"),
    place("B", "2024-01-01", "2024-01-02"),
    place("C", "2024-02-01", "2024-02-02"),
    place("D", "2024-03-01", "2024-03-02"),
  ]);

  assert.equal(t.busiest, 3);
});

test("an empty history produces an empty timeline rather than throwing", () => {
  const t = buildTimeline([]);
  assert.deepEqual(t.years, []);
  assert.deepEqual(t.undated, []);
  assert.equal(t.busiest, 0);
  assert.deepEqual(t.totals, { places: 0, countries: 0, years: 0, days: 0 });
});

test("a history with no dates at all still renders something", () => {
  const t = buildTimeline([place("Somewhere", undefined, undefined)]);
  assert.equal(t.years.length, 0);
  assert.equal(t.undated.length, 1);
  assert.equal(t.busiest, 0);
});

test("day totals add up across years", () => {
  const t = buildTimeline([
    place("A", "2023-01-01", "2023-01-05"), // 5
    place("B", "2024-01-01", "2024-01-10"), // 10
  ]);

  assert.equal(t.years[0].days, 5);
  assert.equal(t.years[1].days, 10);
  assert.equal(t.totals.days, 15);
});

test("durations read as English", () => {
  assert.equal(formatDays(1), "1 day");
  assert.equal(formatDays(9), "9 days");
});

test("only gaps worth mentioning get a label", () => {
  assert.equal(gapLabel("2024-05-01", "2024-05-20"), null, "three weeks is not a gap");
  assert.equal(gapLabel("2024-01-01", "2024-05-01"), "4 months later");
  assert.equal(gapLabel("2022-01-01", "2023-01-01"), "a year later");
  assert.equal(gapLabel("2020-01-01", "2023-01-01"), "3 years later");
  assert.equal(gapLabel("2020-01-01", "2021-07-01"), "over a year later");
  assert.equal(gapLabel("bad", "2024-01-01"), null);
});

if (failures > 0) {
  console.error(`\n${failures} timeline test(s) failed.`);
  process.exit(1);
}
console.log("  all timeline tests passed\n");
