/**
 * Travel repository — Google Apps Script Web App.
 *
 * The only thing that touches the spreadsheet. The website has no Google
 * credentials of its own: it sends a request here, this script does the read
 * or write under the sheet owner's own account, and the sheet itself stays
 * private.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy >
 * New deployment > Web app > Execute as: Me > Who has access: Anyone.
 * There is nothing to configure: the access code is in this file.
 *
 * AFTER ANY EDIT TO THIS FILE the old code keeps serving until you publish a
 * new version: Deploy > Manage deployments > pencil > Version: New version >
 * Deploy. "New deployment" would hand you a second, different address.
 */

/* ------------------------------------------------------------------ *
 * Sheet shape. Header rows are NOT row 1 — row 1 is a title and row 2
 * a description — so every tab declares where its header actually is.
 * ------------------------------------------------------------------ */

var SPREADSHEET_ID = '1F9RZlfUErB5psZ9EKdW5aCFpbbE2ijHgo3CUuDQQ9Ls';

var TABS = {
  Places:          { header: 3, idColumn: 'Place ID',          prefix: 'PL',    pad: 4 },
  Dates_Visits:    { header: 3, idColumn: 'Visit ID',          prefix: 'VIS',   pad: 4 },
  Notes_Reviews:   { header: 3, idColumn: 'Note ID',           prefix: 'NOTE',  pad: 4 },
  Media_Links:     { header: 3, idColumn: 'Media ID',          prefix: 'MEDIA', pad: 4 },
  Lists_Tags:      { header: 3, idColumn: 'Mapping ID',        prefix: 'MAP',   pad: 4 },
  Trips_Itinerary: { header: 3, idColumn: 'Itinerary Item ID', prefix: 'ITEM',  pad: 4 },
  // One row per trip: the name and dates that a Place's "Trip ID / Collection"
  // cell points at. Created by this script if the tab is not there yet.
  Trips:           { header: 3, idColumn: 'Trip ID',           prefix: 'TRIP',  pad: 4 }
};

/** Read at startup so the app's dropdowns come from the sheet, not from code. */
var LOOKUPS_TAB = 'Lookups';
var LOOKUPS_HEADER_ROW = 4;

/**
 * Every cell on these is a live formula or hand-written documentation.
 * Writing to them destroys the formulas, so the refusal lives here — in the
 * script — rather than relying on the client to remember.
 */
var READ_ONLY_TABS = ['Search_View', 'Dashboard', 'Guide'];

/** Tabs this script creates on demand. Nothing else may be created. */
var TRIPS_TAB = 'Trips';
var TRIPS_HEADERS = [
  'Trip ID', 'Trip Name', 'Start Date', 'End Date', 'Description', 'Cover Place ID',
  'Created At', 'Updated At', 'Last Synced At', 'Sync Version', 'Archived?', 'Deleted?'
];

var SETTINGS_TAB = 'App_Settings';
var LOG_TAB = 'Sync_Log';
var LOG_MAX_ROWS = 1000;
var LOG_TRIM_TO = 900;

var SCHEMA_VERSION = '3';

/* ------------------------------------------------------------------ *
 * Google Places search
 *
 * The website is a public static site: an API key compiled into it is
 * handed to every visitor and readable from the page source. This script
 * already runs server-side under the sheet owner's own account, so the key
 * lives here instead — in a Script Property, never in this file and never in
 * the bundle — and the browser asks this script to do the searching.
 *
 * Optional. With no key set, the app falls back to its keyless geocoder and
 * everything keeps working; this only makes the results better.
 * ------------------------------------------------------------------ */

var PLACES_KEY_PROPERTY = 'GOOGLE_MAPS_API_KEY';
var PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Exactly the fields the app draws, and no more. Places (New) bills by field
 * mask, so asking for everything would cost more for data nothing displays.
 */
var PLACES_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.addressComponents'
].join(',');

/**
 * Repeat queries are the normal case — typing a name, deleting it, typing it
 * again — and each one is a billable call. Half an hour is long enough to
 * absorb that and far short of the 30 days Google's terms allow.
 */
var PLACES_CACHE_SECONDS = 1800;

