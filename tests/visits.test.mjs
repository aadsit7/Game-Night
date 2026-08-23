/**
 * Visits: the rows of Dates_Visits as records, the span and stats derived
 * from them, and the duplicate-place match that turns "add it again" into
 * "log another visit".
 *
 * The silent failures this guards against: a visit row parsed one column to
 * the left after a sheet edit; a deleted visit still stretching a place's
 * span; a re-added city growing a twin pin instead of a second visit; the
 * derived Days/Year/Month/Season cells drifting from the dates beside them.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  VISIT_COLUMNS,
  MEDIA_COLUMNS,
  visitsFromTable,
  fieldsFromVisitChanges,
  restrictToHeaders,
  mediaFromTable,
  applyMediaPhotos,
} = await import("../lib/sheets/mapping.ts");
const {
  implicitVisit,
  isImplicitVisitId,
  visitsForPlace,
  sortVisits,
  visitSpan,
  visitStats,
  visitStatusFor,
  isPlannedStatus,
  derivedVisitCells,
} = await import("../lib/places/visits.ts");
const { findDuplicatePlace, normalizePlaceName } = await import("../lib/places/dedupe.ts");

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

console.log("visits");

/* ------------------------------------------------------------------ *
 * Fixtures, built by header name — never by position.
 * ------------------------------------------------------------------ */

const VISIT_HEADERS = [
  "Place ID", "Visit ID", "Trip ID", "Visit Status", "Start Date", "End Date",
  "Days", "Year", "Month", "Season", "Trip Type", "Companions", "Highlights",
  "Created At", "Updated At", "Archived?", "Deleted?",
];

function row(headers, values) {
  const out = new Array(headers.length).fill("");
  for (const [header, value] of Object.entries(values)) {
    const at = headers.indexOf(header);
    assert.notEqual(at, -1, `fixture uses unknown column "${header}"`);
    out[at] = value;
  }
  return out;
}

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

/* ------------------------------------------------------------------ *
 * Reading Dates_Visits
 * ------------------------------------------------------------------ */

test("visits are read by header name, not position", () => {
  const table = {
    headers: VISIT_HEADERS,
    rows: [
      row(VISIT_HEADERS, {
        "Place ID": "PL-0001", "Visit ID": "VIS-0001", "Trip ID": "TRIP-0002",
        "Visit Status": "Been", "Start Date": "2024-02-07", "End Date": "2024-02-10",
        "Trip Type": "Family", "Highlights": "Snow.",
      }),
    ],
  };
  const [visit] = visitsFromTable(table, NOW);
  assert.equal(visit.id, "VIS-0001");
  assert.equal(visit.placeId, "PL-0001");
  assert.equal(visit.tripId, "TRIP-0002");
  assert.equal(visit.startDate, "2024-02-07");
  assert.equal(visit.endDate, "2024-02-10");
  assert.equal(visit.tripType, "Family");
  assert.equal(visit.status, "Been");
  assert.equal(visit.notes, "Snow.");
});

test("a row with no ids is skipped; duplicates keep the first", () => {
  const table = {
    headers: VISIT_HEADERS,
    rows: [
      row(VISIT_HEADERS, { "Visit ID": "VIS-0009" }),
      row(VISIT_HEADERS, { "Place ID": "PL-0001", "Visit ID": "VIS-0001", "Trip Type": "Solo" }),
      row(VISIT_HEADERS, { "Place ID": "PL-0002", "Visit ID": "VIS-0001", "Trip Type": "Work" }),
    ],
  };
  const visits = visitsFromTable(table, NOW);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].tripType, "Solo");
});

test("a soft-deleted visit carries its tombstone", () => {
  const table = {
    headers: VISIT_HEADERS,
    rows: [
      row(VISIT_HEADERS, { "Place ID": "PL-0001", "Visit ID": "VIS-0001", "Deleted?": "Yes" }),
    ],
  };
  const [visit] = visitsFromTable(table, NOW);
  assert.ok(visit.deletedAt, "Deleted? Yes must become deletedAt");
});

test("an end date alone falls back to the start date", () => {
  const table = {
    headers: VISIT_HEADERS,
    rows: [
      row(VISIT_HEADERS, { "Place ID": "PL-0001", "Visit ID": "VIS-0001", "Start Date": "2024-02-07" }),
    ],
  };
  const [visit] = visitsFromTable(table, NOW);
  assert.equal(visit.endDate, "2024-02-07");
});

test("an absent tab reads as no visits, not a failure", () => {
  assert.deepEqual(visitsFromTable(undefined, NOW), []);
});

/* ------------------------------------------------------------------ *
 * Writing visits
 * ------------------------------------------------------------------ */

