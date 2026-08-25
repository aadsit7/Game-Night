/**
 * Exercises the card's Google Maps section: the payload shaped for display,
 * and the matcher that links old places to their listings.
 *
 * The failures worth catching are quiet and wrong rather than loud: today's
 * hours picked for the phone's weekday instead of the place's, a rating of 0
 * drawn as a real score, and — worst — an old place auto-linked to somebody
 * else's listing, which would send every link on its card to the wrong spot.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { toGooglePlaceDetails, todaysHoursLine, placeWeekdayIndex, localTimeAt, pickGoogleListing } =
  await import("../lib/maps/placeDetails.ts");
const { groupPlacesByCountry } = await import("../lib/places/grouping.ts");

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

console.log("place details");

/* ---------------------------------------------------------------- *
 * Shaping the payload
 * ---------------------------------------------------------------- */

const EIFFEL = {
  id: "ChIJLU7jZClu5kcR4PcOOO6p3I0",
  displayName: { text: "Eiffel Tower", languageCode: "en" },
  primaryTypeDisplayName: { text: "Historical Landmark", languageCode: "en" },
  businessStatus: "OPERATIONAL",
  shortFormattedAddress: "Av. Gustave Eiffel, Paris",
  rating: 4.7,
  userRatingCount: 412381,
  currentOpeningHours: {
    openNow: true,
    weekdayDescriptions: [
      "Monday: 9:30 AM – 11:00 PM", "Tuesday: 9:30 AM – 11:00 PM", "Wednesday: 9:30 AM – 11:00 PM",
      "Thursday: 9:30 AM – 11:00 PM", "Friday: 9:30 AM – 11:00 PM", "Saturday: 9:30 AM – 10:00 PM",
      "Sunday: 9:30 AM – 11:00 PM",
    ],
  },
  websiteUri: "https://www.toureiffel.paris/",
  internationalPhoneNumber: "+33 892 70 12 39",
  utcOffsetMinutes: 120,
};

test("a full payload becomes exactly what the card draws", () => {
  // A Wednesday everywhere on Earth, so "today" is unambiguous.
  const details = toGooglePlaceDetails(EIFFEL, new Date("2026-08-26T12:00:00Z"));
  assert.equal(details.name, "Eiffel Tower");
  assert.equal(details.kind, "Historical Landmark");
  assert.equal(details.rating, 4.7);
  assert.equal(details.ratingCount, 412381);
  assert.equal(details.openNow, true);
  assert.equal(details.todaysHours, "9:30 AM – 11:00 PM");
  assert.equal(details.address, "Av. Gustave Eiffel, Paris");
  assert.equal(details.website, "https://www.toureiffel.paris/");
  assert.equal(details.phone, "+33 892 70 12 39");
  assert.equal(details.permanentlyClosed, undefined);
});

test("a sparse locality still reads as an answer, not a failure", () => {
  const details = toGooglePlaceDetails({ id: "ChIJx", shortFormattedAddress: "Kyoto, Japan" });
  assert.equal(details.id, "ChIJx");
  assert.equal(details.address, "Kyoto, Japan");
  assert.equal(details.rating, undefined);
  assert.equal(details.openNow, undefined);
  assert.equal(details.todaysHours, undefined);
});

test("what cannot be drawn is dropped rather than drawn wrong", () => {
  // Google uses 0 for "unrated"; a card showing ★ 0.0 would be a lie.
  assert.equal(toGooglePlaceDetails({ id: "x", rating: 0 }).rating, undefined);
  assert.equal(toGooglePlaceDetails({ id: "x", rating: 11 }).rating, undefined);
  assert.equal(toGooglePlaceDetails({ id: "  " }), null);
  assert.equal(toGooglePlaceDetails(null), null);
  assert.equal(toGooglePlaceDetails("nonsense"), null);
});

test("the Google Maps staples come through: price, access, the one-liner", () => {
  const details = toGooglePlaceDetails({
    id: "x",
    priceLevel: "PRICE_LEVEL_MODERATE",
    accessibilityOptions: { wheelchairAccessibleEntrance: true },
    editorialSummary: { text: "An iconic tower.", languageCode: "en" },
    googleMapsUri: "https://maps.google.com/?cid=3",
  });
  assert.equal(details.priceLabel, "$$");
  assert.equal(details.wheelchairEntrance, true);
  assert.equal(details.summary, "An iconic tower.");
  assert.equal(details.googleMapsUri, "https://maps.google.com/?cid=3");

  // Unspecified and free stay unlabelled — a museum with no admission is not
  // a "free" restaurant; an inaccessible entrance is silence, not a claim.
  const bare = toGooglePlaceDetails({
    id: "x",
    priceLevel: "PRICE_LEVEL_UNSPECIFIED",
    accessibilityOptions: { wheelchairAccessibleEntrance: false },
  });
  assert.equal(bare.priceLabel, undefined);
  assert.equal(bare.wheelchairEntrance, undefined);
});