/**
 * The shared code this script checks on every request.
 *
 * It lives here, in the file, rather than in a Script Property. That is a
 * deliberate trade: the property would keep it off this page, but the website
 * that calls this script is a public static site, so the very same code is
 * already compiled into the JavaScript every visitor downloads. Hiding it here
 * while publishing it there would buy nothing and cost a setup step that has to
 * be got exactly right before anything works at all.
 *
 * A Script Property named ACCESS_CODE still wins if one is set, so the code can
 * be rotated without touching this file — see docs/SHEET-SETUP.md.
 */
var BUILT_IN_ACCESS_CODE = '2dHoDYeD-XLTSecCG-qcZVCM5d';

/**
 * Which columns this script maintains itself. The client never sends them;
 * if it did, they would be ignored. Keeping them here means the invariants
 * hold no matter which device or which version of the app wrote the row.
 */
var DERIVED_COLUMNS = [
  'Created At', 'Updated At', 'Last Synced At', 'Sync Version',
  'Coordinate Key', 'Map URL', 'Search Text'
];

/**
 * How Search Text is built, per tab, in this exact field order — copied from
 * the pattern already in row 4 so a rebuilt cell matches a hand-made one.
 */
var SEARCH_TEXT_SOURCES = {
  Places: [
    'Place Name', 'Alternate Names', 'Place Type', 'Status', 'Description',
    'Personal Notes', 'Tags', 'List Names', 'Country', 'Region / State',
    'City', 'Neighborhood', 'Address', 'Food Notes', 'Must Do',
    'Avoid / Watch Outs'
  ],
  Notes_Reviews: [
    'Place ID', 'Visit ID', 'Note Type', 'Date', 'Title',
    'Note / Journal Entry', 'Mood'
  ]
};

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

function doGet(e) {
  return handle_(function () {
    var params = (e && e.parameter) || {};
    authorize_(params.code);

    switch (params.action) {
      case 'getAll':        return getAll_();
      case 'getLookups':    return { lookups: readLookups_() };
      case 'searchPlaces':  return searchPlaces_(params);
      case 'ping':
        return { ok: true, schemaVersion: SCHEMA_VERSION, capabilities: capabilities_() };
      default:
        throw new Error(
          'Unknown action "' + (params.action || '') +
          '". Expected getAll, getLookups, searchPlaces or ping.'
        );
    }
  });
}