test("dates bring their derived cells with them", () => {
  const fields = fieldsFromVisitChanges(
    { startDate: "2024-02-07", endDate: "2024-02-10" },
    { isNew: true, placeId: "PL-0001" },
  );
  assert.equal(fields[VISIT_COLUMNS.placeId], "PL-0001");
  assert.equal(fields[VISIT_COLUMNS.start], "2024-02-07");
  assert.equal(fields[VISIT_COLUMNS.end], "2024-02-10");
  assert.equal(fields[VISIT_COLUMNS.days], "4", "Feb 7–10 is 4 days, both ends counted");
  assert.equal(fields[VISIT_COLUMNS.year], "2024");
  assert.equal(fields[VISIT_COLUMNS.month], "February");
  assert.equal(fields[VISIT_COLUMNS.season], "Winter");
  assert.equal(fields[VISIT_COLUMNS.deleted], "No");
  assert.equal(fields[VISIT_COLUMNS.archived], "No");
});

test("only the fields mentioned travel", () => {
  const fields = fieldsFromVisitChanges({ notes: "Great." }, {});
  assert.deepEqual(Object.keys(fields), [VISIT_COLUMNS.notes]);
});

test("seasons follow the sheet's own words", () => {
  assert.equal(derivedVisitCells("2024-04-01", undefined).season, "Spring");
  assert.equal(derivedVisitCells("2024-07-01", undefined).season, "Summer");
  assert.equal(derivedVisitCells("2024-10-01", undefined).season, "Autumn/Fall");
  assert.equal(derivedVisitCells("2024-12-25", undefined).season, "Winter");
  assert.equal(derivedVisitCells(undefined, undefined).season, "");
});

test("a write is trimmed to the columns the sheet actually has", () => {
  const fields = { "Start Date": "2024-02-07", "Deleted?": "No" };
  const trimmed = restrictToHeaders(fields, ["Place ID", "Visit ID", "Start Date"]);
  assert.deepEqual(trimmed, { "Start Date": "2024-02-07" });
  // Headers unknown — a cache-only session — means nothing is dropped.
  assert.deepEqual(restrictToHeaders(fields, []), fields);
  assert.deepEqual(restrictToHeaders(fields, undefined), fields);
});

/* ------------------------------------------------------------------ *
 * Span, stats and the implicit visit
 * ------------------------------------------------------------------ */

