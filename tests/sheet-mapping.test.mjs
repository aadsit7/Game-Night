/**
 * Exercises the translation between a Places row and a travel record.
 *
 * This is the layer where a mistake is silent and expensive: Places is 78
 * columns wide, so writing by position instead of by name would put a note
 * into a booking URL and nothing would complain. The header row below is the
 * real one, copied from the sheet, and one test inserts a column into it to
 * prove nothing shifts.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  COLUMNS,
  STATUS_BEEN,
  STATUS_WANT_TO_GO,
  applyVisitSpans,
  fieldsFromChanges,
  indexHeaders,
  isRemotePhoto,
  placesFromTable,
  visitSpans,
} = await import("../lib/sheets/mapping.ts");

/** The Places header row exactly as it stands in the sheet: 78 columns. */
const PLACES_HEADERS = [
  "Place ID", "User ID", "Place Name", "Alternate Names", "Place Type", "Status",
  "Favorite", "Priority", "Description", "Personal Notes", "Tags", "List Names",
  "Trip ID / Collection", "Country", "Country Code", "Region / State", "City",
  "Neighborhood", "Address", "Latitude", "Longitude", "Coordinate Key", "Map URL",
  "Plus Code", "Timezone", "Continent", "Best Season", "Best Month(s)",
  "Planned Start Date", "Planned End Date", "First Visited Date", "Last Visited Date",
  "Visit Count", "Days Spent Total", "Rating 1-5", "Would Return?", "Cost Level",
  "Local Currency", "Safety", "Accessibility", "Kid Friendly?", "Pet Friendly?",
  "Solo Friendly?", "Transit Notes", "Visa / Entry Notes", "Language Notes",
  "Food Notes", "Must Do", "Avoid / Watch Outs", "Opening Hours",
  "Reservation Needed?", "Booking URL", "Official Website", "Source URL",
  "Photo URL", "Image Credit", "Local Tips", "Packing / Prep Notes", "Weather Notes",
  "Companions", "Created At", "Updated At", "Last Synced At", "Sync Version",
  "Archived?", "Deleted?", "Privacy", "External Place ID", "Google Place ID",
  "OSM ID", "What3Words", "Search Text", "Next Action", "Action Due Date",
  "Reminder Set?", "Reminder Notes", "Custom Field 1", "Custom Field 2",
];

/** Builds a row by header name, so the fixtures cannot drift out of step. */
function row(headers, values) {
  const cells = new Array(headers.length).fill("");
  for (const [header, value] of Object.entries(values)) {
    const at = headers.indexOf(header);
    assert.notEqual(at, -1, `fixture names a column that doesn't exist: ${header}`);
    cells[at] = value;
  }
  return cells;
}

const KYOTO = {
  "Place ID": "PL-0001",
  "Place Name": "Kyoto",
  "Status": "Want to go",
  "Personal Notes": "Add shrine list.",
  "Country": "Japan",
  "Country Code": "jp",
  "Region / State": "Kansai",
  "City": "Kyoto",
  "Latitude": "35.011600",
  "Longitude": "135.768100",
  "First Visited Date": "2027-03-25",
  "Last Visited Date": "2027-04-02",
  "Photo URL": "https://example.com/kyoto.jpg",
  "Created At": "2026-08-19",
  "Updated At": "2026-08-19T10:15:00",
  "Archived?": "No",
  "Deleted?": "No",
};

const FALLBACK = "2026-01-01T00:00:00.000Z";


/** A saved record, for the write tests that need a "before". */
const KYOTO_RECORD = {
  id: "PL-0001",
  name: "Kyoto",
  country: "Japan",
  latitude: 35.0116,
  longitude: 135.7681,
  createdAt: FALLBACK,
  updatedAt: FALLBACK,
};

/** The shape the form hands to a create. */
const NEW_INPUT = {
  name: "Somewhere new",
  country: "Japan",
  latitude: 35,
  longitude: 135,
};

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

console.log("sheet mapping");

