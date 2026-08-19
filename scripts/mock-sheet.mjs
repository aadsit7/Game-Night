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

// Two visits on one place, to prove they fold into a single span on reload.
const visits = [
  (() => { const r = blank(VISIT_HEADERS); const m = index(VISIT_HEADERS);
    r[m["Place ID"]] = "PL-0002"; r[m["Visit ID"]] = "VIS-0001";
    r[m["Start Date"]] = "2019-05-01"; r[m["End Date"]] = "2019-05-08"; return r; })(),
  (() => { const r = blank(VISIT_HEADERS); const m = index(VISIT_HEADERS);
    r[m["Place ID"]] = "PL-0002"; r[m["Visit ID"]] = "VIS-0002";
    r[m["Start Date"]] = "2023-09-12"; r[m["End Date"]] = "2023-09-19"; return r; })(),
];

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
    row[PI["Map URL"]] = `https://www.google.com/maps/search/?api=1&query=${a},${b}`;
  }
}

const settings = { "Schema Version": "1", "Default Currency": "USD", "Default Map Center": "20,0", "Last Full Sync At": "" };
const log = [];

const stamp = () => new Date().toISOString().slice(0, 19);

const SEARCH_SOURCES = ["Place Name", "Alternate Names", "Place Type", "Status", "Description",
  "Personal Notes", "Tags", "List Names", "Country", "Region / State", "City",
  "Neighborhood", "Address", "Food Notes", "Must Do", "Avoid / Watch Outs"];

const DERIVED = ["Created At", "Updated At", "Last Synced At", "Sync Version",
  "Coordinate Key", "Map URL", "Search Text"];

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
    row[PI["Map URL"]] = `https://www.google.com/maps/search/?api=1&query=${a},${b}`;
  }
  row[PI["Search Text"]] = SEARCH_SOURCES
    .map((h) => String(row[PI[h]] ?? "").trim()).filter(Boolean)
    .join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

function nextId() {
  let highest = 0;
  for (const row of places) {
    const m = /^PL-(\d+)$/.exec(String(row[PI["Place ID"]]).trim());
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  return `PL-${String(highest + 1).padStart(4, "0")}`;
}

function handle(action, body) {
  if (action === "ping") return { ok: true, schemaVersion: "1" };

  if (action === "getAll") {
    return {
      tabs: {
        Places: { headers: PLACES_HEADERS, rows: places },
        Dates_Visits: { headers: VISIT_HEADERS, rows: visits },
        Notes_Reviews: { headers: [], rows: [] },
        Media_Links: { headers: [], rows: [] },
        Lists_Tags: { headers: [], rows: [] },
        Trips_Itinerary: { headers: [], rows: [] },
      },
      lookups: LOOKUPS, settings, schemaVersion: "1", serverTime: new Date().toISOString(),
    };
  }

  if (action === "getLookups") return { lookups: LOOKUPS };

  if (action === "upsertRow") {
    if (["Search_View", "Dashboard", "Guide"].includes(body.tab)) {
      throw new Error(`The tab "${body.tab}" is built from live formulas and is never written to.`);
    }
    let id = String(body.id || "").trim();
    let row = id ? places.find((r) => String(r[PI["Place ID"]]).trim() === id) : null;
    const isNew = !row;
    if (isNew) {
      row = blank(PLACES_HEADERS);
      if (!id) id = nextId();
      row[PI["Place ID"]] = id;
      places.push(row);
    }
    for (const [header, value] of Object.entries(body.fields || {})) {
      if (DERIVED.includes(header)) continue;
      if (PI[header] === undefined) throw new Error(`The tab "Places" has no column named "${header}".`);
      row[PI[header]] = value ?? "";
    }
    applyDerived(row, isNew);
    log.push([stamp(), body.tab, id, isNew ? "create" : "update", "ok"]);
    return { id, row, headers: PLACES_HEADERS };
  }

  if (action === "deleteRow") {
    const id = String(body.id || "").trim();
    const row = places.find((r) => String(r[PI["Place ID"]]).trim() === id);
    if (!row) { log.push([stamp(), body.tab, id, "delete", "missing"]); return { id, deleted: true, missing: true }; }
    row[PI["Deleted?"]] = "Yes";
    applyDerived(row, false);
    log.push([stamp(), body.tab, id, "delete", "ok"]);
    return { id, deleted: true, row, headers: PLACES_HEADERS };
  }

  if (action === "setSetting") { settings[body.key] = body.value; return { key: body.key, value: body.value }; }
  throw new Error(`Unknown action "${action}".`);
}

createServer((req, res) => {
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

  if (req.method === "GET") {
    try {
      if (url.searchParams.get("code") !== ACCESS_CODE) throw new Error("Wrong or missing access code.");
      send({ ok: true, data: handle(url.searchParams.get("action"), {}) });
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
}).listen(PORT, () => console.log(`mock sheet on http://localhost:${PORT}`));