function doPost(e) {
  return handle_(function () {
    // The request is sent as text/plain on purpose: a JSON content type would
    // trigger a preflight OPTIONS check, and Apps Script cannot answer one.
    var raw = e && e.postData ? e.postData.contents : '';
    var body;
    try {
      body = JSON.parse(raw || '{}');
    } catch (parseError) {
      throw new Error('The request body was not valid JSON.');
    }

    authorize_(body.code);

    // Uploads run outside the write lock on purpose: a photo takes seconds on
    // a slow uplink, touches Drive rather than the spreadsheet, and holding
    // the lock for it would starve every row save queued behind it.
    if (body.action === 'uploadPhoto') return uploadPhoto_(body);

    // One lock around every write. Two saves racing would otherwise both read
    // the same last row and one would overwrite the other.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) {
      throw new Error('The sheet is busy with another save. Try again in a moment.');
    }

    try {
      switch (body.action) {
        case 'upsertRow':    return upsertRow_(body);
        case 'deleteRow':    return deleteRow_(body);
        case 'setSetting':   return setSetting_(body);
        default:
          throw new Error('Unknown action "' + (body.action || '') + '". Expected upsertRow, deleteRow, setSetting or uploadPhoto.');
      }
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * Every response is JSON and every failure is a readable message. An
 * uncaught throw would return Google's HTML error page, which the app cannot
 * parse and would report as a mystery network failure.
 */
function handle_(work) {
  var payload;
  try {
    var result = work();
    payload = { ok: true, data: result };
  } catch (error) {
    payload = { ok: false, error: (error && error.message) ? error.message : String(error) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ *
 * Access
 * ------------------------------------------------------------------ */

/**
 * The web app is published to "Anyone", because a browser cannot sign in to
 * Google without shipping a credential. The address is unlisted rather than
 * secret, so this shared code is what actually keeps strangers out.
 */
function authorize_(supplied) {
  // A Script Property wins when one is set, so the code can be rotated without
  // editing and re-deploying this file. Absent one, the built-in is used and
  // the script works the moment it is pasted in.
  var expected =
    PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') || BUILT_IN_ACCESS_CODE;

  if (!supplied || !constantTimeEquals_(String(supplied), expected)) {
    throw new Error('Wrong or missing access code.');
  }
}

/** Compares in fixed time so the code cannot be guessed a character at a time. */
function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

function book_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheetNamed_(name) {
  // Trips is the app's own tab rather than one of the original spreadsheet's,
  // so a sheet that has never had a trip saved to it simply doesn't have it
  // yet. Creating it here means the first trip works with nothing to set up.
  if (name === TRIPS_TAB) return ensureTripsTab_();

  var sheet = book_().getSheetByName(name);
  if (!sheet) throw new Error('The tab "' + name + '" is missing from this spreadsheet.');
  return sheet;
}

/**
 * The Trips tab, made if it isn't there.
 *
 * Laid out like every other tab in this spreadsheet — a title on row 1, a
 * description on row 2, headers on row 3 — so the same header-row rules apply
 * and a person reading the file sees one consistent shape. Nothing else in the
 * spreadsheet is touched, and an existing Trips tab is returned untouched:
 * this never rewrites headers someone may have added to.
 */
function ensureTripsTab_() {
  var book = book_();
  var sheet = book.getSheetByName(TRIPS_TAB);
  if (sheet) return sheet;

  sheet = book.insertSheet(TRIPS_TAB);
  sheet.getRange(1, 1).setValue('Trips');
  sheet.getRange(2, 1).setValue(
    'One row per trip. A place joins a trip through its "Trip ID / Collection" cell on Places.'
  );
  sheet.getRange(3, 1, 1, TRIPS_HEADERS.length).setValues([TRIPS_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(3);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(5, 320);
  return sheet;
}

/**
 * Reads a whole tab as headers plus rows.
 *
 * Values come back raw, not display-formatted, so a number stays a number and
 * a date stays a date — then dates are flattened to strings the browser can
 * read back without a timezone shifting them by a day.
 */
function readTab_(name, headerRow) {
  var sheet = sheetNamed_(name);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0 || lastRow < headerRow) return { headers: [], rows: [] };

  var headers = sheet.getRange(headerRow, 1, 1, lastColumn).getValues()[0]
    .map(function (value) { return String(value == null ? '' : value).trim(); });

  var dataRows = lastRow - headerRow;
  if (dataRows < 1) return { headers: headers, rows: [] };

  var values = sheet.getRange(headerRow + 1, 1, dataRows, lastColumn).getValues();

  var rows = [];
  for (var i = 0; i < values.length; i++) {
    if (isBlankRow_(values[i])) continue;
    rows.push(values[i].map(serializeCell_));
  }
  return { headers: headers, rows: rows };
}

function isBlankRow_(row) {
  for (var i = 0; i < row.length; i++) {
    if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return false;
  }
  return true;
}

/**
 * A Date read out of a cell would serialise to a UTC instant, which lands on
 * the previous day for anyone east of Greenwich. Calendar dates are therefore
 * emitted as the plain YYYY-MM-DD the sheet displays.
 */
function serializeCell_(value) {
  if (value instanceof Date) {
    var hasTime = value.getHours() || value.getMinutes() || value.getSeconds();
    return hasTime
      ? Utilities.formatDate(value, timezone_(), "yyyy-MM-dd'T'HH:mm:ss")
      : Utilities.formatDate(value, timezone_(), 'yyyy-MM-dd');
  }
  return value;
}

var TIMEZONE_CACHE = null;
function timezone_() {
  if (!TIMEZONE_CACHE) TIMEZONE_CACHE = book_().getSpreadsheetTimeZone() || 'UTC';
  return TIMEZONE_CACHE;
}

/**
 * The bookkeeping columns every writable tab needs — the script's derived
 * timestamps, and the Deleted? flag a soft delete sets. The original
 * spreadsheet shipped Dates_Visits and Media_Links without them, because
 * nothing wrote there; now the app does, missing ones are appended after the
 * last existing column, headers only, touching nothing else.
 */
var BOOKKEEPING_COLUMNS = [
  'Created At', 'Updated At', 'Last Synced At', 'Sync Version', 'Archived?', 'Deleted?'
];

function ensureBookkeepingColumns_() {
  var names = ['Dates_Visits', 'Media_Links'];
  for (var i = 0; i < names.length; i++) {
    var sheet = book_().getSheetByName(names[i]);
    if (!sheet) continue;

    var headerRow = TABS[names[i]].header;
    var index = headerIndex_(sheet, headerRow);
    var missing = [];
    for (var j = 0; j < BOOKKEEPING_COLUMNS.length; j++) {
      if (index.map[BOOKKEEPING_COLUMNS[j]] === undefined) missing.push(BOOKKEEPING_COLUMNS[j]);
    }
    if (missing.length === 0) continue;

    var start = Math.max(sheet.getLastColumn(), 1) + 1;
    var needed = start + missing.length - 1 - sheet.getMaxColumns();
    if (needed > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed);
    sheet.getRange(headerRow, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
}

/** One request, every data tab. Startup makes exactly this call. */
function getAll_() {
  // Before the loop, because the loop reads Trips and a missing tab throws.
  ensureTripsTab_();
  ensureBookkeepingColumns_();

  var tabs = {};
  for (var name in TABS) {
    if (!TABS.hasOwnProperty(name)) continue;
    tabs[name] = readTab_(name, TABS[name].header);
  }

  ensureSettingsTab_();

  return {
    tabs: tabs,
    lookups: readLookups_(),
    settings: readSettings_(),
    schemaVersion: SCHEMA_VERSION,
    capabilities: capabilities_(),
    serverTime: nowStamp_()
  };
}

/**
 * What this deployment can do beyond reading and writing rows, so the app can
 * offer a better search when there is one and never advertise one there isn't.
 * photoUpload is a fact about this version of the script rather than a key:
 * an older deployment simply never says it, and photos stay in the browser.
 */
function capabilities_() {
  return { placesSearch: Boolean(placesKey_()), photoUpload: true };
}

/**
 * The dropdown lists, read as columns: each header in the Lookups header row
 * names a list, and the non-empty cells beneath it are its values. Editing
 * that tab changes the app's dropdowns with no code change.
 */
function readLookups_() {
  var table = readTab_(LOOKUPS_TAB, LOOKUPS_HEADER_ROW);
  var lookups = {};

  for (var column = 0; column < table.headers.length; column++) {
    var name = table.headers[column];
    if (!name) continue;

    var values = [];
    for (var row = 0; row < table.rows.length; row++) {
      var cell = table.rows[row][column];
      var text = cell == null ? '' : String(cell).trim();
      if (text && values.indexOf(text) === -1) values.push(text);
    }
    lookups[name] = values;
  }
  return lookups;
}

/* ------------------------------------------------------------------ *
 * Google Places search — the key never leaves this script
 * ------------------------------------------------------------------ */

function placesKey_() {
  return PropertiesService.getScriptProperties().getProperty(PLACES_KEY_PROPERTY) || '';
}

/**
 * One Text Search call, turned into the shape the app already draws.
 *
 * Text Search rather than Autocomplete on purpose: Autocomplete returns
 * predictions with no coordinates, so every tap would need a second billable
 * Place Details call before the pin could be placed. Text Search answers the
 * whole question at once — name, address, coordinates and country — which is
 * both cheaper and one round trip instead of two.
 */
function searchPlaces_(params) {
  var key = placesKey_();
  if (!key) {
    throw new Error(
      'No Google Maps API key is set on this script, so Places search is off. ' +
      'Add a GOOGLE_MAPS_API_KEY script property to switch it on.'
    );
  }

  var query = String(params.q || '').trim();
  if (query.length < 2) return { places: [], source: 'google' };

  var body = { textQuery: query, maxResultCount: 8 };

  var language = String(params.lang || '').trim();
  if (/^[a-z]{2}$/i.test(language)) body.languageCode = language.toLowerCase();

  // Biasing toward what is on screen is what separates the Springfield you
  // meant from the eleven you didn't.
  var lat = parseFloat(params.lat);
  var lng = parseFloat(params.lng);
  if (!isNaN(lat) && !isNaN(lng)) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 50000 }
    };
  }

  var cacheKey = 'places:' + Utilities.base64Encode(JSON.stringify(body)).slice(0, 200);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (parseError) {
      // A corrupt entry is not worth failing a search over.
    }
  }

  var response = UrlFetchApp.fetch(PLACES_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACES_FIELDS },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code !== 200) {
    // Google's own message is far more useful than "search failed" — a key
    // that is restricted, unbilled or missing the API all say so precisely.
    var detail = '';
    try {
      detail = (JSON.parse(text).error || {}).message || '';
    } catch (parseError) {
      detail = '';
    }
    throw new Error('Google Places refused the search (' + code + ')' + (detail ? ': ' + detail : '.'));
  }

  var payload;
  try {
    payload = JSON.parse(text);
  } catch (parseError) {
    throw new Error('Google Places sent back something unreadable.');
  }

  var result = { places: (payload.places || []).map(toPlaceResult_), source: 'google' };
  try {
    cache.put(cacheKey, JSON.stringify(result), PLACES_CACHE_SECONDS);
  } catch (cacheError) {
    // Caching is an optimisation, never a reason to fail.
  }
  return result;
}

/** Pulls one component out of Places' address parts, by its type. */
function addressPart_(components, type, useShort) {
  for (var i = 0; i < (components || []).length; i++) {
    var part = components[i];
    if ((part.types || []).indexOf(type) !== -1) {
      return useShort ? part.shortText : part.longText;
    }
  }
  return '';
}

function toPlaceResult_(place) {
  var components = place.addressComponents || [];
  var location = place.location || {};

  return {
    id: place.id || '',
    name: (place.displayName || {}).text || '',
    address: place.formattedAddress || '',
    latitude: location.latitude,
    longitude: location.longitude,
    // locality first, then the two fallbacks Google uses where there is no
    // formal city — a district, or the smallest administrative area.
    city:
      addressPart_(components, 'locality', false) ||
      addressPart_(components, 'postal_town', false) ||
      addressPart_(components, 'administrative_area_level_2', false),
    region: addressPart_(components, 'administrative_area_level_1', false),
    country: addressPart_(components, 'country', false),
    countryCode: addressPart_(components, 'country', true),
    types: place.types || []
  };
}

/* ------------------------------------------------------------------ *
 * Photo upload — the browser's photos, filed in the owner's Drive
 *
 * A static site cannot hold files and a spreadsheet cell cannot hold an
 * image, so photos go to the one place this script can put them that every
 * device can read back: a folder in the sheet owner's Drive. The app sends
 * the photo as base64, this script files it and answers with a link, and the
 * link goes into the sheet like any other cell.
 *
 * NOTE: this is the script's first use of DriveApp, so publishing this
 * version asks the owner to authorize Drive access once. The files it
 * creates are shared "anyone with the link, view only" — the same standing
 * the sheet's own access model already accepts for the data itself.
 * ------------------------------------------------------------------ */

var PHOTOS_FOLDER_PROPERTY = 'PHOTOS_FOLDER_ID';
var PHOTOS_FOLDER_NAME = 'Travel Globe Photos';
/** On the decoded bytes. The app downsizes to ~1600px first, so a photo that
 * still exceeds this is not a photo the app sent. */
var MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function photosFolder_() {
  var properties = PropertiesService.getScriptProperties();
  var savedId = properties.getProperty(PHOTOS_FOLDER_PROPERTY);
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (error) {
      // The folder was deleted; fall through and make a fresh one.
    }
  }

  var existing = DriveApp.getFoldersByName(PHOTOS_FOLDER_NAME);
  var folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(PHOTOS_FOLDER_NAME);
  properties.setProperty(PHOTOS_FOLDER_PROPERTY, folder.getId());
  return folder;
}

function uploadPhoto_(body) {
  var mimeType = String(body.mimeType || 'image/jpeg');
  if (mimeType.indexOf('image/') !== 0) {
    throw new Error('Only images can be uploaded.');
  }

  var data = String(body.data || '');
  if (!data) throw new Error('The upload carried no photo data.');

  var bytes;
  try {
    bytes = Utilities.base64Decode(data);
  } catch (error) {
    throw new Error('The photo data was not readable.');
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Error('That photo is too large to upload.');
  }

  var name = String(body.name || 'photo.jpg').replace(/[\\\/:*?"<>|]/g, ' ').slice(0, 100).trim();
  var blob = Utilities.newBlob(bytes, mimeType, name || 'photo.jpg');

  var file = photosFolder_().createFile(blob);
  // Anyone with the link can view — the link lives in a spreadsheet cell and
  // every device that reads the sheet has to be able to render it.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // lh3.googleusercontent.com serves the raw image bytes for a shared Drive
  // file, which is what an <img> tag needs; the drive.google.com viewer URL
  // serves a web page instead.
  return {
    url: 'https://lh3.googleusercontent.com/d/' + file.getId(),
    fileId: file.getId()
  };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

function assertWritable_(name) {
  if (READ_ONLY_TABS.indexOf(name) !== -1) {
    throw new Error(
      'The tab "' + name + '" is built from live formulas and is never written to.'
    );
  }
  if (!TABS.hasOwnProperty(name)) {
    throw new Error('The tab "' + name + '" is not one this app writes to.');
  }
}

/**
 * Creates or updates one row, identified by its ID column.
 *
 * The client sends only the fields a person edited, by header name. Every
 * other cell is read from the sheet, kept in memory and written straight back
 * — so a column the app has no screen for survives untouched, and inserting a
 * column can never shift a value into the wrong field.
 */
function upsertRow_(body) {
  var name = String(body.tab || '');
  assertWritable_(name);

  var config = TABS[name];
  var sheet = sheetNamed_(name);
  var index = headerIndex_(sheet, config.header);
  var width = Math.max(sheet.getLastColumn(), 1);

  var idColumn = requireColumn_(index, config.idColumn, name);
  var id = body.id ? String(body.id).trim() : '';
  var rowNumber = id ? findRowById_(sheet, config, idColumn, id) : 0;
  var isNew = rowNumber === 0;

  var values;
  if (isNew) {
    values = blankRow_(width);
    if (!id) id = nextId_(sheet, config, idColumn);
    values[idColumn] = id;
    rowNumber = firstFreeRow_(sheet, config);
  } else {
    values = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
  }

  applyFields_(values, index, body.fields || {}, name);
  applyDerived_(name, values, index, isNew);

  // One setValues for the whole row. A call per cell would burn through the
  // per-minute quota on a single save.
  sheet.getRange(rowNumber, 1, 1, width).setValues([values]);

  appendLog_(name, id, isNew ? 'create' : 'update', 'ok');

  return {
    id: id,
    row: values.map(serializeCell_),
    headers: index.headers,
    rowNumber: rowNumber
  };
}

/**
 * Soft delete, always. Removing the row would shift every row beneath it and
 * break the formulas on Search_View and Dashboard that point at fixed ranges.
 */
function deleteRow_(body) {
  var name = String(body.tab || '');
  assertWritable_(name);

  var config = TABS[name];
  var sheet = sheetNamed_(name);
  var index = headerIndex_(sheet, config.header);
  var width = Math.max(sheet.getLastColumn(), 1);

  var idColumn = requireColumn_(index, config.idColumn, name);
  var id = String(body.id || '').trim();
  if (!id) throw new Error('A delete needs the record id.');

  var rowNumber = findRowById_(sheet, config, idColumn, id);
  if (rowNumber === 0) {
    // Already gone is the outcome the caller wanted; a retry of a delete that
    // already landed must not fail.
    appendLog_(name, id, 'delete', 'missing');
    return { id: id, deleted: true, missing: true };
  }

  var values = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];

  var deletedColumn = index.map['Deleted?'];
  if (deletedColumn === undefined) {
    throw new Error('The tab "' + name + '" has no "Deleted?" column, so nothing can be soft-deleted there.');
  }
  values[deletedColumn] = 'Yes';

  applyDerived_(name, values, index, false);
  sheet.getRange(rowNumber, 1, 1, width).setValues([values]);

  appendLog_(name, id, 'delete', 'ok');
  return { id: id, deleted: true, row: values.map(serializeCell_), headers: index.headers };
}

/**
 * Copies the supplied fields onto the row by header name.
 *
 * An unknown header is refused rather than ignored: silently dropping it would
 * let a typo look like a successful save.
 */
function applyFields_(values, index, fields, tabName) {
  for (var header in fields) {
    if (!fields.hasOwnProperty(header)) continue;
    if (DERIVED_COLUMNS.indexOf(header) !== -1) continue;

    var column = index.map[header];
    if (column === undefined) {
      throw new Error('The tab "' + tabName + '" has no column named "' + header + '".');
    }
    var value = fields[header];
    values[column] = (value === null || value === undefined) ? '' : value;
  }
}

/**
 * The columns this script owns. Doing it here rather than in the browser is
 * what guarantees Search Text, Coordinate Key and the timestamps stay correct
 * even when a write comes from an older copy of the app.
 */
function applyDerived_(tabName, values, index, isNew) {
  var stamp = nowStamp_();
  var map = index.map;

  if (map['Created At'] !== undefined && (isNew || !String(values[map['Created At']] || '').trim())) {
    values[map['Created At']] = stamp;
  }
  if (map['Updated At'] !== undefined)     values[map['Updated At']] = stamp;
  if (map['Last Synced At'] !== undefined) values[map['Last Synced At']] = stamp;

  if (map['Sync Version'] !== undefined) {
    var version = parseInt(values[map['Sync Version']], 10);
    values[map['Sync Version']] = (isNaN(version) || version < 1) ? 1 : version + 1;
  }

  // "Yes"/"No" throughout, never true/false — matching what is already there.
  if (map['Archived?'] !== undefined && !String(values[map['Archived?']] || '').trim()) {
    values[map['Archived?']] = 'No';
  }
  if (map['Deleted?'] !== undefined && !String(values[map['Deleted?']] || '').trim()) {
    values[map['Deleted?']] = 'No';
  }

  applyCoordinates_(values, map);

  var sources = SEARCH_TEXT_SOURCES[tabName];
  if (sources && map['Search Text'] !== undefined) {
    values[map['Search Text']] = buildSearchText_(values, map, sources);
  }
}

/** Coordinate Key and Map URL are derived, so they can never drift from lat/lng. */
function applyCoordinates_(values, map) {
  if (map['Latitude'] === undefined || map['Longitude'] === undefined) return;

  var latitude = parseFloat(values[map['Latitude']]);
  var longitude = parseFloat(values[map['Longitude']]);
  if (isNaN(latitude) || isNaN(longitude)) return;

  // Six decimals, matching the existing rows — about 10cm, far finer than any
  // of this matters, but it keeps the key stable and comparable.
  var lat = latitude.toFixed(6);
  var lng = longitude.toFixed(6);

  values[map['Latitude']] = lat;
  values[map['Longitude']] = lng;

  if (map['Coordinate Key'] !== undefined) values[map['Coordinate Key']] = lat + ',' + lng;
  if (map['Map URL'] !== undefined) {
    values[map['Map URL']] = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
  }
}

/** Lowercase, single-spaced, in the sheet's own field order. */
function buildSearchText_(values, map, sources) {
  var parts = [];
  for (var i = 0; i < sources.length; i++) {
    var column = map[sources[i]];
    if (column === undefined) continue;
    var text = values[column];
    if (text instanceof Date) text = serializeCell_(text);
    text = String(text == null ? '' : text).trim();
    if (text) parts.push(text);
  }
  return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Row lookup and ids
 * ------------------------------------------------------------------ */

/**
 * Header text to column position, built fresh on every request.
 *
 * Places has 78 columns. Reading them by position would mean that inserting
 * one column silently writes every value into its neighbour's field, so
 * positions are never assumed — they are looked up by name, every time.
 */
function headerIndex_(sheet, headerRow) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(headerRow, 1, 1, width).getValues()[0]
    .map(function (value) { return String(value == null ? '' : value).trim(); });

  var map = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] && map[headers[i]] === undefined) map[headers[i]] = i;
  }
  return { headers: headers, map: map };
}

function requireColumn_(index, header, tabName) {
  var column = index.map[header];
  if (column === undefined) {
    throw new Error('The tab "' + tabName + '" has no "' + header + '" column.');
  }
  return column;
}

function findRowById_(sheet, config, idColumn, id) {
  var lastRow = sheet.getLastRow();
  var firstData = config.header + 1;
  if (lastRow < firstData) return 0;

  var ids = sheet.getRange(firstData, idColumn + 1, lastRow - config.header, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return firstData + i;
  }
  return 0;
}

/**
 * Highest existing number plus one — never a count, and never reused. A gap
 * left by a soft-deleted row stays a gap, because its id still belongs to it.
 */
function nextId_(sheet, config, idColumn) {
  var lastRow = sheet.getLastRow();
  var firstData = config.header + 1;
  var highest = 0;

  if (lastRow >= firstData) {
    var ids = sheet.getRange(firstData, idColumn + 1, lastRow - config.header, 1).getValues();
    var pattern = new RegExp('^' + config.prefix + '-(\\d+)$', 'i');
    for (var i = 0; i < ids.length; i++) {
      var match = pattern.exec(String(ids[i][0]).trim());
      if (match) {
        var value = parseInt(match[1], 10);
        if (value > highest) highest = value;
      }
    }
  }

  var next = String(highest + 1);
  while (next.length < config.pad) next = '0' + next;
  return config.prefix + '-' + next;
}

/** The first row with no id, so a new record fills a gap before extending. */
function firstFreeRow_(sheet, config) {
  return Math.max(sheet.getLastRow() + 1, config.header + 1);
}

function blankRow_(width) {
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  return row;
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), timezone_(), "yyyy-MM-dd'T'HH:mm:ss");
}