test("reads a Places row into a travel record", () => {
  const [place] = placesFromTable(
    { headers: PLACES_HEADERS, rows: [row(PLACES_HEADERS, KYOTO)] },
    FALLBACK,
  );

  assert.equal(place.id, "PL-0001");
  assert.equal(place.name, "Kyoto");
  assert.equal(place.country, "Japan");
  assert.equal(place.countryCode, "JP", "country codes are normalised to upper case");
  assert.equal(place.city, "Kyoto");
  assert.equal(place.region, "Kansai");
  assert.equal(place.latitude, 35.0116);
  assert.equal(place.longitude, 135.7681);
  assert.equal(place.visitedFrom, "2027-03-25");
  assert.equal(place.visitedTo, "2027-04-02");
  assert.equal(place.notes, "Add shrine list.");
  assert.equal(place.coverImage, "https://example.com/kyoto.jpg");
  assert.equal(place.deletedAt, undefined);
});

test("an inserted column shifts nothing, because columns are found by name", () => {
  // The exact accident this mapping exists to prevent: someone adds a column
  // in the sheet, and position-based code writes every later field one to the
  // left without ever erroring.
  const shifted = ["Brand New Column", ...PLACES_HEADERS];
  const cells = row(shifted, { ...KYOTO, "Brand New Column": "ignore me" });

  const [place] = placesFromTable({ headers: shifted, rows: [cells] }, FALLBACK);

  assert.equal(place.name, "Kyoto");
  assert.equal(place.latitude, 35.0116);
  assert.equal(place.notes, "Add shrine list.");
});

test("Deleted? Yes becomes a tombstone rather than a missing row", () => {
  const cells = row(PLACES_HEADERS, { ...KYOTO, "Deleted?": "Yes" });
  const [place] = placesFromTable({ headers: PLACES_HEADERS, rows: [cells] }, FALLBACK);

  assert.ok(place, "the row is still read");
  assert.ok(place.deletedAt, "and is marked deleted so the app can hide it");
});

test("skips rows too incomplete to draw, without failing the load", () => {
  const rows = [
    row(PLACES_HEADERS, KYOTO),
    row(PLACES_HEADERS, { "Place ID": "PL-0002", "Place Name": "No coordinates yet" }),
    row(PLACES_HEADERS, { "Place ID": "PL-0003", "Latitude": "10", "Longitude": "10" }),
  ];
  const places = placesFromTable({ headers: PLACES_HEADERS, rows }, FALLBACK);

  assert.equal(places.length, 1, "a half-filled row is skipped, not fatal");
  assert.equal(places[0].id, "PL-0001");
});

test("two rows claiming one id do not become two pins", () => {
  const rows = [row(PLACES_HEADERS, KYOTO), row(PLACES_HEADERS, { ...KYOTO, "Place Name": "Copy" })];
  const places = placesFromTable({ headers: PLACES_HEADERS, rows }, FALLBACK);

  assert.equal(places.length, 1);
  assert.equal(places[0].name, "Kyoto", "the first row wins");
});

test("a write never touches a column the script derives", () => {
  const fields = fieldsFromChanges({ name: "Osaka", latitude: 34.6937, longitude: 135.5023 });

  for (const derived of [
    "Created At", "Updated At", "Last Synced At", "Sync Version",
    "Coordinate Key", "Map URL", "Search Text",
  ]) {
    assert.ok(
      !(derived in fields),
      `${derived} is the script's to maintain and must not be sent from the browser`,
    );
  }
});

test("a write only names the fields that changed", () => {
  const fields = fieldsFromChanges({ notes: "New note" }, { id: "PL-0001", notes: "Old" });

  assert.deepEqual(Object.keys(fields), [COLUMNS.notes]);
  assert.equal(fields[COLUMNS.notes], "New note");
});

test("a new place gets the sheet's own spelling of Status", () => {
  const visited = fieldsFromChanges({
    name: "Kyoto", country: "Japan", latitude: 35, longitude: 135, visitedFrom: "2024-05-01",
  });
  assert.equal(visited[COLUMNS.status], STATUS_BEEN);

  const wishlist = fieldsFromChanges({
    name: "Lisbon", country: "Portugal", latitude: 38.7, longitude: -9.1,
  });
  assert.equal(wishlist[COLUMNS.status], STATUS_WANT_TO_GO);

  // "Yes"/"No", never true/false — matching what is already in the sheet.
  assert.equal(wishlist[COLUMNS.deleted], "No");
  assert.equal(wishlist[COLUMNS.archived], "No");
});

test("editing an existing place leaves its Status alone", () => {
  const fields = fieldsFromChanges({ name: "Kyoto" }, { id: "PL-0001", name: "Kyōto" });
  assert.ok(!(COLUMNS.status in fields), "a place marked 'Lived there' keeps that word");
});

