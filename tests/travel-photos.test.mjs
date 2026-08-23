/**
 * Travel photos: the Travel_Photos rows as records, the date-aware review,
 * deduplication by Google Photos item id, and the association rules that
 * keep a photo from landing on the wrong visit.
 *
 * The silent failures this guards against: a temporary Google baseUrl
 * persisted as if it were durable; a photo attached to a visit that does not
 * exist; a duplicate import quietly doubling Drive storage; an outside-date
 * photo silently discarded instead of flagged; the media endpoint accepting
 * anything beyond a photo id.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  TRAVEL_PHOTO_COLUMNS,
  travelPhotosFromTable,
} = await import("../lib/sheets/mapping.ts");
const {
  isVideoTravelPhoto,
  isWithinDates,
  photosForPlace,
  photosForTrip,
  photosForTripOnly,
  photosForVisit,
  reviewCounts,
  reviewSelection,
  sortTravelPhotos,
  suggestVisitForPhoto,
  takenOnDate,
  validateAssociation,
} = await import("../lib/photos/travelPhotos.ts");
const { cacheKey, cacheKeyPrefix } = await import("../lib/storage/cloudPhotoCache.ts");
const { travelPhotoRequestParams } = await import("../lib/sheets/sheetsClient.ts");

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

console.log("travel photos");

/* ------------------------------------------------------------------ *
 * Fixtures, built by header name — never by position.
 * ------------------------------------------------------------------ */

const HEADERS = [
  "Photo ID", "Google Photos Item ID", "Place ID", "Visit ID", "Trip ID",
  "Taken At", "Filename", "MIME Type", "Width", "Height",
  "Thumb Drive File ID", "Display Drive File ID", "Video Drive File ID",
  "Source", "Sort Order", "Created At", "Updated At", "Archived?", "Deleted?",
];

function row(values) {
  const out = new Array(HEADERS.length).fill("");
  for (const [header, value] of Object.entries(values)) {
    const at = HEADERS.indexOf(header);
    assert.notEqual(at, -1, `fixture uses unknown column "${header}"`);
    out[at] = value;
  }
  return out;
}

const NOW = "2026-01-01T00:00:00.000Z";

