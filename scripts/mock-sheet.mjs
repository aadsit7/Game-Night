/**
 * A stand-in for the Apps Script web app, for local development.
 *
 * The app reads everything from a Google Sheet, so `npm run dev` on its own
 * has nothing to show. This serves the same protocol `apps-script/Code.gs`
 * does — same actions, same JSON envelope, same derived columns, same
 * 78-column Places header — against an in-memory fixture, so the whole app can
 * be exercised without deploying anything to Google or touching real data.
 *
 *   npm run mock-sheet
 *
 * Then open the app and connect it to http://localhost:8787/ with the access
 * code below. State lives in memory only and resets when this process does.
 *
 * Deliberately *not* a test double for Code.gs: it mirrors that file's
 * behaviour, and if the two ever disagree, Code.gs is the one that is right.
 */
import { createServer } from "node:http";

const PORT = 8787;
const ACCESS_CODE = "2dHoDYeD-XLTSecCG-qcZVCM5d";

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

const VISIT_HEADERS = [
  "Place ID", "Visit ID", "Trip ID", "Visit Status", "Start Date", "End Date",
  "Days", "Year", "Month", "Season", "Trip Type", "Companions",
  "Accommodation Name", "Accommodation URL", "Booking Reference", "Transport Notes",
  "Highlights", "Lessons Learned", "Weather Summary", "Budget Estimate",
  "Actual Cost", "Currency",
  // Appended by ensureBookkeepingColumns_ in Code.gs, so writes and soft
  // deletes work on this tab the same way they do everywhere else.
  "Created At", "Updated At", "Last Synced At", "Sync Version", "Archived?", "Deleted?",
];

const MEDIA_HEADERS = [
  "Media ID", "Place ID", "Visit ID", "Media Type", "Title", "URL", "File Name",
  "Caption", "Taken Date", "Credit / Creator", "License / Permission", "Favorite?",
  "Created At", "Updated At",
  // Appended by ensureBookkeepingColumns_ in Code.gs, as above.
  "Last Synced At", "Sync Version", "Archived?", "Deleted?",
];

/**
 * The Trips tab, exactly as `ensureTripsTab_` in Code.gs creates it. Header
 * text and order both matter: the app addresses every column by name.
 */
const TRIP_HEADERS = [
  "Trip ID", "Trip Name", "Start Date", "End Date", "Description", "Cover Place ID",
  "Created At", "Updated At", "Last Synced At", "Sync Version", "Archived?", "Deleted?",
];

/** Travel_Photos, exactly as `ensureTravelPhotosTab_` in Code.gs creates it. */
const TRAVEL_PHOTO_HEADERS = [
  "Photo ID", "Google Photos Item ID", "Place ID", "Visit ID", "Trip ID",
  "Taken At", "Filename", "MIME Type", "Width", "Height",
  "Thumb Drive File ID", "Display Drive File ID", "Video Drive File ID",
  "Source", "Sort Order",
  "Created At", "Updated At", "Last Synced At", "Sync Version", "Archived?", "Deleted?",
];