/* ------------------------------------------------------------------ *
 * App_Settings and Sync_Log — the only two tabs this script may create
 * ------------------------------------------------------------------ */

function ensureSettingsTab_() {
  var book = book_();
  var sheet = book.getSheetByName(SETTINGS_TAB);
  if (sheet) return sheet;

  sheet = book.insertSheet(SETTINGS_TAB);
  sheet.getRange(1, 1).setValue('App Settings');
  sheet.getRange(2, 1).setValue('Key/value settings the travel app reads at startup. Safe to edit.');
  sheet.getRange(3, 1, 1, 2).setValues([['Key', 'Value']]).setFontWeight('bold');
  sheet.getRange(4, 1, 4, 2).setValues([
    ['Schema Version', SCHEMA_VERSION],
    ['Default Currency', 'USD'],
    ['Default Map Center', '20,0'],
    ['Last Full Sync At', '']
  ]);
  sheet.setFrozenRows(3);
  return sheet;
}

function readSettings_() {
  var sheet = ensureSettingsTab_();
  var lastRow = sheet.getLastRow();
  var settings = {};
  if (lastRow < 4) return settings;

  var values = sheet.getRange(4, 1, lastRow - 3, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) settings[key] = serializeCell_(values[i][1]);
  }
  return settings;
}