test("a locally uploaded photo never reaches the sheet", () => {
  assert.equal(isRemotePhoto("photo:abc-123"), false);
  assert.equal(isRemotePhoto("https://example.com/a.jpg"), true);

  const local = fieldsFromChanges({ coverImage: "photo:abc-123" }, { id: "PL-0001" });
  assert.ok(
    !(COLUMNS.photoUrl in local),
    "a blob reference is meaningless on another device, so it stays out of the cell",
  );

  const link = fieldsFromChanges({ coverImage: "https://example.com/a.jpg" }, { id: "PL-0001" });
  assert.equal(link[COLUMNS.photoUrl], "https://example.com/a.jpg");

  const cleared = fieldsFromChanges(
    { coverImage: undefined },
    { id: "PL-0001", coverImage: "https://example.com/a.jpg" },
  );
  assert.equal(cleared[COLUMNS.photoUrl], "", "removing a link does clear the cell");
});

test("coordinates are written at the sheet's own precision", () => {
  const fields = fieldsFromChanges({ latitude: 35.0116, longitude: 135.7681 });
  assert.equal(fields[COLUMNS.latitude], "35.011600");
  assert.equal(fields[COLUMNS.longitude], "135.768100");
});

test("longitudes past the seam are wrapped rather than saved as-is", () => {
  const fields = fieldsFromChanges({ latitude: 0, longitude: 200 });
  assert.equal(fields[COLUMNS.longitude], "-160.000000");
});

const VISIT_HEADERS = [
  "Place ID", "Visit ID", "Trip ID", "Visit Status", "Start Date", "End Date",
  "Days", "Year", "Month", "Season", "Trip Type", "Companions",
];

test("two visits on one place fold into a single span", () => {
  const table = {
    headers: VISIT_HEADERS,
    rows: [
      row(VISIT_HEADERS, {
        "Place ID": "PL-0001", "Visit ID": "VIS-0001",
        "Start Date": "2024-04-01", "End Date": "2024-04-08",
      }),
      row(VISIT_HEADERS, {
        "Place ID": "PL-0001", "Visit ID": "VIS-0002",
        "Start Date": "2026-11-02", "End Date": "2026-11-09",
      }),
    ],
  };

  const spans = visitSpans(table);
  assert.deepEqual(spans.get("PL-0001"), { from: "2024-04-01", to: "2026-11-09" });

  const place = { id: "PL-0001", name: "Kyoto", country: "Japan", latitude: 35, longitude: 135,
    createdAt: FALLBACK, updatedAt: FALLBACK };
  const [folded] = applyVisitSpans([place], spans);

  assert.equal(folded.visitedFrom, "2024-04-01", "earliest start of any visit");
  assert.equal(folded.visitedTo, "2026-11-09", "latest end of any visit");
});

test("dates already on the Places row win over the visit rows", () => {
  // Places is the tab the app writes to. If a visit row could override it,
  // editing a date in the app would appear to do nothing.
  const spans = new Map([["PL-0001", { from: "2020-01-01", to: "2020-01-05" }]]);
  const place = { id: "PL-0001", name: "Kyoto", country: "Japan", latitude: 35, longitude: 135,
    visitedFrom: "2024-04-01", visitedTo: "2024-04-08", createdAt: FALLBACK, updatedAt: FALLBACK };

  const [kept] = applyVisitSpans([place], spans);
  assert.equal(kept.visitedFrom, "2024-04-01");
  assert.equal(kept.visitedTo, "2024-04-08");
});

test("header lookup ignores stray whitespace and duplicates", () => {
  const index = indexHeaders(["  Place ID  ", "Place Name", "Place Name"]);
  assert.equal(index.get("Place ID"), 0);
  assert.equal(index.get("Place Name"), 1, "the first of a duplicated header wins");
});


/* ---------------------------------------------------------------- *
 * Favorites, and the wishlist
 * ---------------------------------------------------------------- */

test("reads Favorite and Status as the two flags the app shows", () => {
  const rows = [
    row(PLACES_HEADERS, { ...KYOTO, Favorite: "Yes", Status: STATUS_BEEN }),
    row(PLACES_HEADERS, {
      ...KYOTO,
      "Place ID": "PL-0002",
      Favorite: "",
      Status: STATUS_WANT_TO_GO,
    }),
  ];
  const [been, wished] = placesFromTable({ headers: PLACES_HEADERS, rows }, FALLBACK);

  assert.equal(been.favorite, true);
  assert.equal(been.wantToGo, false);
  assert.equal(wished.favorite, false);
  assert.equal(wished.wantToGo, true);
});