const LOOKUPS = {
  Status: ["Been", "Want to go", "Planned", "Considering", "Booked", "Lived there", "Passed through", "Avoid", "Not interested"],
  Favorite: ["Yes", "No"],
  Priority: ["1 - Dream", "2 - High", "3 - Medium", "4 - Low", "5 - Someday"],
  "Place Type": ["Country", "Region/State", "City", "Neighborhood", "Landmark", "Restaurant", "Cafe", "Bar", "Hotel", "Museum", "Beach", "Park", "Hike", "Viewpoint", "Shopping", "Event venue"],
  "Trip Type": ["Solo", "Couple", "Family", "Friends", "Work", "Work + leisure", "Group tour", "Study", "Relocation scouting"],
  "Budget Tier": ["Free", "$", "$$", "$$$", "$$$$", "Luxury"],
  Season: ["Spring", "Summer", "Autumn/Fall", "Winter", "Dry season", "Rainy season", "Any"],
  Safety: ["Very safe", "Generally safe", "Use caution", "High caution", "Avoid"],
  Accessibility: ["Unknown", "Excellent", "Good", "Limited", "Difficult"],
  Currency: ["USD", "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "CNY", "KRW", "SGD", "THB", "MXN", "BRL", "INR", "Other"],
};

const index = (headers) => {
  const map = {};
  headers.forEach((h, i) => { if (h && map[h] === undefined) map[h] = i; });
  return map;
};
const PI = index(PLACES_HEADERS);
const TI = index(TRIP_HEADERS);

function blank(headers) { return new Array(headers.length).fill(""); }

function makePlace(values) {
  const row = blank(PLACES_HEADERS);
  for (const [header, value] of Object.entries(values)) row[PI[header]] = value;
  return row;
}

/** Seeded to look like a real travel history, spread across the globe. */
const places = [
  makePlace({ "Place ID": "PL-0001", "Place Name": "Kyoto", "Status": "Been", "Country": "Japan", "Country Code": "JP", "Region / State": "Kansai", "City": "Kyoto", "Latitude": "35.011600", "Longitude": "135.768100", "First Visited Date": "2024-03-25", "Last Visited Date": "2024-04-02", "Personal Notes": "Fushimi Inari at dawn was the whole trip.", "Photo URL": "", "Created At": "2024-04-10", "Updated At": "2024-04-10", "Sync Version": 1, "Archived?": "No", "Deleted?": "No", "Place Type": "City" }),
  makePlace({ "Place ID": "PL-0002", "Place Name": "Lisbon", "Status": "Been", "Country": "Portugal", "Country Code": "PT", "City": "Lisbon", "Latitude": "38.722300", "Longitude": "-9.139300", "First Visited Date": "2023-09-12", "Last Visited Date": "2023-09-19", "Personal Notes": "Tram 28, pastéis, and far too many hills.", "Created At": "2023-09-25", "Updated At": "2023-09-25", "Sync Version": 1, "Archived?": "No", "Deleted?": "No", "Place Type": "City" }),
  makePlace({ "Place ID": "PL-0003", "Place Name": "Reykjavík", "Status": "Been", "Country": "Iceland", "Country Code": "IS", "City": "Reykjavík", "Latitude": "64.146600", "Longitude": "-21.942600", "First Visited Date": "2022-11-03", "Last Visited Date": "2022-11-09", "Personal Notes": "Saw the aurora on the last night.", "Created At": "2022-11-15", "Updated At": "2022-11-15", "Sync Version": 1, "Archived?": "No", "Deleted?": "No", "Place Type": "City" }),
  makePlace({ "Place ID": "PL-0004", "Place Name": "Queenstown", "Status": "Been", "Country": "New Zealand", "Country Code": "NZ", "Region / State": "Otago", "City": "Queenstown", "Latitude": "-45.031200", "Longitude": "168.662600", "First Visited Date": "2019-02-02", "Last Visited Date": "2019-02-14", "Personal Notes": "Routeburn track. Would go back tomorrow.", "Created At": "2019-03-01", "Updated At": "2019-03-01", "Sync Version": 1, "Archived?": "No", "Deleted?": "No", "Place Type": "City" }),
  makePlace({ "Place ID": "PL-0005", "Place Name": "Marrakesh", "Status": "Been", "Country": "Morocco", "Country Code": "MA", "City": "Marrakesh", "Latitude": "31.629600", "Longitude": "-7.981000", "First Visited Date": "2018-10-05", "Last Visited Date": "2018-10-12", "Personal Notes": "Jemaa el-Fnaa after dark.", "Created At": "2018-10-20", "Updated At": "2018-10-20", "Sync Version": 1, "Archived?": "No", "Deleted?": "No", "Place Type": "City" }),
  makePlace({ "Place ID": "PL-0006", "Place Name": "Banff", "Status": "Been", "Country": "Canada", "Country Code": "CA", "Region / State": "Alberta", "City": "Banff", "Latitude": "51.178300", "Longitude": "-115.570800", "First Visited Date": "2021-07-18", "Last Visited Date": "2021-07-25", "Personal Notes": "Moraine Lake is worth the 5am alarm.", "Created At": "2021-08-02", "Updated At": "2021-08-02", "Sync Version": 1, "Archived?": "No", "Deleted?": "No", "Place Type": "Park" }),
  makePlace({ "Place ID": "PL-0007", "Place Name": "Buenos Aires", "Status": "Been", "Country": "Argentina", "Country Code": "AR", "City": "Buenos Aires", "Latitude": "-34.603700", "Longitude": "-58.381600", "First Visited Date": "2017-03-08", "Last Visited Date": "2017-03-20", "Personal Notes": "San Telmo on a Sunday.", "Created At": "2017-04-01", "Updated At": "2017-04-01", "Sync Version": 1, "Archived?": "No", "Deleted?": "No", "Place Type": "City" }),
  // A soft-deleted row: the app must not show it, and it must stay in the sheet.
  makePlace({ "Place ID": "PL-0008", "Place Name": "Somewhere I removed", "Status": "Been", "Country": "France", "Country Code": "FR", "Latitude": "48.856600", "Longitude": "2.352200", "Created At": "2020-01-01", "Updated At": "2020-02-01", "Sync Version": 2, "Archived?": "No", "Deleted?": "Yes" }),
];

const VI = index(VISIT_HEADERS);
const MI = index(MEDIA_HEADERS);

function makeVisit(values) {
  const row = blank(VISIT_HEADERS);
  for (const [header, value] of Object.entries(values)) row[VI[header]] = value;
  return row;
}

// Two visits on one place: the card lists both, and they fold into one
// First/Last span on the Places side.
const visits = [
  makeVisit({
    "Place ID": "PL-0002", "Visit ID": "VIS-0001", "Visit Status": "Been",
    "Start Date": "2019-05-01", "End Date": "2019-05-08", "Days": "8",
    "Year": "2019", "Month": "May", "Season": "Spring", "Trip Type": "Friends",
    "Highlights": "First time — the trip that started it.",
    "Archived?": "No", "Deleted?": "No",
  }),
  makeVisit({
    "Place ID": "PL-0002", "Visit ID": "VIS-0002", "Visit Status": "Been",
    "Start Date": "2023-09-12", "End Date": "2023-09-19", "Days": "8",
    "Year": "2023", "Month": "September", "Season": "Autumn/Fall", "Trip Type": "Couple",
    "Archived?": "No", "Deleted?": "No",
  }),
];

/** Media rows start empty; uploads made against this mock land here. */
const media = [];

/** Trips start empty, the way a sheet that has never had one does. */
const trips = [];

/** Travel_Photos rows start empty; picker imports land here. */
const travelPhotos = [];
const TPI = index(TRAVEL_PHOTO_HEADERS);

/** Uploaded photo bytes, served back at /photo/<id> so <img> tags work. */
const photos = new Map();
let nextPhotoNumber = 1;

/**
 * The mock Google Photos side: a picking session flips to "picked" when its
 * mock picker page is opened, and hands back a handful of generated images.
 * The media access code below matches what you enter in the app to view.
 */
// Matches the app's built-in default, so photos view with nothing to type —
// the same out-of-the-box behaviour the real script now has.
const MOCK_MEDIA_CODE = "2026";
const pickerSessions = new Map();
let nextSessionNumber = 1;

/** A recognisable placeholder image, unique per seed. */
function svgBytes(seed, label) {
  const hue = (seed * 67) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
    `<rect width="512" height="512" fill="hsl(${hue},60%,70%)"/>` +
    `<text x="256" y="276" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  return { bytes: Buffer.from(svg), mimeType: "image/svg+xml" };
}

function storeMockFile(seed, label) {
  const id = `mockdrive-${nextPhotoNumber++}`;
  photos.set(id, svgBytes(seed, label));
  return id;
}

/**
 * Google Places is off unless asked for — `MOCK_PLACES=1 npm run mock-sheet` —
 * because a sheet with no API key is the default case and the one most worth
 * developing against.
 */
/**
 * The real script's default is its own authorisation ("script" mode) with the
 * Picker scope granted. Two flags simulate the two states that need anything
 * of the user, so both guidance screens can be developed against:
 * `MOCK_PHOTOS_UNAUTHORISED=1 npm run mock-sheet` — the manifest scope not
 * yet authorised; `MOCK_PHOTOS_API_DISABLED=1 npm run mock-sheet` — scope
 * fine, but the Photos Picker API switched off in the Cloud project.
 */
const PHOTOS_AUTHORISED = process.env.MOCK_PHOTOS_UNAUTHORISED !== "1";
const PHOTOS_API_ENABLED = process.env.MOCK_PHOTOS_API_DISABLED !== "1";

/** Word for word what pickerApiDisabledAdvice_ says in script mode, with a
 * stand-in activation URL where Google would name the real project's. */
const PHOTOS_API_DISABLED_ADVICE =
  "One-time step: the Photos Picker API is switched off in the Cloud project this " +
  "script runs in, so Google refuses every picker call — the authorisation itself is fine, " +
  "and re-authorising will not change this. Enable the API at " +
  "https://console.developers.google.com/apis/api/photospicker.googleapis.com/overview?project=000000000000" +
  ", give Google a few minutes to notice, then try again. If that page says you don’t " +
  "have permission, the script is on its hidden default Cloud project: switch it to a " +
  "standard one (Apps Script editor → Project Settings → Google Cloud Platform (GCP) " +
  "Project → Change project), enable the Photos Picker API there, and authorise the " +
  "script again when it asks. Full steps: docs/SHEET-SETUP.md → Google Photos.";

const CAPABILITIES = {
  placesSearch: process.env.MOCK_PLACES === "1",
  placeDetails: process.env.MOCK_PLACES === "1",
  // The mock can always "upload": bytes are held in memory and served back
  // from /photo/<id>, standing in for the Drive link the real script returns.
  photoUpload: true,
  visits: true,
  travelPhotos: true,
  googlePhotosPicker: true,
  googlePhotosConnected: PHOTOS_AUTHORISED,
  deviceMediaUpload: true,
};

/** A few results shaped exactly like the script's, for the on case. */
const MOCK_PLACES = [
  {
    id: "ChIJmock0001", name: "Blue Bottle Coffee",
    address: "66 Mint Plaza, San Francisco, CA 94103, USA",
    latitude: 37.782, longitude: -122.409,
    city: "San Francisco", region: "California", country: "United States",
    countryCode: "US", types: ["cafe", "point_of_interest"],
  },
  {
    id: "ChIJmock0002", name: "Blue Bottle Coffee",
    address: "315 Linden St, San Francisco, CA 94102, USA",
    latitude: 37.7761, longitude: -122.4241,
    city: "San Francisco", region: "California", country: "United States",
    countryCode: "US", types: ["cafe", "point_of_interest"],
  },
  {
    id: "ChIJmock0003", name: "Eiffel Tower",
    address: "Av. Gustave Eiffel, 75007 Paris, France",
    latitude: 48.8584, longitude: 2.2945,
    city: "Paris", region: "Île-de-France", country: "France",
    countryCode: "FR", types: ["tourist_attraction", "point_of_interest"],
  },
  {
    id: "ChIJmock0004", name: "Kyoto",
    address: "Kyoto, Japan",
    latitude: 35.0116, longitude: 135.7681,
    city: "Kyoto", region: "Kyoto Prefecture", country: "Japan",
    countryCode: "JP", types: ["locality", "political"],
  },
];

/**
 * What the real script's placeDetails proxy answers, per listing — the shape
 * Places (New) returns under the card's field mask. Kyoto is deliberately
 * sparse: a locality has no rating, hours or website, and the card must read
 * as complete rather than broken when most rows have nothing to say.
 */
const MOCK_PLACE_DETAILS = {
  ChIJmock0001: {
    id: "ChIJmock0001",
    displayName: { text: "Blue Bottle Coffee", languageCode: "en" },
    primaryTypeDisplayName: { text: "Coffee Shop", languageCode: "en" },
    businessStatus: "OPERATIONAL",
    shortFormattedAddress: "66 Mint Plaza, San Francisco",
    googleMapsUri: "https://maps.google.com/?cid=1",
    rating: 4.4, userRatingCount: 1867,
    currentOpeningHours: {
      openNow: true,
      weekdayDescriptions: [
        "Monday: 6:30 AM – 6:00 PM", "Tuesday: 6:30 AM – 6:00 PM", "Wednesday: 6:30 AM – 6:00 PM",
        "Thursday: 6:30 AM – 6:00 PM", "Friday: 6:30 AM – 6:00 PM", "Saturday: 7:00 AM – 6:00 PM",
        "Sunday: 7:00 AM – 6:00 PM",
      ],
    },
    websiteUri: "https://bluebottlecoffee.com/us/cafes/mint-plaza",
    nationalPhoneNumber: "(510) 653-3394",
    utcOffsetMinutes: -420,
  },
  ChIJmock0002: {
    id: "ChIJmock0002",
    displayName: { text: "Blue Bottle Coffee", languageCode: "en" },
    primaryTypeDisplayName: { text: "Coffee Shop", languageCode: "en" },
    businessStatus: "CLOSED_PERMANENTLY",
    shortFormattedAddress: "315 Linden St, San Francisco",
    rating: 4.5, userRatingCount: 923,
    utcOffsetMinutes: -420,
  },
  ChIJmock0003: {
    id: "ChIJmock0003",
    displayName: { text: "Eiffel Tower", languageCode: "en" },
    primaryTypeDisplayName: { text: "Historical Landmark", languageCode: "en" },
    businessStatus: "OPERATIONAL",
    shortFormattedAddress: "Av. Gustave Eiffel, Paris",
    googleMapsUri: "https://maps.google.com/?cid=3",
    rating: 4.7, userRatingCount: 412381,
    currentOpeningHours: {
      openNow: true,
      weekdayDescriptions: [
        "Monday: 9:30 AM – 11:00 PM", "Tuesday: 9:30 AM – 11:00 PM", "Wednesday: 9:30 AM – 11:00 PM",
        "Thursday: 9:30 AM – 11:00 PM", "Friday: 9:30 AM – 11:00 PM", "Saturday: 9:30 AM – 11:00 PM",
        "Sunday: 9:30 AM – 11:00 PM",
      ],
    },
    websiteUri: "https://www.toureiffel.paris/",
    internationalPhoneNumber: "+33 892 70 12 39",
    utcOffsetMinutes: 120,
  },
  ChIJmock0004: {
    id: "ChIJmock0004",
    displayName: { text: "Kyoto", languageCode: "en" },
    shortFormattedAddress: "Kyoto, Japan",
    utcOffsetMinutes: 540,
  },
};

// Seeded rows arrive with their derived coordinate columns already correct, the
// way a real sheet's rows do — otherwise the first write fills them in and an
// "unrelated edit changed nothing else" assertion has nothing to assert.
for (const row of places) {
  const lat = parseFloat(row[PI["Latitude"]]);
  const lng = parseFloat(row[PI["Longitude"]]);
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    const a = lat.toFixed(6), b = lng.toFixed(6);
    row[PI["Latitude"]] = a; row[PI["Longitude"]] = b;
    row[PI["Coordinate Key"]] = `${a},${b}`;
    row[PI["Map URL"]] = mapUrl(a, b, row[PI["Google Place ID"]]);
  }
}

const settings = { "Schema Version": "1", "Default Currency": "USD", "Default Map Center": "20,0", "Last Full Sync At": "" };
const log = [];

const stamp = () => new Date().toISOString().slice(0, 19);

/** The listing id the app saves makes the derived link open the real place. */
function mapUrl(lat, lng, googlePlaceId) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const id = String(googlePlaceId ?? "").trim();
  return id ? `${url}&query_place_id=${encodeURIComponent(id)}` : url;
}

const SEARCH_SOURCES = ["Place Name", "Alternate Names", "Place Type", "Status", "Description",
  "Personal Notes", "Tags", "List Names", "Country", "Region / State", "City",
  "Neighborhood", "Address", "Food Notes", "Must Do", "Avoid / Watch Outs"];

const DERIVED = ["Created At", "Updated At", "Last Synced At", "Sync Version",
  "Coordinate Key", "Map URL", "Search Text"];

/** The same derived columns, on whichever tab the row belongs to. */
function applyTripDerived(row, isNew) {
  const now = stamp();
  if (isNew || !String(row[TI["Created At"]] || "").trim()) row[TI["Created At"]] = now;
  row[TI["Updated At"]] = now;
  row[TI["Last Synced At"]] = now;
  const v = parseInt(row[TI["Sync Version"]], 10);
  row[TI["Sync Version"]] = Number.isNaN(v) || v < 1 ? 1 : v + 1;
  if (!String(row[TI["Archived?"]] || "").trim()) row[TI["Archived?"]] = "No";
  if (!String(row[TI["Deleted?"]] || "").trim()) row[TI["Deleted?"]] = "No";
}

function applyDerived(row, isNew) {
  const now = stamp();
  if (isNew || !String(row[PI["Created At"]] || "").trim()) row[PI["Created At"]] = now;
  row[PI["Updated At"]] = now;
  row[PI["Last Synced At"]] = now;
  const v = parseInt(row[PI["Sync Version"]], 10);
  row[PI["Sync Version"]] = Number.isNaN(v) || v < 1 ? 1 : v + 1;
  if (!String(row[PI["Archived?"]] || "").trim()) row[PI["Archived?"]] = "No";
  if (!String(row[PI["Deleted?"]] || "").trim()) row[PI["Deleted?"]] = "No";

  const lat = parseFloat(row[PI["Latitude"]]);
  const lng = parseFloat(row[PI["Longitude"]]);
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    const a = lat.toFixed(6), b = lng.toFixed(6);
    row[PI["Latitude"]] = a; row[PI["Longitude"]] = b;
    row[PI["Coordinate Key"]] = `${a},${b}`;
    row[PI["Map URL"]] = mapUrl(a, b, row[PI["Google Place ID"]]);
  }
  row[PI["Search Text"]] = SEARCH_SOURCES
    .map((h) => String(row[PI[h]] ?? "").trim()).filter(Boolean)
    .join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The tabs the app writes, in one shape — mirroring how Code.gs drives every
 * write off its TABS config rather than special-casing each tab. `derive` is
 * the tab's own extra columns; the timestamps are common to all of them.
 */
function stampCommon(row, map, isNew) {
  const now = stamp();
  if (map["Created At"] !== undefined && (isNew || !String(row[map["Created At"]] || "").trim())) {
    row[map["Created At"]] = now;
  }
  if (map["Updated At"] !== undefined) row[map["Updated At"]] = now;
  if (map["Last Synced At"] !== undefined) row[map["Last Synced At"]] = now;
  if (map["Sync Version"] !== undefined) {
    const v = parseInt(row[map["Sync Version"]], 10);
    row[map["Sync Version"]] = Number.isNaN(v) || v < 1 ? 1 : v + 1;
  }
  if (map["Archived?"] !== undefined && !String(row[map["Archived?"]] || "").trim()) {
    row[map["Archived?"]] = "No";
  }
  if (map["Deleted?"] !== undefined && !String(row[map["Deleted?"]] || "").trim()) {
    row[map["Deleted?"]] = "No";
  }
}

function nextIdFor(rows, map, idColumn, prefix) {
  let highest = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const row of rows) {
    const m = pattern.exec(String(row[map[idColumn]]).trim());
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}

const WRITABLE_TABS = {
  Places: { headers: PLACES_HEADERS, map: PI, rows: places, idColumn: "Place ID", prefix: "PL", derive: applyDerived },
  Trips: { headers: TRIP_HEADERS, map: TI, rows: trips, idColumn: "Trip ID", prefix: "TRIP", derive: applyTripDerived },
  Dates_Visits: { headers: VISIT_HEADERS, map: VI, rows: visits, idColumn: "Visit ID", prefix: "VIS", derive: (row, isNew) => stampCommon(row, VI, isNew) },
  Media_Links: { headers: MEDIA_HEADERS, map: MI, rows: media, idColumn: "Media ID", prefix: "MEDIA", derive: (row, isNew) => stampCommon(row, MI, isNew) },
  Travel_Photos: { headers: TRAVEL_PHOTO_HEADERS, map: TPI, rows: travelPhotos, idColumn: "Photo ID", prefix: "TPHOTO", derive: (row, isNew) => stampCommon(row, TPI, isNew) },
};

function handle(action, body) {
  if (action === "ping") return { ok: true, schemaVersion: "3", capabilities: CAPABILITIES };

  // Stands in for the script's Google Places proxy. Off unless this process
  // was started with MOCK_PLACES=1, so the keyless path is what you get by
  // default — which is what a sheet with no API key actually does.
  if (action === "searchPlaces") {
    if (!CAPABILITIES.placesSearch) throw new Error("No Google Maps API key is set on this script.");
    const query = String(body.q || "").trim().toLowerCase();
    const places = MOCK_PLACES.filter((place) =>
      `${place.name} ${place.address}`.toLowerCase().includes(query),
    );
    return { places, source: "google" };
  }

  if (action === "placeDetails") {
    if (!CAPABILITIES.placeDetails) throw new Error("No Google Maps API key is set on this script.");
    const id = String(body.id || "").trim();
    const details = MOCK_PLACE_DETAILS[id];
    if (!details) throw new Error("Google Places refused the lookup (404): place not found.");
    return { place: details, source: "google" };
  }

  if (action === "getAll") {
    return {
      tabs: {
        Places: { headers: PLACES_HEADERS, rows: places },
        Dates_Visits: { headers: VISIT_HEADERS, rows: visits },
        Notes_Reviews: { headers: [], rows: [] },
        Media_Links: { headers: MEDIA_HEADERS, rows: media },
        Lists_Tags: { headers: [], rows: [] },
        Trips_Itinerary: { headers: [], rows: [] },
        Trips: { headers: TRIP_HEADERS, rows: trips },
        Travel_Photos: { headers: TRAVEL_PHOTO_HEADERS, rows: travelPhotos },
      },
      lookups: LOOKUPS, settings, schemaVersion: "4",
      capabilities: CAPABILITIES, serverTime: new Date().toISOString(),
    };
  }

  /* ---- Google Photos, mocked end to end ---- */

  if (action === "photosAuthStatus") {
    // Script mode, like a freshly deployed real script: nothing configured,
    // nothing to connect — the deployment's own authorisation carries it.
    // The API-disabled state layers on top exactly as the real status does:
    // scope granted, connection refused, advice naming the console switch.
    return {
      configured: PHOTOS_AUTHORISED,
      connected: PHOTOS_AUTHORISED && PHOTOS_API_ENABLED,
      mode: "script", scopeGranted: PHOTOS_AUTHORISED,
      pickerApiEnabled: PHOTOS_API_ENABLED,
      advice: !PHOTOS_API_ENABLED
        ? PHOTOS_API_DISABLED_ADVICE
        : PHOTOS_AUTHORISED
          ? ""
          : "One-time step: add the Google Photos Picker scope to the script’s appsscript.json manifest and re-authorise the deployment — see docs/SHEET-SETUP.md → Google Photos.",
      connectedAt: "",
      accountHint: "mock@example.com",
      redirectUri: `http://localhost:${PORT}/`,
    };
  }
  if (action === "photosAuthStart") {
    return { authUrl: `http://localhost:${PORT}/mock-consent`, redirectUri: `http://localhost:${PORT}/` };
  }
  if (action === "photosAuthDisconnect") return { disconnected: true };

  if (action === "createPhotoPickerSession") {
    if (!PHOTOS_AUTHORISED) {
      // Word for word what photosBearerToken_ throws in the real script.
      throw new Error(
        "This script’s Google authorisation does not include Google Photos yet. " +
        "Add the Photos Picker scope to the appsscript.json manifest and re-authorise " +
        "the deployment — see docs/SHEET-SETUP.md → Google Photos.",
      );
    }
    if (!PHOTOS_API_ENABLED) {
      // Word for word what pickerFetch_ throws for Google's SERVICE_DISABLED.
      throw new Error("Google Photos refused the request (403). " + PHOTOS_API_DISABLED_ADVICE);
    }
    const id = `mocksession-${nextSessionNumber++}`;
    pickerSessions.set(id, { picked: false, createdAt: Date.now() });
    return {
      sessionId: id,
      pickerUri: `http://localhost:${PORT}/mock-picker/${id}`,
      expireTime: new Date(Date.now() + 30 * 60000).toISOString(),
      pollingConfig: { pollInterval: "2s", timeoutIn: "300s" },
    };
  }
  if (action === "getPhotoPickerSession") {
    const session = pickerSessions.get(String(body.sessionId || ""));
    if (!session) throw new Error("That Google Photos picking session no longer exists. Start the picker again.");
    return { sessionId: body.sessionId, mediaItemsSet: session.picked, pollingConfig: { pollInterval: "2s" } };
  }
  if (action === "deletePhotoPickerSession") {
    pickerSessions.delete(String(body.sessionId || ""));
    return { deleted: true };
  }
  if (action === "listPickedPhotos") {
    const session = pickerSessions.get(String(body.sessionId || ""));
    if (!session) throw new Error("That Google Photos picking session no longer exists. Start the picker again.");
    // A recognisable spread: two in-range-ish photos, one old one, one video.
    return {
      items: [
        { id: "mockitem-1", createTime: "2024-02-08T14:00:00Z", type: "PHOTO", baseUrl: `http://localhost:${PORT}/mock-base/1`, mimeType: "image/svg+xml", filename: "ski-lift.jpg", width: 512, height: 512 },
        { id: "mockitem-2", createTime: "2024-02-09T09:30:00Z", type: "PHOTO", baseUrl: `http://localhost:${PORT}/mock-base/2`, mimeType: "image/svg+xml", filename: "summit.jpg", width: 512, height: 512 },
        { id: "mockitem-3", createTime: "2019-06-20T18:00:00Z", type: "PHOTO", baseUrl: `http://localhost:${PORT}/mock-base/3`, mimeType: "image/svg+xml", filename: "old-trip.jpg", width: 512, height: 512 },
        { id: "mockitem-4", createTime: "2024-02-08T16:45:00Z", type: "VIDEO", baseUrl: `http://localhost:${PORT}/mock-base/4`, mimeType: "video/mp4", filename: "run.mp4", width: 512, height: 512 },
      ],
    };
  }
  if (action === "getPickedPhotoPreview") {
    const itemId = String(body.itemId || "");
    const seed = parseInt(itemId.replace(/\D/g, ""), 10) || 1;
    const file = svgBytes(seed, itemId.slice(-1));
    return { itemId, mimeType: file.mimeType, data: file.bytes.toString("base64") };
  }
  if (action === "importPickedPhotos") {
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw new Error("The import carried no photos.");
    if (items.length > 10) throw new Error("Import at most 10 photos per request; the app sends batches.");

    // The same association validation the real script performs.
    let placeId = String(body.placeId || "").trim();
    let tripId = String(body.tripId || "").trim();
    const visitId = String(body.visitId || "").trim();
    if (!placeId && !tripId && !visitId) {
      throw new Error("These photos have nothing to attach to — no visit, trip or place was named.");
    }
    if (visitId) {
      const row = visits.find((r) => String(r[VI["Visit ID"]]).trim() === visitId);
      if (!row) throw new Error(`The visit "${visitId}" is not in the sheet. If it was just added, let it sync first.`);
      if (String(row[VI["Deleted?"]]).toLowerCase() === "yes") throw new Error("That visit has been deleted, so photos can no longer be added to it.");
      const visitPlace = String(row[VI["Place ID"]]).trim();
      if (placeId && visitPlace && placeId !== visitPlace) throw new Error("That visit belongs to a different place than the one named.");
      const visitTrip = String(row[VI["Trip ID"]]).trim();
      if (tripId && visitTrip && tripId !== visitTrip) throw new Error("That visit belongs to a different trip than the one named.");
      placeId = visitPlace || placeId;
      tripId = visitTrip || tripId;
    }

    const results = [];
    const savedRows = [];
    for (const item of items) {
      const googleId = String(item.id || "");
      const live = travelPhotos.filter((r) =>
        String(r[TPI["Google Photos Item ID"]]) === googleId &&
        String(r[TPI["Deleted?"]]).toLowerCase() !== "yes");
      const dupe = live.some((r) => {
        if (visitId) return String(r[TPI["Visit ID"]]) === visitId;
        if (tripId) return String(r[TPI["Trip ID"]]) === tripId && !String(r[TPI["Visit ID"]]);
        return String(r[TPI["Place ID"]]) === placeId && !String(r[TPI["Visit ID"]]) && !String(r[TPI["Trip ID"]]);
      });
      if (dupe) { results.push({ id: googleId, status: "duplicate" }); continue; }

      const reuse = live.find((r) => r[TPI["Thumb Drive File ID"]] && r[TPI["Display Drive File ID"]]);
      const seed = parseInt(googleId.replace(/\D/g, ""), 10) || 1;
      const isVideo = String(item.type || "").toUpperCase() === "VIDEO";
      const thumbId = reuse ? reuse[TPI["Thumb Drive File ID"]] : storeMockFile(seed, "T");
      const displayId = reuse ? reuse[TPI["Display Drive File ID"]] : storeMockFile(seed, "D");
      const videoId = reuse ? reuse[TPI["Video Drive File ID"]] : (isVideo ? storeMockFile(seed, "V") : "");

      const row = blank(TRAVEL_PHOTO_HEADERS);
      const id = nextIdFor(travelPhotos, TPI, "Photo ID", "TPHOTO");
      row[TPI["Photo ID"]] = id;
      row[TPI["Google Photos Item ID"]] = googleId;
      row[TPI["Place ID"]] = placeId;
      row[TPI["Visit ID"]] = visitId;
      row[TPI["Trip ID"]] = tripId;
      row[TPI["Taken At"]] = String(item.createTime || "");
      row[TPI["Filename"]] = String(item.filename || "");
      row[TPI["MIME Type"]] = String(item.mimeType || "");
      row[TPI["Width"]] = item.width ? String(item.width) : "";
      row[TPI["Height"]] = item.height ? String(item.height) : "";
      row[TPI["Thumb Drive File ID"]] = thumbId;
      row[TPI["Display Drive File ID"]] = displayId;
      row[TPI["Video Drive File ID"]] = videoId;
      row[TPI["Source"]] = "google-photos";
      stampCommon(row, TPI, true);
      travelPhotos.push(row);
      savedRows.push(row);
      results.push({ id: googleId, status: "imported", photoId: id });
    }
    return { results, photos: { headers: TRAVEL_PHOTO_HEADERS, rows: savedRows } };
  }
  // Photos and videos straight from a device, stored with their real bytes so
  // galleries and the player can be exercised against what was actually sent.
  if (action === "uploadTravelMedia") {
    const mimeType = String(body.mimeType || "").trim();
    const isVideo = mimeType.startsWith("video/");
    if (!isVideo && !mimeType.startsWith("image/")) throw new Error("Only photos and videos can be added.");

    let placeId = String(body.placeId || "").trim();
    let tripId = String(body.tripId || "").trim();
    const visitId = String(body.visitId || "").trim();
    if (!placeId && !tripId && !visitId) {
      throw new Error("These photos have nothing to attach to — no visit, trip or place was named.");
    }
    if (visitId) {
      const vrow = visits.find((r) => String(r[VI["Visit ID"]]).trim() === visitId);
      if (!vrow) throw new Error(`The visit "${visitId}" is not in the sheet. If it was just added, let it sync first.`);
      if (String(vrow[VI["Deleted?"]]).toLowerCase() === "yes") throw new Error("That visit has been deleted, so photos can no longer be added to it.");
      placeId = String(vrow[VI["Place ID"]]).trim() || placeId;
      tripId = String(vrow[VI["Trip ID"]]).trim() || tripId;
    }

    const itemId = String(body.itemId || "").trim();
    let thumbId = "", displayId = "", videoId = "";
    if (itemId) {
      const live = travelPhotos.filter((r) =>
        String(r[TPI["Google Photos Item ID"]]) === itemId &&
        String(r[TPI["Deleted?"]]).toLowerCase() !== "yes");
      const dupe = live.some((r) => {
        if (visitId) return String(r[TPI["Visit ID"]]) === visitId;
        if (tripId) return String(r[TPI["Trip ID"]]) === tripId && !String(r[TPI["Visit ID"]]);
        return String(r[TPI["Place ID"]]) === placeId && !String(r[TPI["Visit ID"]]) && !String(r[TPI["Trip ID"]]);
      });
      if (dupe) {
        const twin = live.find((r) => r[TPI["Video Drive File ID"]]);
        return { status: "duplicate", clipStored: Boolean(twin), photos: { headers: [], rows: [] } };
      }
      const reuse = live.find((r) => r[TPI["Thumb Drive File ID"]] && r[TPI["Display Drive File ID"]]);
      if (reuse) {
        thumbId = reuse[TPI["Thumb Drive File ID"]];
        displayId = reuse[TPI["Display Drive File ID"]];
        videoId = reuse[TPI["Video Drive File ID"]] || "";
      }
    }

    if (!thumbId || !displayId) {
      const decode = (data, label) => {
        const text = String(data || "");
        if (!text) throw new Error(`The upload carried no ${label} data.`);
        return Buffer.from(text, "base64");
      };
      const thumbBytes = decode(body.thumbData, "thumbnail");
      const displayBytes = decode(body.displayData, "preview");
      let clipBytes = null;
      if (isVideo && body.videoData) {
        clipBytes = decode(body.videoData, "video");
        // Same server-side bound as MAX_DEVICE_CLIP_BYTES in Code.gs.
        if (clipBytes.length > 40 * 1024 * 1024) {
          throw new Error("That video is too large to store whole. Retry and it will be added as its preview frame.");
        }
      }
      thumbId = `mockdrive-${nextPhotoNumber++}`;
      photos.set(thumbId, { bytes: thumbBytes, mimeType: "image/jpeg" });
      displayId = `mockdrive-${nextPhotoNumber++}`;
      photos.set(displayId, { bytes: displayBytes, mimeType: "image/jpeg" });
      if (clipBytes) {
        videoId = `mockdrive-${nextPhotoNumber++}`;
        photos.set(videoId, { bytes: clipBytes, mimeType });
      }
    }

    const row = blank(TRAVEL_PHOTO_HEADERS);
    const id = nextIdFor(travelPhotos, TPI, "Photo ID", "TPHOTO");
    row[TPI["Photo ID"]] = id;
    row[TPI["Google Photos Item ID"]] = itemId;
    row[TPI["Place ID"]] = placeId;
    row[TPI["Visit ID"]] = visitId;
    row[TPI["Trip ID"]] = tripId;
    row[TPI["Taken At"]] = String(body.takenAt || "");
    row[TPI["Filename"]] = String(body.filename || "");
    row[TPI["MIME Type"]] = mimeType;
    row[TPI["Width"]] = body.width ? String(body.width) : "";
    row[TPI["Height"]] = body.height ? String(body.height) : "";
    row[TPI["Thumb Drive File ID"]] = thumbId;
    row[TPI["Display Drive File ID"]] = displayId;
    row[TPI["Video Drive File ID"]] = videoId;
    row[TPI["Source"]] = "manual";
    stampCommon(row, TPI, true);
    travelPhotos.push(row);
    return {
      status: "imported",
      photoId: id,
      clipStored: Boolean(videoId),
      photos: { headers: TRAVEL_PHOTO_HEADERS, rows: [row] },
    };
  }
  if (action === "getTravelPhoto") {
    if (String(body.media || "") !== MOCK_MEDIA_CODE) {
      throw new Error(`Wrong or missing media access code. (The mock's code is "${MOCK_MEDIA_CODE}".)`);
    }
    const photoId = String(body.photoId || "").trim();
    const row = travelPhotos.find((r) => String(r[TPI["Photo ID"]]).trim() === photoId);
    if (!row) throw new Error(`No photo with the id "${photoId}" exists.`);
    if (String(row[TPI["Deleted?"]]).toLowerCase() === "yes") throw new Error("That photo has been deleted.");
    const requested = String(body.size || "thumb");
    const column = requested === "video" ? "Video Drive File ID" : requested === "display" ? "Display Drive File ID" : "Thumb Drive File ID";
    const fileId = String(row[TPI[column]] || "");
    if (!fileId) throw new Error(requested === "video" ? "This video's full clip wasn't stored." : "That photo has no stored image yet.");
    const stored = photos.get(fileId);
    if (!stored) throw new Error("The photo's file is missing from Drive.");
    return { photoId, size: requested, mimeType: stored.mimeType, data: stored.bytes.toString("base64"), version: String(row[TPI["Updated At"]] || "") };
  }
  if (action === "deleteTravelPhoto") {
    const photoId = String(body.id || "").trim();
    const row = travelPhotos.find((r) => String(r[TPI["Photo ID"]]).trim() === photoId);
    if (!row) return { id: photoId, deleted: true, missing: true };
    row[TPI["Deleted?"]] = "Yes";
    stampCommon(row, TPI, false);
    return { id: photoId, deleted: true };
  }

  if (action === "getLookups") return { lookups: LOOKUPS };

  // Stands in for the script's Drive upload: the bytes stay in this process
  // and the returned link points back at it, so the swap from a local blob to
  // a shared URL can be exercised end to end.
  if (action === "uploadPhoto") {
    const mimeType = String(body.mimeType || "image/jpeg");
    if (!mimeType.startsWith("image/")) throw new Error("Only images can be uploaded.");
    const data = String(body.data || "");
    if (!data) throw new Error("The upload carried no photo data.");
    let bytes;
    try {
      bytes = Buffer.from(data, "base64");
    } catch {
      throw new Error("The photo data was not readable.");
    }
    // Same cap as MAX_PHOTO_BYTES in Code.gs — an oversized photo must be
    // refused here exactly as it would be in production.
    if (bytes.length > 8 * 1024 * 1024) {
      throw new Error("That photo is too large to upload.");
    }
    const id = `mockphoto-${nextPhotoNumber++}`;
    photos.set(id, { bytes, mimeType });
    return { url: `http://localhost:${PORT}/photo/${id}`, fileId: id };
  }

  if (action === "upsertRow") {
    if (["Search_View", "Dashboard", "Guide"].includes(body.tab)) {
      throw new Error(`The tab "${body.tab}" is built from live formulas and is never written to.`);
    }
    const tab = WRITABLE_TABS[body.tab];
    if (!tab) throw new Error(`The tab "${body.tab}" is not one this app writes to.`);

    let id = String(body.id || "").trim();
    let row = id ? tab.rows.find((r) => String(r[tab.map[tab.idColumn]]).trim() === id) : null;
    const isNew = !row;
    if (isNew) {
      row = blank(tab.headers);
      if (!id) id = nextIdFor(tab.rows, tab.map, tab.idColumn, tab.prefix);
      row[tab.map[tab.idColumn]] = id;
      tab.rows.push(row);
    }
    for (const [header, value] of Object.entries(body.fields || {})) {
      if (DERIVED.includes(header)) continue;
      if (tab.map[header] === undefined) throw new Error(`The tab "${body.tab}" has no column named "${header}".`);
      row[tab.map[header]] = value ?? "";
    }
    tab.derive(row, isNew);
    log.push([stamp(), body.tab, id, isNew ? "create" : "update", "ok"]);
    return { id, row, headers: tab.headers };
  }

  if (action === "deleteRow") {
    const tab = WRITABLE_TABS[body.tab];
    if (!tab) throw new Error(`The tab "${body.tab}" is not one this app writes to.`);

    const id = String(body.id || "").trim();
    const row = tab.rows.find((r) => String(r[tab.map[tab.idColumn]]).trim() === id);
    // Soft delete, as everywhere else: the row stays, the flag changes.
    if (!row) { log.push([stamp(), body.tab, id, "delete", "missing"]); return { id, deleted: true, missing: true }; }
    if (tab.map["Deleted?"] === undefined) {
      throw new Error(`The tab "${body.tab}" has no "Deleted?" column, so nothing can be soft-deleted there.`);
    }
    row[tab.map["Deleted?"]] = "Yes";
    tab.derive(row, false);
    log.push([stamp(), body.tab, id, "delete", "ok"]);
    return { id, deleted: true, row, headers: tab.headers };
  }

  if (action === "setSetting") { settings[body.key] = body.value; return { key: body.key, value: body.value }; }
  throw new Error(`Unknown action "${action}".`);
}