function setSetting_(body) {
  var key = String(body.key || '').trim();
  if (!key) throw new Error('A setting needs a key.');
  var value = body.value == null ? '' : body.value;

  var sheet = ensureSettingsTab_();
  var lastRow = sheet.getLastRow();

  if (lastRow >= 4) {
    var keys = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sheet.getRange(4 + i, 2).setValue(value);
        return { key: key, value: value };
      }
    }
  }

  sheet.getRange(Math.max(lastRow + 1, 4), 1, 1, 2).setValues([[key, value]]);
  return { key: key, value: value };
}

function ensureLogTab_() {
  var book = book_();
  var sheet = book.getSheetByName(LOG_TAB);
  if (sheet) return sheet;

  sheet = book.insertSheet(LOG_TAB);
  sheet.getRange(1, 1).setValue('Sync Log');
  sheet.getRange(2, 1).setValue('Append-only record of what the app wrote. Trimmed to the most recent ' + LOG_MAX_ROWS + ' entries.');
  sheet.getRange(3, 1, 1, 5).setValues([['Timestamp', 'Tab', 'Record ID', 'Action', 'Result']]).setFontWeight('bold');
  sheet.setFrozenRows(3);
  return sheet;
}

/**
 * Logging must never be the reason a save fails, so every failure here is
 * swallowed — the write it describes has already landed.
 */