test("every status but 'Want to go' means been, however it is spelled", () => {
  for (const status of ["Been", "Lived there", "Passed through", "Booked", ""]) {
    const cells = row(PLACES_HEADERS, { ...KYOTO, Status: status });
    const [place] = placesFromTable({ headers: PLACES_HEADERS, rows: [cells] }, FALLBACK);
    assert.equal(place.wantToGo, false, `"${status}" should not read as a wish`);
  }
  const typed = row(PLACES_HEADERS, { ...KYOTO, Status: "want to go" });
  const [place] = placesFromTable({ headers: PLACES_HEADERS, rows: [typed] }, FALLBACK);
  assert.equal(place.wantToGo, true, "a hand-typed status should still be recognised");
});

test("saving a favorite writes Yes, and clearing it writes No", () => {
  assert.equal(fieldsFromChanges({ favorite: true })[COLUMNS.favorite], "Yes");
  assert.equal(fieldsFromChanges({ favorite: false })[COLUMNS.favorite], "No");
  // Untouched means untouched: a save about something else leaves the cell.
  assert.equal(COLUMNS.favorite in fieldsFromChanges({ notes: "Rained" }), false);
});

test("a status the app has no screen for survives being saved over", () => {
  // The whole reason Status is compared before it is written. "Lived there"
  // is still been, so nothing about it changed, so nothing should be written.
  const lived = { ...KYOTO_RECORD, wantToGo: false };
  const fields = fieldsFromChanges({ notes: "Still love it", wantToGo: false }, lived);
  assert.equal(COLUMNS.status in fields, false);
});

test("moving a place to the wishlist and back writes the two canonical words", () => {
  const been = { ...KYOTO_RECORD, wantToGo: false };
  const wished = { ...KYOTO_RECORD, wantToGo: true };

  assert.equal(fieldsFromChanges({ wantToGo: true }, been)[COLUMNS.status], STATUS_WANT_TO_GO);
  assert.equal(fieldsFromChanges({ wantToGo: false }, wished)[COLUMNS.status], STATUS_BEEN);
});

test("a new place takes its status from the choice, not from whether a date was typed", () => {
  const wished = fieldsFromChanges({ ...NEW_INPUT, wantToGo: true, visitedFrom: undefined });
  assert.equal(wished[COLUMNS.status], STATUS_WANT_TO_GO);

  // A new place marked been, with no date yet, is still been — the old rule
  // would have filed it as a wish on the strength of an empty date field.
  const been = fieldsFromChanges({ ...NEW_INPUT, wantToGo: false, visitedFrom: undefined });
  assert.equal(been[COLUMNS.status], STATUS_BEEN);
});

test("the Google listing id is read, written, cleared, and otherwise left alone", () => {
  const cells = row(PLACES_HEADERS, { ...KYOTO, "Google Place ID": "ChIJmock0004" });
  const [place] = placesFromTable({ headers: PLACES_HEADERS, rows: [cells] }, FALLBACK);
  assert.equal(place.googlePlaceId, "ChIJmock0004");

  // A row from before the app wrote this column simply has no listing.
  const [bare] = placesFromTable(
    { headers: PLACES_HEADERS, rows: [row(PLACES_HEADERS, KYOTO)] },
    FALLBACK,
  );
  assert.equal(bare.googlePlaceId, undefined);

  // Saving an id lands it in its column; re-anchoring the place somewhere
  // Google didn't answer for clears the cell rather than leaving a stale
  // listing behind; an edit that never mentions it leaves the cell alone.
  assert.equal(
    fieldsFromChanges({ googlePlaceId: "ChIJmock0004" }, KYOTO_RECORD)[COLUMNS.googlePlaceId],
    "ChIJmock0004",
  );
  assert.equal(
    fieldsFromChanges({ googlePlaceId: undefined }, KYOTO_RECORD)[COLUMNS.googlePlaceId],
    "",
  );
  assert.equal(
    COLUMNS.googlePlaceId in fieldsFromChanges({ notes: "unrelated" }, KYOTO_RECORD),
    false,
  );
});

if (failures > 0) {
  console.error(`\n${failures} mapping test(s) failed.`);
  process.exit(1);
}
console.log("  all mapping tests passed\n");