function visit(extra = {}) {
  return {
    id: "VIS-0001",
    placeId: "PL-0001",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

test("the span folds every visit into one date range", () => {
  const span = visitSpan([
    visit({ startDate: "2024-02-07", endDate: "2024-02-10" }),
    visit({ id: "VIS-0002", startDate: "2015-02-27", endDate: "2015-12-08" }),
    visit({ id: "VIS-0003", startDate: "2026-08-12", endDate: "2026-08-16" }),
  ]);
  assert.equal(span.from, "2015-02-27");
  assert.equal(span.to, "2026-08-16");
});

test("stats count visits and sum inclusive days", () => {
  const stats = visitStats([
    visit({ startDate: "2024-02-07", endDate: "2024-02-10" }),
    visit({ id: "VIS-0002", startDate: "2015-06-18", endDate: "2015-06-24" }),
  ]);
  assert.equal(stats.count, 2);
  assert.equal(stats.daysTotal, 4 + 7);
  assert.equal(stats.firstYear, "2015");
  assert.equal(stats.lastLabel, "Feb 2024");
});

test("a place with old-style dates implies one visit", () => {
  const implied = implicitVisit(place({ visitedFrom: "2019-06-18", visitedTo: "2019-06-24" }));
  assert.ok(implied);
  assert.ok(isImplicitVisitId(implied.id));
  assert.equal(implied.startDate, "2019-06-18");
  assert.equal(implied.endDate, "2019-06-24");
});

test("a wishlist place and a dateless place imply nothing", () => {
  assert.equal(implicitVisit(place({ wantToGo: true, visitedFrom: "2019-06-18" })), null);
  assert.equal(implicitVisit(place()), null);
});

test("real rows silence the implicit visit", () => {
  const p = place({ visitedFrom: "2019-06-18" });
  const real = visit({ startDate: "2024-02-07" });
  const shown = visitsForPlace(p, [real]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "VIS-0001");
});

test("visits sort newest first, undated last", () => {
  const sorted = sortVisits([
    visit({ id: "a", startDate: "2015-02-27" }),
    visit({ id: "b" }),
    visit({ id: "c", startDate: "2026-08-12" }),
  ]);
  assert.deepEqual(sorted.map((v) => v.id), ["c", "a", "b"]);
});

test("status follows the calendar", () => {
  assert.equal(visitStatusFor("1990-01-01"), "Been");
  assert.equal(visitStatusFor("2990-01-01"), "Planned");
  assert.equal(visitStatusFor(undefined), "Been");
  assert.ok(isPlannedStatus("Planned"));
  assert.ok(isPlannedStatus("Booked"));
  assert.ok(!isPlannedStatus("Been"));
  assert.ok(!isPlannedStatus(undefined));
});

/* ------------------------------------------------------------------ *
 * Duplicate places
 * ------------------------------------------------------------------ */

test("same name in the same country is the same place", () => {
  const existing = place();
  const match = findDuplicatePlace(
    {
      name: "salt lake city",
      country: "United States",
      countryCode: "US",
      latitude: 40.7,
      longitude: -111.8,
    },
    [existing],
  );
  assert.equal(match, existing);
});

test("accents don't hide a duplicate", () => {
  assert.equal(normalizePlaceName("São  Paulo"), "sao paulo");
  const existing = place({ name: "São Paulo", country: "Brazil", countryCode: "BR", latitude: -23.55, longitude: -46.63 });
  const match = findDuplicatePlace(
    { name: "Sao Paulo", country: "Brazil", countryCode: "BR", latitude: -20, longitude: -40 },
    [existing],
  );
  assert.equal(match, existing);
});

test("the same name in a different country is a different place", () => {
  const existing = place({ name: "Springfield", countryCode: "US" });
  const match = findDuplicatePlace(
    { name: "Springfield", country: "Australia", countryCode: "AU", latitude: -27.65, longitude: 152.92 },
    [existing],
  );
  assert.equal(match, null);
});

test("two pins on the same rooftop match whatever they're called", () => {
  const existing = place();
  const match = findDuplicatePlace(
    {
      name: "Temple Square",
      country: "United States",
      countryCode: "US",
      latitude: existing.latitude + 0.0005,
      longitude: existing.longitude,
    },
    [existing],
  );
  assert.equal(match, existing, "≈55m apart must match");
});

test("a kilometre apart is not the same spot", () => {
  const existing = place();
  const match = findDuplicatePlace(
    {
      name: "Liberty Park",
      country: "United States",
      countryCode: "US",
      latitude: existing.latitude + 0.01,
      longitude: existing.longitude,
    },
    [existing],
  );
  assert.equal(match, null);
});

test("a deleted place never matches", () => {
  const existing = place({ deletedAt: NOW });
  const match = findDuplicatePlace(
    { name: "Salt Lake City", country: "United States", countryCode: "US", latitude: 40.7608, longitude: -111.891 },
    [existing],
  );
  assert.equal(match, null);
});

/* ------------------------------------------------------------------ *
 * Media links — uploaded photos
 * ------------------------------------------------------------------ */

const MEDIA_HEADERS = [
  "Media ID", "Place ID", "Visit ID", "Media Type", "Title", "URL", "File Name",
  "Created At", "Updated At", "Deleted?",
];

test("only live photo rows with real links come back", () => {
  const table = {
    headers: MEDIA_HEADERS,
    rows: [
      row(MEDIA_HEADERS, { "Media ID": "MEDIA-0001", "Place ID": "PL-0001", "Media Type": "Photo", "URL": "https://example.com/a.jpg" }),
      row(MEDIA_HEADERS, { "Media ID": "MEDIA-0002", "Place ID": "PL-0001", "Media Type": "Website", "URL": "https://example.com/" }),
      row(MEDIA_HEADERS, { "Media ID": "MEDIA-0003", "Place ID": "PL-0001", "Media Type": "Photo", "URL": "https://example.com/b.jpg", "Deleted?": "Yes" }),
      row(MEDIA_HEADERS, { "Media ID": "MEDIA-0004", "Place ID": "PL-0001", "Media Type": "Photo", "URL": "photo:not-a-link" }),
    ],
  };
  const media = mediaFromTable(table);
  assert.equal(media.length, 1);
  assert.equal(media[0].id, "MEDIA-0001");
  assert.equal(media[0].url, "https://example.com/a.jpg");
  assert.equal(MEDIA_COLUMNS.url, "URL");
});

test("uploads attach to their place without repeating what it has", () => {
  const bare = place();
  const covered = place({ id: "PL-0002", coverImage: "https://example.com/cover.jpg" });
  const [withCover, withExtra] = applyMediaPhotos(
    [bare, covered],
    [
      { id: "MEDIA-0001", placeId: "PL-0001", url: "https://example.com/a.jpg" },
      { id: "MEDIA-0002", placeId: "PL-0002", url: "https://example.com/cover.jpg" },
      { id: "MEDIA-0003", placeId: "PL-0002", url: "https://example.com/b.jpg" },
    ],
  );
  // A coverless place takes its first upload as the cover.
  assert.equal(withCover.coverImage, "https://example.com/a.jpg");
  // A place that has a cover keeps it, and doesn't repeat it in photos.
  assert.equal(withExtra.coverImage, "https://example.com/cover.jpg");
  assert.deepEqual(withExtra.photos, ["https://example.com/b.jpg"]);
});

if (failures > 0) {
  console.error(`\n${failures} visit test(s) failed.`);
  process.exit(1);
}
console.log("  all visits tests passed\n");