function appendLog_(tab, id, action, result) {
  try {
    var sheet = ensureLogTab_();
    sheet.appendRow([nowStamp_(), tab, id, action, result]);

    var lastRow = sheet.getLastRow();
    var entries = lastRow - 3;
    if (entries > LOG_MAX_ROWS) {
      // Oldest first, so the oldest entries are the ones just under the header.
      sheet.deleteRows(4, entries - LOG_TRIM_TO);
    }
  } catch (error) {
    // Intentionally ignored.
  }
}

/* ------------------------------------------------------------------ *
 * Run this once from the editor to check the wiring before deploying.
 * ------------------------------------------------------------------ */

function selfTest() {
  var override = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  Logger.log(
    override
      ? 'Access code: using the ACCESS_CODE script property.'
      : 'Access code: using the one built into this file. Nothing to set up.'
  );

  Logger.log(
    placesKey_()
      ? 'Google Places search: on (a GOOGLE_MAPS_API_KEY property is set).'
      : 'Google Places search: off. The app will use its keyless geocoder.'
  );

  ensureTripsTab_();

  for (var name in TABS) {
    if (!TABS.hasOwnProperty(name)) continue;
    var table = readTab_(name, TABS[name].header);
    Logger.log(name + ': ' + table.headers.length + ' columns, ' + table.rows.length + ' rows');
  }

  var lookups = readLookups_();
  for (var list in lookups) {
    if (lookups.hasOwnProperty(list)) Logger.log('Lookup ' + list + ': ' + lookups[list].join(', '));
  }
  Logger.log('Settings: ' + JSON.stringify(readSettings_()));
}