const server = createServer((req, res) => {
  // Apps Script serves its final response with permissive CORS; match that so
  // the browser behaves the same way it will against the real thing.
  const send = (payload, status = 200) => {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(text);
  };

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Uploaded photos are served straight back, the way a Drive link would be.
  // No access code on purpose: the real link is an unauthenticated image URL.
  // The mock picker: opening it counts as picking, the way tapping Done in
  // the real Google Photos window does. /autoclose variants land here too.
  if (req.method === "GET" && url.pathname.startsWith("/mock-picker/")) {
    const sessionId = url.pathname.slice("/mock-picker/".length).replace(/\/autoclose$/, "");
    const session = pickerSessions.get(sessionId);
    if (session) session.picked = true;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<!doctype html><body style=\"font-family:sans-serif;display:grid;place-items:center;height:100vh\">" +
      "<div><h2>Mock Google Photos</h2><p>Selection made — you can close this window.</p>" +
      "<script>setTimeout(function(){ try { window.close(); } catch (e) {} }, 800);</script></div></body>",
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/mock-consent") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<!doctype html><body style=\"font-family:sans-serif;display:grid;place-items:center;height:100vh\">" +
      "<div><h2>Mock consent</h2><p>Pretend this was Google. Close this window and continue in the app.</p></div></body>",
    );
    return;
  }

  // Picker base URLs, standing in for lh3.googleusercontent.com.
  if (req.method === "GET" && url.pathname.startsWith("/mock-base/")) {
    const seed = parseInt(url.pathname.slice("/mock-base/".length), 10) || 1;
    const file = svgBytes(seed, String(seed));
    res.writeHead(200, { "Content-Type": file.mimeType, "Access-Control-Allow-Origin": "*" });
    res.end(file.bytes);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/photo/")) {
    const stored = photos.get(url.pathname.slice("/photo/".length));
    if (!stored) {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      res.end("gone");
      return;
    }
    res.writeHead(200, {
      "Content-Type": stored.mimeType,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(stored.bytes);
    return;
  }

  if (req.method === "GET") {
    try {
      if (url.searchParams.get("code") !== ACCESS_CODE) throw new Error("Wrong or missing access code.");
      // The query string is the body for a GET, which is how searchPlaces
      // receives its query — the same shape `e.parameter` has in Apps Script.
      send({ ok: true, data: handle(url.searchParams.get("action"), Object.fromEntries(url.searchParams)) });
    } catch (error) { send({ ok: false, error: error.message }); }
    return;
  }

  if (req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        if (body.code !== ACCESS_CODE) throw new Error("Wrong or missing access code.");
        send({ ok: true, data: handle(body.action, body) });
      } catch (error) { send({ ok: false, error: error.message }); }
    });
    return;
  }

  // Deliberately no OPTIONS handler — Apps Script has none either. If the app
  // ever sends a JSON content type, the request must fail here exactly as it
  // would in production.
  send({ ok: false, error: `No handler for ${req.method}` }, 405);
});

/*
 * Node closes idle keep-alive sockets after 5 seconds by default; browsers
 * pool connections for far longer and do not retry a POST over a socket that
 * turns out to be dead — a write then fails with a connection reset the real
 * Apps Script never produces. Outlive the browser's pool instead.
 */
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

server.listen(PORT, () => console.log(`mock sheet on http://localhost:${PORT}`));