test("reviews are credited, capped, and never invented", () => {
  const review = (author, text, rating) => ({
    rating,
    text: { text },
    relativePublishTimeDescription: "a week ago",
    authorAttribution: { displayName: author, uri: `https://maps/${author}`, photoUri: "" },
  });

  const details = toGooglePlaceDetails({
    id: "x",
    reviews: [
      review("Amélie", "Lovely at sunset.", 5),
      // No author: the display policies want attribution, so it cannot show.
      { rating: 5, text: { text: "anon" }, authorAttribution: {} },
      // Stars alone still say something.
      review("Marco", undefined, 4),
      review("Ana", "Great.", 5),
      review("Kim", "Fine.", 3),
    ],
  });

  assert.deepEqual(
    details.reviews.map((entry) => entry.author),
    ["Amélie", "Marco", "Ana"],
    "capped at three, the uncredited one skipped",
  );
  assert.equal(details.reviews[0].text, "Lovely at sunset.");
  assert.equal(details.reviews[0].when, "a week ago");
  assert.equal(details.reviews[0].authorUri, "https://maps/Amélie");

  // No reviews at all is `undefined`, so the card renders nothing.
  assert.equal(toGooglePlaceDetails({ id: "x", reviews: [] }).reviews, undefined);
});

test("permanently closed survives the trip through", () => {
  const details = toGooglePlaceDetails({ id: "x", businessStatus: "CLOSED_PERMANENTLY" });
  assert.equal(details.permanentlyClosed, true);
  const paused = toGooglePlaceDetails({ id: "x", businessStatus: "CLOSED_TEMPORARILY" });
  assert.equal(paused.temporarilyClosed, true);
});

test("the week's hours come through whole, or not at all", () => {
  const details = toGooglePlaceDetails(EIFFEL);
  assert.equal(details.weekHours.length, 7);
  assert.equal(details.weekHours[0], "Monday: 9:30 AM – 11:00 PM");

  // A partial week cannot say which line is Sunday, so none are kept.
  const partial = toGooglePlaceDetails({
    id: "x",
    currentOpeningHours: { weekdayDescriptions: ["Monday: 1"] },
  });
  assert.equal(partial.weekHours, undefined);
});

test("the lead photo arrives as a name and a credit, never a URL", () => {
  const details = toGooglePlaceDetails({
    id: "x",
    photos: [
      {
        name: "places/x/photos/p1",
        authorAttributions: [{ displayName: "Hana S.", uri: "https://maps/hana" }],
      },
      { name: "places/x/photos/p2" },
    ],
  });
  assert.equal(details.photoName, "places/x/photos/p1");
  assert.equal(details.photoBy, "Hana S.");
  assert.equal(details.photoByUri, "https://maps/hana");

  // No photos, or an entry with no name to fetch by, is simply no hero.
  assert.equal(toGooglePlaceDetails({ id: "x" }).photoName, undefined);
  assert.equal(toGooglePlaceDetails({ id: "x", photos: [{}] }).photoName, undefined);
  // An uncredited photo still shows; the credit is only owed when given.
  const bare = toGooglePlaceDetails({ id: "x", photos: [{ name: "places/x/photos/p3" }] });
  assert.equal(bare.photoName, "places/x/photos/p3");
  assert.equal(bare.photoBy, undefined);
});

/* ---------------------------------------------------------------- *
 * Today, at the place
 * ---------------------------------------------------------------- */

const WEEK = [
  "Monday: closed", "Tuesday: 1", "Wednesday: 2", "Thursday: 3",
  "Friday: 4", "Saturday: 5", "Sunday: 6",
];

test("today's hours are the place's today, not the phone's", () => {
  // 23:30 UTC Monday; Tokyo (+540) is already 8:30 AM Tuesday.
  const mondayNight = new Date("2026-08-24T23:30:00Z");
  assert.equal(todaysHoursLine(WEEK, 540, mondayNight), "1");
  // While somewhere at UTC−7 is still mid-Monday afternoon.
  assert.equal(todaysHoursLine(WEEK, -420, mondayNight), "closed");
});