function photo(extra = {}) {
  return {
    id: "TPHOTO-0001",
    source: "google-photos",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function visit(extra = {}) {
  return { id: "VIS-0001", placeId: "PL-0001", createdAt: NOW, updatedAt: NOW, ...extra };
}

/* ------------------------------------------------------------------ *
 * Reading Travel_Photos
 * ------------------------------------------------------------------ */

test("photos are read by header name, association ids intact", () => {
  const table = {
    headers: HEADERS,
    rows: [
      row({
        "Photo ID": "TPHOTO-0001", "Google Photos Item ID": "gp-abc",
        "Place ID": "PL-0001", "Visit ID": "VIS-0002", "Trip ID": "TRIP-0003",
        "Taken At": "2024-02-08T14:00:00Z", "Filename": "ski.jpg",
        "MIME Type": "image/jpeg", "Width": "4000", "Height": "3000",
        "Thumb Drive File ID": "drv-thumb", "Display Drive File ID": "drv-display",
        "Source": "google-photos", "Sort Order": "2",
      }),
    ],
  };
  const [record] = travelPhotosFromTable(table, NOW);
  assert.equal(record.id, "TPHOTO-0001");
  assert.equal(record.googlePhotosItemId, "gp-abc");
  assert.equal(record.placeId, "PL-0001");
  assert.equal(record.visitId, "VIS-0002");
  assert.equal(record.tripId, "TRIP-0003");
  assert.equal(record.takenAt, "2024-02-08T14:00:00Z");
  assert.equal(record.thumbDriveFileId, "drv-thumb");
  assert.equal(record.displayDriveFileId, "drv-display");
  assert.equal(record.width, 4000);
  assert.equal(record.sortOrder, 2);
});

test("a soft-deleted photo carries its tombstone; duplicates keep the first", () => {
  const table = {
    headers: HEADERS,
    rows: [
      row({ "Photo ID": "TPHOTO-0001", "Deleted?": "Yes" }),
      row({ "Photo ID": "TPHOTO-0002", "Filename": "keep.jpg" }),
      row({ "Photo ID": "TPHOTO-0002", "Filename": "shadow.jpg" }),
    ],
  };
  const records = travelPhotosFromTable(table, NOW);
  assert.equal(records.length, 2);
  assert.ok(records[0].deletedAt, "Deleted? Yes must become deletedAt");
  assert.equal(records[1].filename, "keep.jpg");
});

test("an absent tab reads as no photos, not a failure", () => {
  assert.deepEqual(travelPhotosFromTable(undefined, NOW), []);
});

test("a video row knows it is one", () => {
  const table = {
    headers: HEADERS,
    rows: [
      row({ "Photo ID": "TPHOTO-0001", "MIME Type": "video/mp4", "Video Drive File ID": "drv-vid" }),
      row({ "Photo ID": "TPHOTO-0002", "MIME Type": "image/jpeg" }),
    ],
  };
  const [video, still] = travelPhotosFromTable(table, NOW);
  assert.equal(video.videoDriveFileId, "drv-vid");
  assert.ok(isVideoTravelPhoto(video));
  assert.ok(!isVideoTravelPhoto(still));
});

test("no column exists for a temporary Google baseUrl", () => {
  // The whole durability model rests on never persisting the temporary URL.
  for (const column of Object.values(TRAVEL_PHOTO_COLUMNS)) {
    assert.ok(!/base\s*url/i.test(column), `column "${column}" smells like a baseUrl`);
  }
  assert.equal("baseUrl" in TRAVEL_PHOTO_COLUMNS, false);
});

/* ------------------------------------------------------------------ *
 * Dates: guidance, never a rejection rule
 * ------------------------------------------------------------------ */

test("the capture day comes off the timestamp's own digits", () => {
  assert.equal(takenOnDate("2024-02-08T23:59:59Z"), "2024-02-08");
  assert.equal(takenOnDate("2024-02-08"), "2024-02-08");
  assert.equal(takenOnDate(undefined), null);
  assert.equal(takenOnDate("not a date"), null);
});

test("date range is inclusive at both ends", () => {
  assert.ok(isWithinDates("2024-02-07T08:00:00Z", "2024-02-07", "2024-02-10"), "first day counts");
  assert.ok(isWithinDates("2024-02-10T23:00:00Z", "2024-02-07", "2024-02-10"), "last day counts");
  assert.ok(!isWithinDates("2024-02-06T23:59:00Z", "2024-02-07", "2024-02-10"));
  assert.ok(!isWithinDates("2024-02-11T00:01:00Z", "2024-02-07", "2024-02-10"));
});

test("a missing end date means the start date alone; no dates means nothing is outside", () => {
  assert.ok(isWithinDates("2024-02-07T12:00:00Z", "2024-02-07", undefined));
  assert.ok(!isWithinDates("2024-02-08T12:00:00Z", "2024-02-07", undefined));
  assert.ok(isWithinDates("2024-02-08T12:00:00Z", undefined, undefined));
  assert.ok(isWithinDates(undefined, "2024-02-07", "2024-02-10"), "undated photo is never flagged");
});

/* ------------------------------------------------------------------ *
 * Review: flagged, selected, never silently discarded
 * ------------------------------------------------------------------ */

const CONTEXT = { visitId: "VIS-0002", placeId: "PL-0001", startDate: "2024-02-07", endDate: "2024-02-10" };

test("outside-date photos are flagged but stay in the selection", () => {
  const reviewed = reviewSelection(
    [
      { id: "a", createTime: "2024-02-08T10:00:00Z", type: "PHOTO" },
      { id: "b", createTime: "2019-06-20T10:00:00Z", type: "PHOTO" },
    ],
    CONTEXT,
    [],
  );
  assert.equal(reviewed.length, 2, "nothing is dropped");
  assert.equal(reviewed[0].withinDates, true);
  assert.equal(reviewed[1].withinDates, false);
  const counts = reviewCounts(reviewed);
  assert.equal(counts.within, 1);
  assert.equal(counts.outside, 1);
});

test("the Google Photos item id is what deduplication runs on", () => {
  const existing = [
    photo({ id: "TPHOTO-0001", googlePhotosItemId: "gp-same", visitId: "VIS-0002" }),
    photo({ id: "TPHOTO-0002", googlePhotosItemId: "gp-elsewhere", visitId: "VIS-0009" }),
  ];
  const reviewed = reviewSelection(
    [
      { id: "gp-same", type: "PHOTO", createTime: "2024-02-08T10:00:00Z" },
      { id: "gp-elsewhere", type: "PHOTO", createTime: "2024-02-08T10:00:00Z" },
      { id: "gp-new", type: "PHOTO", createTime: "2024-02-08T10:00:00Z" },
    ],
    CONTEXT,
    existing,
  );
  assert.equal(reviewed[0].duplicate, "sameContext");
  assert.equal(reviewed[1].duplicate, "elsewhere");
  assert.equal(reviewed[2].duplicate, "none");
});

test("a deleted twin does not block re-import", () => {
  const reviewed = reviewSelection(
    [{ id: "gp-back", type: "PHOTO" }],
    CONTEXT,
    [photo({ googlePhotosItemId: "gp-back", visitId: "VIS-0002", deletedAt: NOW })],
  );
  assert.equal(reviewed[0].duplicate, "none");
});

test("videos are marked and counted, not excluded", () => {
  const reviewed = reviewSelection(
    [{ id: "v", type: "VIDEO", createTime: "2024-02-08T10:00:00Z" }],
    CONTEXT,
    [],
  );
  assert.equal(reviewed[0].isVideo, true);
  const counts = reviewCounts(reviewed);
  assert.equal(counts.videos, 1);
  assert.equal(counts.within, 1, "a video inside the dates still counts as within");
});

/* ------------------------------------------------------------------ *
 * Associations: validated, never trusted
 * ------------------------------------------------------------------ */

test("a photo must attach to something", () => {
  assert.equal(validateAssociation({}, []), "noAssociation");
});

test("the visit must exist and be alive", () => {
  assert.equal(validateAssociation({ visitId: "VIS-9999" }, [visit()]), "missingVisit");
  assert.equal(
    validateAssociation({ visitId: "VIS-0001" }, [visit({ deletedAt: NOW })]),
    "deletedVisit",
  );
});

test("the visit's place and trip must agree with the request", () => {
  const visits = [visit({ tripId: "TRIP-0001" })];
  assert.equal(
    validateAssociation({ visitId: "VIS-0001", placeId: "PL-0002" }, visits),
    "placeMismatch",
  );
  assert.equal(
    validateAssociation({ visitId: "VIS-0001", tripId: "TRIP-0009" }, visits),
    "tripMismatch",
  );
  assert.equal(
    validateAssociation({ visitId: "VIS-0001", placeId: "PL-0001", tripId: "TRIP-0001" }, visits),
    null,
  );
});

/* ------------------------------------------------------------------ *
 * Gallery slicing
 * ------------------------------------------------------------------ */

const LIBRARY = [
  photo({ id: "P1", placeId: "PL-1", visitId: "V1", tripId: "T1", takenAt: "2024-02-08T10:00:00Z" }),
  photo({ id: "P2", placeId: "PL-1", visitId: "V2", takenAt: "2019-06-20T10:00:00Z" }),
  photo({ id: "P3", tripId: "T1", takenAt: "2024-02-07T10:00:00Z" }),
  photo({ id: "P4", placeId: "PL-1", visitId: "V1", deletedAt: NOW }),
];

test("a visit's gallery holds exactly its own live photos", () => {
  assert.deepEqual(photosForVisit(LIBRARY, "V1").map((p) => p.id), ["P1"]);
  assert.deepEqual(photosForVisit(LIBRARY, "V2").map((p) => p.id), ["P2"]);
});

test("a trip's gallery holds trip-only and member-visit photos, oldest first", () => {
  assert.deepEqual(photosForTrip(LIBRARY, "T1").map((p) => p.id), ["P3", "P1"]);
  assert.deepEqual(photosForTripOnly(LIBRARY, "T1").map((p) => p.id), ["P3"]);
});

test("a place's all-photos gallery spans its visits, chronological", () => {
  assert.deepEqual(photosForPlace(LIBRARY, "PL-1").map((p) => p.id), ["P2", "P1"]);
});

test("sort order wins over capture time when someone has set one", () => {
  const sorted = sortTravelPhotos([
    photo({ id: "late", takenAt: "2024-01-02T00:00:00Z", sortOrder: 1 }),
    photo({ id: "early", takenAt: "2024-01-01T00:00:00Z" }),
  ]);
  assert.deepEqual(sorted.map((p) => p.id), ["late", "early"]);
});

/* ------------------------------------------------------------------ *
 * Suggesting a visit for trip-level photos
 * ------------------------------------------------------------------ */

test("a date inside exactly one visit names that visit", () => {
  const visits = [
    visit({ id: "V1", startDate: "2024-02-07", endDate: "2024-02-10" }),
    visit({ id: "V2", startDate: "2024-02-12", endDate: "2024-02-14" }),
  ];
  const match = suggestVisitForPhoto({ createTime: "2024-02-08T10:00:00Z" }, visits);
  assert.equal(match?.id, "V1");
});

test("overlapping visits and undated photos suggest nothing", () => {
  const overlapping = [
    visit({ id: "V1", startDate: "2024-02-07", endDate: "2024-02-10" }),
    visit({ id: "V2", startDate: "2024-02-08", endDate: "2024-02-09" }),
  ];
  assert.equal(suggestVisitForPhoto({ createTime: "2024-02-08T10:00:00Z" }, overlapping), null);
  assert.equal(suggestVisitForPhoto({ createTime: undefined }, overlapping), null);
  assert.equal(suggestVisitForPhoto({ createTime: "2024-03-01T10:00:00Z" }, overlapping), null);
});

/* ------------------------------------------------------------------ *
 * The cache key and the request surface
 * ------------------------------------------------------------------ */

test("cache keys carry id, size and version, so an edit re-fetches", () => {
  assert.equal(cacheKey("TPHOTO-1", "thumb", "2026-01-01"), "TPHOTO-1|thumb|2026-01-01");
  assert.notEqual(cacheKey("TPHOTO-1", "thumb", "v1"), cacheKey("TPHOTO-1", "thumb", "v2"));
  assert.notEqual(cacheKey("TPHOTO-1", "thumb", "v1"), cacheKey("TPHOTO-1", "display", "v1"));
  assert.equal(cacheKey("TPHOTO-1", "thumb", ""), "TPHOTO-1|thumb|0");
  assert.ok(cacheKey("TPHOTO-1", "thumb", "v1").startsWith(cacheKeyPrefix("TPHOTO-1", "thumb")));
});

test("the photo request can only ever name a photo id — never a Drive file", () => {
  const params = travelPhotoRequestParams("TPHOTO-0001", "display", "secret");
  assert.deepEqual(Object.keys(params).sort(), ["action", "media", "photoId", "size"]);
  assert.equal(params.photoId, "TPHOTO-0001");
  // An unknown size collapses to thumb rather than passing through.
  assert.equal(travelPhotoRequestParams("x", "original", "s").size, "thumb");
});

if (failures > 0) {
  console.error(`\n${failures} travel photo test(s) failed.`);
  process.exit(1);
}
console.log("  all travel photo tests passed\n");