test("the week row a card should embolden is the place's weekday", () => {
  // 23:30 UTC Monday: Tokyo is Tuesday (row 1), UTC−7 still Monday (row 0).
  const mondayNight = new Date("2026-08-24T23:30:00Z");
  assert.equal(placeWeekdayIndex(540, mondayNight), 1);
  assert.equal(placeWeekdayIndex(-420, mondayNight), 0);
  // Sunday closes the Monday-first week at row 6.
  assert.equal(placeWeekdayIndex(0, new Date("2026-08-30T12:00:00Z")), 6);
});

test("hours that aren't a week's worth are not guessed at", () => {
  assert.equal(todaysHoursLine(["Monday: 1"], 0, new Date()), undefined);
  assert.equal(todaysHoursLine(undefined, 0, new Date()), undefined);
});

test("the local time line follows the offset", () => {
  const noonUTC = new Date("2026-08-26T12:00:00Z");
  // +120 minutes → 2 PM, whatever timezone the test machine sits in.
  assert.match(localTimeAt(120, noonUTC), /2:00/);
  assert.match(localTimeAt(-570, noonUTC), /2:30/);
});

/* ---------------------------------------------------------------- *
 * Linking old places to listings
 * ---------------------------------------------------------------- */

/** ~0.00027° of latitude is ~30 m; the fixtures speak in metres via this. */
const DEG_PER_METER = 1 / 111_320;

const SAVED = { name: "Sagrada Família", latitude: 41.4036, longitude: 2.1744 };

function resultAt(meters, name, id) {
  return {
    id: id ?? "row",
    name,
    context: "",
    latitude: SAVED.latitude + meters * DEG_PER_METER,
    longitude: SAVED.longitude,
    googlePlaceId: id,
  };
}

test("the same rooftop matches whatever it is called", () => {
  const results = [resultAt(25, "Basílica de la Sagrada Família", "ChIJgood")];
  assert.equal(pickGoogleListing(SAVED, results), "ChIJgood");
});

test("an agreeing name matches from across the block, a stranger does not", () => {
  assert.equal(
    pickGoogleListing(SAVED, [resultAt(200, "Basilica de la Sagrada Familia", "ChIJnear")]),
    "ChIJnear",
  );
  // 200 m away with a different name: plausibly a neighbour, never a match.
  assert.equal(pickGoogleListing(SAVED, [resultAt(200, "Gaudí Museum", "ChIJother")]), null);
});

test("distance always has a vote — an agreeing name far away is a different branch", () => {
  assert.equal(
    pickGoogleListing(SAVED, [resultAt(5000, "Sagrada Família", "ChIJfar")]),
    null,
  );
});

test("results without listing ids are passed over, and rank breaks ties", () => {
  const results = [
    resultAt(10, "Sagrada Família", undefined),
    resultAt(30, "Sagrada Família", "ChIJsecond"),
    resultAt(20, "Sagrada Família", "ChIJthird"),
  ];
  assert.equal(pickGoogleListing(SAVED, results), "ChIJsecond");
});

/* ---------------------------------------------------------------- *
 * The collection, a country at a time
 * ---------------------------------------------------------------- */

function place(name, country, countryCode) {
  return { id: name, name, country, countryCode, latitude: 0, longitude: 0 };
}

test("countries become sections in the order they arrive", () => {
  const groups = groupPlacesByCountry([
    place("Kyoto", "Japan", "JP"),
    place("Osaka", "Japan", "JP"),
    place("Lisbon", "Portugal", "PT"),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.label, group.places.length]),
    [["Japan", 2], ["Portugal", 1]],
  );
  assert.equal(groups[0].code, "JP");
});

test("a row missing its code cannot split its country in two", () => {
  const groups = groupPlacesByCountry([
    place("Kyoto", "Japan", "JP"),
    { ...place("Nara", "jp", undefined), country: "jp", countryCode: "jp" },
  ]);
  // Same key ("jp") either way the row spells itself.
  assert.equal(groups.length, 1);
  assert.equal(groups[0].places.length, 2);
});

test("a country-less row gets an honest heading of its own", () => {
  const groups = groupPlacesByCountry([place("Somewhere", "", undefined)]);
  assert.equal(groups[0].label, "No country");
});

process.exit(failures === 0 ? 0 : 1);
