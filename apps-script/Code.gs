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
  Trips:           { header: 3, idColumn: 'Trip ID',           prefix: 'TRIP',  pad: 4 },
  // One row per cloud photo: the Google Photos identity it came from, the
  // visit/trip it belongs to, and the Drive files its renditions live in.
  // Created by this script if the tab is not there yet.
  Travel_Photos:   { header: 3, idColumn: 'Photo ID',          prefix: 'TPHOTO', pad: 4 }
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

var TRAVEL_PHOTOS_TAB = 'Travel_Photos';
var TRAVEL_PHOTOS_HEADERS = [
  'Photo ID', 'Google Photos Item ID', 'Place ID', 'Visit ID', 'Trip ID',
  'Taken At', 'Filename', 'MIME Type', 'Width', 'Height',
  'Thumb Drive File ID', 'Display Drive File ID', 'Video Drive File ID',
  'Source', 'Sort Order',
  'Created At', 'Updated At', 'Last Synced At', 'Sync Version', 'Archived?', 'Deleted?'
];

var SETTINGS_TAB = 'App_Settings';
var LOG_TAB = 'Sync_Log';
var LOG_MAX_ROWS = 1000;
var LOG_TRIM_TO = 900;

var SCHEMA_VERSION = '4';

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

var PLACE_DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places/';

/**
 * What one card shows about the listing. Places (New) bills a request at the
 * highest tier any field belongs to; rating, hours, website and phone put
 * this call in the Enterprise tier (1,000 free a month), and the cheaper-tier
 * fields ride along in the same call at no extra cost. Reviews and editorial
 * text are deliberately absent — they'd move the call to a still higher tier
 * and carry display obligations the card doesn't want.
 */
var PLACE_DETAILS_FIELDS = [
  'id',
  'businessStatus',
  'displayName',
  'primaryTypeDisplayName',
  'googleMapsUri',
  'utcOffsetMinutes',
  'shortFormattedAddress',
  'rating',
  'userRatingCount',
  'currentOpeningHours',
  'websiteUri',
  'nationalPhoneNumber',
  'internationalPhoneNumber'
].join(',');

/**
 * Opening a card twice in an afternoon should bill once. Six hours is
 * CacheService's ceiling, still fresh enough for "open now", and far inside
 * the 30 days Google's terms allow for cached content.
 */
var PLACE_DETAILS_CACHE_SECONDS = 21600;

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
  var params = (e && e.parameter) || {};

  // Google's OAuth redirect lands here with ?code=&state= and no action of
  // ours. It cannot carry the access code — Google is the caller — so the
  // state token, minted by photosAuthStart and single-use, is what proves the
  // request belongs to a connection this script started. Answered as HTML,
  // because a person is looking at it.
  if (!params.action && params.state) {
    return photosAuthCallback_(params);
  }

  return handle_(function () {
    authorize_(params.code);

    switch (params.action) {
      case 'getAll':        return getAll_();
      case 'getLookups':    return { lookups: readLookups_() };
      case 'searchPlaces':  return searchPlaces_(params);
      case 'placeDetails':  return placeDetails_(params);
      case 'photosAuthStatus':      return photosAuthStatus_();
      case 'getPhotoPickerSession': return getPhotoPickerSession_(params);
      case 'getPickedPhotoPreview': return getPickedPhotoPreview_(params);
      case 'getTravelPhoto':        return getTravelPhoto_(params);
      case 'ping':
        return { ok: true, schemaVersion: SCHEMA_VERSION, capabilities: capabilities_() };
      default:
        throw new Error(
          'Unknown action "' + (params.action || '') +
          '". Expected getAll, getLookups, searchPlaces, placeDetails, ' +
          'photosAuthStatus, getPhotoPickerSession, getTravelPhoto or ping.'
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

    // The Google Photos actions also run outside the lock: OAuth and Picker
    // calls talk to Google rather than the spreadsheet, and the import takes
    // it internally only for the seconds it spends writing rows.
    switch (body.action) {
      case 'photosAuthStart':          return photosAuthStart_();
      case 'photosAuthDisconnect':     return photosAuthDisconnect_();
      case 'createPhotoPickerSession': return createPhotoPickerSession_(body);
      case 'listPickedPhotos':         return listPickedPhotos_(body);
      case 'deletePhotoPickerSession': return deletePhotoPickerSession_(body);
      case 'importPickedPhotos':       return importPickedPhotos_(body);
      case 'uploadTravelMedia':        return uploadTravelMedia_(body);
      case 'deleteTravelPhoto':        return deleteTravelPhoto_(body);
    }

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
  // Trips and Travel_Photos are the app's own tabs rather than the original
  // spreadsheet's, so a sheet that has never needed one simply doesn't have
  // it yet. Creating them here means the first use works with nothing to set
  // up.
  if (name === TRIPS_TAB) return ensureTripsTab_();
  if (name === TRAVEL_PHOTOS_TAB) return ensureTravelPhotosTab_();

  var sheet = book_().getSheetByName(name);
  if (!sheet) throw new Error('The tab "' + name + '" is missing from this spreadsheet.');
  return sheet;
}

/**
 * The Travel_Photos tab, made if it isn't there — same shape as every tab
 * here: title, description, headers on row 3. An existing tab is returned
 * untouched, custom columns and all; only the columns this script actually
 * writes are ever required of it.
 */
function ensureTravelPhotosTab_() {
  var book = book_();
  var sheet = book.getSheetByName(TRAVEL_PHOTOS_TAB);
  if (sheet) return sheet;

  sheet = book.insertSheet(TRAVEL_PHOTOS_TAB);
  sheet.getRange(1, 1).setValue('Travel Photos');
  sheet.getRange(2, 1).setValue(
    'One row per photo imported from Google Photos. The image files live in the private ' +
    'Drive folder; these rows are the metadata the app reads. Do not paste Drive links here.'
  );
  sheet.getRange(3, 1, 1, TRAVEL_PHOTOS_HEADERS.length)
    .setValues([TRAVEL_PHOTOS_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(3);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(7, 200);
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
  // Places predates the bookkeeping set, but a sheet made from an early copy
  // of the template can be missing Google Place ID — and a write naming a
  // column the tab lacks fails loudly by design. Appending it here means the
  // fix is "update the script", not "edit your spreadsheet by hand".
  var wanted = {
    'Dates_Visits': BOOKKEEPING_COLUMNS,
    'Media_Links': BOOKKEEPING_COLUMNS,
    'Places': ['Google Place ID']
  };
  for (var name in wanted) {
    if (!wanted.hasOwnProperty(name)) continue;
    var sheet = book_().getSheetByName(name);
    if (!sheet) continue;

    var headerRow = TABS[name].header;
    var index = headerIndex_(sheet, headerRow);
    var columns = wanted[name];
    var missing = [];
    for (var j = 0; j < columns.length; j++) {
      if (index.map[columns[j]] === undefined) missing.push(columns[j]);
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
  ensureTravelPhotosTab_();
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
  return {
    placesSearch: Boolean(placesKey_()),
    // Same key, different call: the card's Google Maps section. Named on its
    // own so an app new enough to ask never asks a script too old to answer.
    placeDetails: Boolean(placesKey_()),
    photoUpload: true,
    // Individual Dates_Visits rows and the Travel_Photos tab both ride in
    // getAll from this version on.
    visits: true,
    travelPhotos: true,
    // The Picker needs no credentials configured: the script's own
    // authorisation is the default way in, and the flow itself walks
    // through the one-time fixes — the manifest scope, or the Cloud
    // project's API switch — when a call bounces off either.
    googlePhotosPicker: true,
    // Whether an import could plausibly run right now — a live
    // OAuth-client connection, or the script's own token carrying the
    // Picker scope — so the app can say "connect" vs "add photos" without
    // a second round trip. Deliberately cheap: this rides the scope cache
    // and skips the API-enablement probe, because getAll is the startup
    // path; photosAuthStatus is the authority the picker flow consults
    // before actually opening anything.
    googlePhotosConnected: photosOauthClientLive_() || scriptPhotosScopeGranted_(),
    // Photos and videos picked straight from a device or Drive folder can be
    // stored in Travel_Photos from this version on.
    deviceMediaUpload: true
  };
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

/**
 * One listing, by the id the app saved when the place was added.
 *
 * Serves the card's "Google Maps" section: rating, hours, address, website,
 * phone. Cached hard because the same card gets opened again and again, and
 * every miss is a billable call. Nothing from here is ever written to the
 * sheet — Google's terms allow storing the id, not the content.
 */
function placeDetails_(params) {
  var key = placesKey_();
  if (!key) {
    throw new Error(
      'No Google Maps API key is set on this script, so place details are off. ' +
      'Add a GOOGLE_MAPS_API_KEY script property to switch them on.'
    );
  }

  var id = String(params.id || '').trim();
  // Real ids are letter-number strings like ChIJ…; anything else is refused
  // before it can reach the URL path.
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) {
    throw new Error('That does not look like a Google place id.');
  }

  var url = PLACE_DETAILS_ENDPOINT + encodeURIComponent(id);
  var language = String(params.lang || '').trim();
  if (/^[a-z]{2}$/i.test(language)) url += '?languageCode=' + language.toLowerCase();

  var cacheKey = 'placeDetails:' + id + ':' + language.toLowerCase();
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (parseError) {
      // A corrupt entry is not worth failing the card over.
    }
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACE_DETAILS_FIELDS },
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code !== 200) {
    var detail = '';
    try {
      detail = (JSON.parse(text).error || {}).message || '';
    } catch (parseError) {
      detail = '';
    }
    throw new Error('Google Places refused the lookup (' + code + ')' + (detail ? ': ' + detail : '.'));
  }

  var payload;
  try {
    payload = JSON.parse(text);
  } catch (parseError) {
    throw new Error('Google Places sent back something unreadable.');
  }

  // Already shaped by the field mask; passed through as one object so the
  // app's own mapping decides what a card shows.
  var result = { place: payload, source: 'google' };
  try {
    cache.put(cacheKey, JSON.stringify(result), PLACE_DETAILS_CACHE_SECONDS);
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
      var saved = DriveApp.getFolderById(savedId);
      // getFolderById happily returns a folder sitting in the trash, and a
      // photo filed there vanishes with the trash. Treat it as gone.
      if (!saved.isTrashed()) return saved;
    } catch (error) {
      // The folder was deleted outright; fall through and make a fresh one.
    }
  }

  // Uploads skip the write lock, so two first-ever uploads could race each
  // other here and mint two folders. Creation alone takes the lock; once the
  // property is set, this branch is never reached again.
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(10000);
  try {
    var refreshed = properties.getProperty(PHOTOS_FOLDER_PROPERTY);
    if (refreshed && refreshed !== savedId) {
      try {
        var winner = DriveApp.getFolderById(refreshed);
        if (!winner.isTrashed()) return winner;
      } catch (error) {
        // Fall through to creation.
      }
    }

    var existing = DriveApp.getFoldersByName(PHOTOS_FOLDER_NAME);
    var folder = null;
    while (existing.hasNext()) {
      var candidate = existing.next();
      if (!candidate.isTrashed()) { folder = candidate; break; }
    }
    if (!folder) folder = DriveApp.createFolder(PHOTOS_FOLDER_NAME);
    properties.setProperty(PHOTOS_FOLDER_PROPERTY, folder.getId());
    return folder;
  } finally {
    if (locked) lock.releaseLock();
  }
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
  // every device that reads the sheet has to be able to render it. A
  // Workspace domain can forbid link sharing; an unshareable photo is useless
  // to the other devices, so the file is withdrawn rather than orphaned and
  // the app is told plainly why.
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sharingError) {
    try {
      file.setTrashed(true);
    } catch (cleanupError) {
      // The upload already failed; the trash attempt was best effort.
    }
    throw new Error(
      'Drive refused to share the photo by link, so other devices could never load it. ' +
      'Check the Google account\'s sharing settings.'
    );
  }

  // lh3.googleusercontent.com serves the raw image bytes for a shared Drive
  // file, which is what an <img> tag needs; the drive.google.com viewer URL
  // serves a web page instead.
  return {
    url: 'https://lh3.googleusercontent.com/d/' + file.getId(),
    fileId: file.getId()
  };
}

/* ------------------------------------------------------------------ *
 * Google Photos — authorisation
 *
 * Two ways in, and the browser never sees a token under either:
 *
 * 1. The script's own authorisation (the default). The web app already
 *    runs as the sheet owner, and when the appsscript.json manifest lists
 *    the Photos Picker scope, the token the script runs with can call the
 *    Picker API directly. No OAuth client, nothing in Script Properties,
 *    no connect ceremony: authorising the deployment IS the connection,
 *    and it reaches the sheet owner's library. Google does keep one
 *    console switch: the Picker API must be ENABLED in the Cloud project
 *    the token belongs to, and the hidden default project scripts start
 *    on has no page where that switch exists — attaching a standard
 *    project is the way out (docs/SHEET-SETUP.md → Google Photos). That
 *    refusal arrives as a 403 just like a scope problem, so pickerFetch_
 *    and photosAuthStatus_ both tell the two apart and name the real fix.
 *
 * 2. An OAuth client (optional). Kept for the one thing the script token
 *    cannot do — import from a DIFFERENT Google account's library. The
 *    script holds the client id/secret and refresh token in Script
 *    Properties, starts the consent dance once, and mints access tokens
 *    itself from then on. When this connection is live it wins, because
 *    someone went out of their way to set it up.
 *
 * Reauthorisation can still happen under either mode — a revoked grant,
 * an expired refresh token, Google requiring it — and the status action
 * says so honestly rather than pretending the connection is eternal.
 * ------------------------------------------------------------------ */

var PHOTOS_CLIENT_ID_PROPERTY = 'PHOTOS_OAUTH_CLIENT_ID';
var PHOTOS_CLIENT_SECRET_PROPERTY = 'PHOTOS_OAUTH_CLIENT_SECRET';
var PHOTOS_TOKENS_PROPERTY = 'PHOTOS_OAUTH_TOKENS';
var PHOTOS_ACCOUNT_HINT_PROPERTY = 'PHOTOS_ACCOUNT_HINT';

/** The one scope this app asks for: read what the user picks, nothing else. */
var PHOTOS_PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';

var PHOTOS_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
var PHOTOS_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
var PHOTOS_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
var PHOTOS_TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';
var PICKER_API = 'https://photospicker.googleapis.com/v1';

function photosClientId_() {
  return PropertiesService.getScriptProperties().getProperty(PHOTOS_CLIENT_ID_PROPERTY) || '';
}

function photosClientSecret_() {
  return PropertiesService.getScriptProperties().getProperty(PHOTOS_CLIENT_SECRET_PROPERTY) || '';
}

/** The stored token bundle: { refreshToken, accessToken, expiresAt, connectedAt }. */
function photosTokens_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PHOTOS_TOKENS_PROPERTY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function savePhotosTokens_(tokens) {
  PropertiesService.getScriptProperties()
    .setProperty(PHOTOS_TOKENS_PROPERTY, JSON.stringify(tokens));
}

function clearPhotosTokens_() {
  PropertiesService.getScriptProperties().deleteProperty(PHOTOS_TOKENS_PROPERTY);
}

function photosHasRefreshToken_() {
  var tokens = photosTokens_();
  return Boolean(tokens && tokens.refreshToken);
}

/**
 * True when the optional OAuth-client connection is actually usable: a
 * refresh token alone is dead weight without the client id and secret to
 * redeem it with.
 */
function photosOauthClientLive_() {
  return Boolean(photosClientId_() && photosClientSecret_() && photosHasRefreshToken_());
}

var PHOTOS_SCOPE_CACHE_KEY = 'script-photos-scope';

/**
 * Whether the token this script itself runs with can call the Picker API —
 * true once the manifest lists the Photos Picker scope and the owner has
 * re-authorised the deployment. Google's tokeninfo endpoint is the
 * authority; the answer is cached briefly because it only ever changes
 * when the owner re-authorises, and asking on every getAll would tax
 * startup. Pass `fresh` to skip the cache — the status action does, so a
 * just-fixed authorisation is never reported five minutes stale.
 */
function scriptPhotosScopeGranted_(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var cached = cache.get(PHOTOS_SCOPE_CACHE_KEY);
    if (cached) return cached === 'yes';
  }

  var granted = false;
  var answered = false;
  try {
    var response = UrlFetchApp.fetch(
      PHOTOS_TOKENINFO_ENDPOINT + '?access_token=' + encodeURIComponent(ScriptApp.getOAuthToken()),
      { muteHttpExceptions: true }
    );
    if (response.getResponseCode() === 200) {
      var scopes = String(JSON.parse(response.getContentText() || '{}').scope || '');
      granted = (' ' + scopes + ' ').indexOf(' ' + PHOTOS_PICKER_SCOPE + ' ') !== -1;
      answered = true;
    }
  } catch (error) {
    // Indeterminate — a network hiccup must not get remembered as "no".
  }
  try {
    cache.put(PHOTOS_SCOPE_CACHE_KEY, granted ? 'yes' : 'no', answered ? 300 : 30);
  } catch (cacheError) {
    // Without the cache the check simply runs again next time.
  }
  return granted;
}

/**
 * The bearer token every Photos call rides on. A live OAuth-client
 * connection wins — it exists precisely to reach a different account's
 * library — and the script's own token is the zero-configuration default.
 * The errors name the fix for the mode the deployment is actually in.
 */
function photosBearerToken_() {
  if (photosOauthClientLive_()) return photosAccessToken_();
  if (scriptPhotosScopeGranted_()) return ScriptApp.getOAuthToken();
  if (photosClientId_() && photosClientSecret_()) {
    throw new Error('Google Photos is not connected. Open settings and connect it first.');
  }
  throw new Error(
    'This script’s Google authorisation does not include Google Photos yet. ' +
    'Add the Photos Picker scope to the appsscript.json manifest and re-authorise ' +
    'the deployment — see docs/SHEET-SETUP.md → Google Photos.'
  );
}

/**
 * Google's refusal body, read once: the human message, and whether the
 * refusal is really "the Picker API is switched off in the Cloud project
 * this token belongs to". That state arrives as a 403 exactly like a scope
 * problem, and telling the two apart is the difference between advice that
 * fixes it and advice that sends the owner re-authorising for nothing.
 * Google names the enable-this-API page in the refusal; it is carried
 * through so the person can be sent to the switch itself.
 */
function pickerRefusal_(text) {
  var refusal = { message: '', apiDisabled: false, activationUrl: '' };
  var error;
  try {
    error = JSON.parse(text).error || {};
  } catch (parseError) {
    return refusal;
  }
  refusal.message = String(error.message || '');

  var details = error.details || [];
  for (var i = 0; i < details.length; i++) {
    var detail = details[i] || {};
    if (detail.reason === 'SERVICE_DISABLED') {
      refusal.apiDisabled = true;
      refusal.activationUrl = String((detail.metadata || {}).activationUrl || '');
    }
  }
  // Some refusals carry no structured details; the message still says it
  // plainly, in wording Google has kept stable for years. Both phrases are
  // matched narrowly — "disabled" alone could as easily describe an
  // account, and that misdiagnosis is the very thing this function exists
  // to end.
  if (!refusal.apiDisabled &&
      /has not been used in project|Enable it by visiting/i.test(refusal.message)) {
    refusal.apiDisabled = true;
  }
  if (refusal.apiDisabled && !refusal.activationUrl) {
    var link = /https:\/\/console\.[^\s"']+/.exec(refusal.message);
    if (link) refusal.activationUrl = link[0].replace(/[.,;]+$/, '');
  }
  return refusal;
}

/**
 * The words for that refusal, and only the true ones: authorisation was
 * checked before the call was made, so "re-authorise" — the likeliest
 * guess for any 403 — must not be the advice. Script mode has a second
 * trap worth naming: the hidden default Cloud project offers no page where
 * the API can be enabled, and attaching a standard project is the way out.
 */
function pickerApiDisabledAdvice_(activationUrl) {
  if (photosOauthClientLive_()) {
    return 'One-time step: the Photos Picker API is switched off in the Cloud project the ' +
      'connected OAuth client belongs to. Enable it' +
      (activationUrl ? ' at ' + activationUrl : ' (APIs & Services → Library → Photos Picker API)') +
      ', give Google a few minutes to notice, then try again — ' +
      'see docs/SHEET-SETUP.md → Google Photos.';
  }
  return 'One-time step: the Photos Picker API is switched off in the Cloud project this ' +
    'script runs in, so Google refuses every picker call — the authorisation itself is fine, ' +
    'and re-authorising will not change this. Enable the API' +
    (activationUrl ? ' at ' + activationUrl : ' in that project’s API library') +
    ', give Google a few minutes to notice, then try again. If that page says you don’t ' +
    'have permission, the script is on its hidden default Cloud project: switch it to a ' +
    'standard one (Apps Script editor → Project Settings → Google Cloud Platform (GCP) ' +
    'Project → Change project), enable the Photos Picker API there, and authorise the ' +
    'script again when it asks. Full steps: docs/SHEET-SETUP.md → Google Photos.';
}

/**
 * Whether the Picker API answers this token at all — the half of readiness
 * scope inspection cannot see. Probed with a GET for a session that cannot
 * exist: any answer except the project-level refusal (the missing session's
 * 404 included) proves the API itself is switched on. Never cached — this
 * runs only inside the status action, exactly while someone is diagnosing,
 * and a stale answer would send them chasing a problem they already fixed.
 */
function pickerApiState_(token) {
  var state = { enabled: true, activationUrl: '' };
  try {
    var response = UrlFetchApp.fetch(PICKER_API + '/sessions/availability-probe', {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 403) {
      var refusal = pickerRefusal_(response.getContentText() || '');
      if (refusal.apiDisabled) {
        state.enabled = false;
        state.activationUrl = refusal.activationUrl;
      }
    }
  } catch (error) {
    // Indeterminate — a network hiccup is no verdict. The next real call
    // will say precisely what is wrong if something is.
  }
  return state;
}

/**
 * The exact URL Google must be told to redirect back to — this deployment's
 * own /exec address. Exposed by photosAuthStatus so it can be copied into
 * the OAuth client's "Authorized redirect URIs" rather than guessed.
 */
function photosRedirectUri_() {
  return ScriptApp.getService().getUrl() || '';
}

/**
 * Starts a connection: answers with the Google consent URL for the browser
 * to open. `prompt=consent` is sent only when no refresh token is stored —
 * that is the one case Google must be made to issue a new one; forcing it
 * every time would make every reconnect a full consent ceremony.
 */
function photosAuthStart_() {
  var clientId = photosClientId_();
  var secret = photosClientSecret_();
  if (!clientId || !secret) {
    throw new Error(
      'No OAuth client is set up — and none is needed for the sheet owner’s own library: ' +
      'the script’s own authorisation covers it once the manifest carries the Photos Picker ' +
      'scope (docs/SHEET-SETUP.md → Google Photos). Connecting a different Google account is ' +
      'the only reason to set the ' + PHOTOS_CLIENT_ID_PROPERTY + ' and ' +
      PHOTOS_CLIENT_SECRET_PROPERTY + ' script properties.'
    );
  }
  var redirect = photosRedirectUri_();
  if (!redirect) {
    throw new Error('This script has no web app URL yet. Deploy it as a web app first.');
  }

  // One-time state token, held server-side for ten minutes. The callback
  // must present it, which is what stops a forged redirect from planting a
  // stranger's authorisation here.
  var state = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('photos-oauth-state:' + state, '1', 600);

  var params = {
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: PHOTOS_PICKER_SCOPE,
    access_type: 'offline',
    state: state
  };
  if (!photosHasRefreshToken_()) params.prompt = 'consent';

  var hint = PropertiesService.getScriptProperties().getProperty(PHOTOS_ACCOUNT_HINT_PROPERTY);
  if (hint) params.login_hint = hint;

  var query = [];
  for (var key in params) {
    if (params.hasOwnProperty(key)) {
      query.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    }
  }
  return { authUrl: PHOTOS_AUTH_ENDPOINT + '?' + query.join('&'), redirectUri: redirect };
}

/**
 * Where Google sends the person after consent. Returns HTML — someone is
 * looking at this page — and never the JSON envelope. The state token is the
 * authorisation here; the shared access code cannot be, because Google is
 * the caller.
 */
function photosAuthCallback_(params) {
  var page;
  try {
    var state = String(params.state || '');
    var cache = CacheService.getScriptCache();
    var known = state && cache.get('photos-oauth-state:' + state);
    if (!known) {
      throw new Error('This authorisation link has expired or was already used. Start again from the app.');
    }
    cache.remove('photos-oauth-state:' + state);

    if (params.error) {
      throw new Error('Google reported: ' + params.error);
    }
    var code = String(params.code || '');
    if (!code) throw new Error('Google sent no authorisation code.');

    var response = UrlFetchApp.fetch(PHOTOS_TOKEN_ENDPOINT, {
      method: 'post',
      payload: {
        code: code,
        client_id: photosClientId_(),
        client_secret: photosClientSecret_(),
        redirect_uri: photosRedirectUri_(),
        grant_type: 'authorization_code'
      },
      muteHttpExceptions: true
    });
    var payload = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() !== 200 || !payload.access_token) {
      throw new Error('Google refused the token exchange: ' + (payload.error_description || payload.error || response.getResponseCode()));
    }

    var existing = photosTokens_() || {};
    savePhotosTokens_({
      // A repeat consent may omit the refresh token; keep the one we have.
      refreshToken: payload.refresh_token || existing.refreshToken || '',
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(0, (payload.expires_in || 0) - 60) * 1000,
      connectedAt: new Date().toISOString()
    });

    if (!photosHasRefreshToken_()) {
      throw new Error(
        'Google answered without a refresh token, so the connection would not survive the hour. ' +
        'Disconnect the app at myaccount.google.com/permissions, then connect again.'
      );
    }

    page = '<h2>Google Photos connected</h2>' +
      '<p>You can close this window and return to the travel app.</p>';
  } catch (error) {
    page = '<h2>Connection failed</h2><p>' +
      String(error && error.message ? error.message : error).replace(/</g, '&lt;') + '</p>';
  }

  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:-apple-system,system-ui,sans-serif;padding:32px;text-align:center;color:#222}</style>' +
    '</head><body>' + page +
    '<script>setTimeout(function(){ try { window.close(); } catch (e) {} }, 1500);</script>' +
    '</body></html>'
  ).setTitle('Google Photos');
}

function photosAuthStatus_() {
  var tokens = photosTokens_();
  var oauthConfigured = Boolean(photosClientId_() && photosClientSecret_());
  var oauthLive = photosOauthClientLive_();
  // Fresh, not cached: this is the call the app makes while someone is
  // actively wondering why the picker won't open, and a five-minute-old
  // "no" would send them chasing a problem they already fixed.
  var scopeGranted = scriptPhotosScopeGranted_(true);
  var authorised = oauthLive || scopeGranted;

  // Authorisation is necessary, not sufficient: the Picker API must also be
  // enabled in the Cloud project the token belongs to. A deployment can pass
  // the scope check and still have every Photos call bounce — the state this
  // probe exists to catch, because without it the status would say
  // "connected" while the picker says 403.
  var api = { enabled: true, activationUrl: '' };
  if (authorised) {
    try {
      api = pickerApiState_(oauthLive ? photosAccessToken_() : ScriptApp.getOAuthToken());
    } catch (tokenError) {
      // A token that cannot be minted right now is an authorisation
      // problem, and the fields below already describe those.
    }
  }
  var connected = authorised && api.enabled;

  return {
    // Imports can run right now, or there is at least a connect path the
    // app can offer. Older apps read this as "worth showing the flow".
    configured: scopeGranted || oauthConfigured,
    connected: connected,
    // Which authorisation the next Photos call will ride on — or, when
    // neither works yet, the one there is a path to fixing.
    mode: oauthLive ? 'oauth' : scopeGranted ? 'script' : oauthConfigured ? 'oauth' : 'script',
    // Script mode's ground truth, separated out so the app can tell "the
    // default just works" from "the manifest step is still missing".
    scopeGranted: scopeGranted,
    // False in exactly one state: authorisation works, but the Picker API
    // is switched off in the Cloud project. Absent from older deployments'
    // answers, so the app reads a missing field as true.
    pickerApiEnabled: api.enabled,
    // What to do about a not-connected answer, worded here because only
    // the script knows which mode it is in and what Google refused. Empty
    // when the app's own connect button is the answer, or when nothing is
    // wrong.
    advice: !api.enabled ? pickerApiDisabledAdvice_(api.activationUrl) :
      connected || oauthConfigured ? '' :
      'One-time step: add the Google Photos Picker scope to the script’s appsscript.json ' +
      'manifest and re-authorise the deployment — see docs/SHEET-SETUP.md → Google Photos.',
    connectedAt: oauthLive && tokens && tokens.connectedAt ? tokens.connectedAt : '',
    accountHint: PropertiesService.getScriptProperties().getProperty(PHOTOS_ACCOUNT_HINT_PROPERTY) || '',
    // Copied into the Google Cloud OAuth client, character for character.
    redirectUri: photosRedirectUri_()
  };
}

/** Revokes the grant at Google and forgets everything stored here. */
function photosAuthDisconnect_() {
  var tokens = photosTokens_();
  if (tokens) {
    var token = tokens.refreshToken || tokens.accessToken;
    if (token) {
      try {
        UrlFetchApp.fetch(PHOTOS_REVOKE_ENDPOINT + '?token=' + encodeURIComponent(token), {
          method: 'post',
          muteHttpExceptions: true
        });
      } catch (error) {
        // Revocation is best effort; the tokens are deleted either way.
      }
    }
  }
  clearPhotosTokens_();
  return { disconnected: true };
}

/**
 * A currently-valid access token, refreshed from the stored refresh token
 * when the cached one has aged out. The refresh token never leaves here.
 */
function photosAccessToken_() {
  var tokens = photosTokens_();
  if (!tokens || !tokens.refreshToken) {
    throw new Error('Google Photos is not connected. Open settings and connect it first.');
  }
  if (tokens.accessToken && tokens.expiresAt && Date.now() < tokens.expiresAt - 30000) {
    return tokens.accessToken;
  }

  var response = UrlFetchApp.fetch(PHOTOS_TOKEN_ENDPOINT, {
    method: 'post',
    payload: {
      refresh_token: tokens.refreshToken,
      client_id: photosClientId_(),
      client_secret: photosClientSecret_(),
      grant_type: 'refresh_token'
    },
    muteHttpExceptions: true
  });
  var payload = JSON.parse(response.getContentText() || '{}');

  if (response.getResponseCode() !== 200 || !payload.access_token) {
    // A dead refresh token stays dead; keeping it would make every later
    // call fail the slow way. Forget it so status honestly says "connect".
    if (payload.error === 'invalid_grant') {
      clearPhotosTokens_();
      throw new Error('Google Photos authorisation has expired or was revoked. Connect it again from settings.');
    }
    throw new Error('Google Photos token refresh failed: ' + (payload.error_description || payload.error || response.getResponseCode()));
  }

  tokens.accessToken = payload.access_token;
  tokens.expiresAt = Date.now() + Math.max(0, (payload.expires_in || 0) - 60) * 1000;
  savePhotosTokens_(tokens);
  return tokens.accessToken;
}

/* ------------------------------------------------------------------ *
 * Google Photos — Picker sessions
 *
 * The documented flow, verbatim: create a session, hand the browser its
 * pickerUri, poll until mediaItemsSet, list what was picked, and delete
 * the session when done. Sessions are never stored as application data.
 * ------------------------------------------------------------------ */

/** How many items one selection may carry. Import happens in small batches. */
var PICKER_MAX_ITEMS = 50;

function pickerFetch_(method, path, body) {
  var token = photosBearerToken_();
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  var response = UrlFetchApp.fetch(PICKER_API + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText() || '';

  if (code === 401 || code === 403) {
    var refusal = pickerRefusal_(text);
    // The one 403 that has nothing to do with authorisation: the Picker
    // API is not enabled in the Cloud project. "Re-authorise" would be
    // precisely the wrong advice there, so that case gets its own words
    // and the enable-this-API link Google handed over.
    if (refusal.apiDisabled) {
      throw new Error('Google Photos refused the request (' + code + '). ' +
        pickerApiDisabledAdvice_(refusal.activationUrl));
    }
    // Otherwise Google's own reason rides along — a refusal that is not
    // about the scope at all (a policy, a suspended account) should say
    // so, not hide behind the likeliest guess.
    throw new Error((photosOauthClientLive_()
      ? 'Google Photos refused the request (' + code + '). The authorisation may have been revoked — reconnect from settings.'
      : 'Google Photos refused the request (' + code + '). The script’s own authorisation may be missing the Photos Picker scope — re-authorise the deployment (docs/SHEET-SETUP.md → Google Photos).') +
      (refusal.message ? ' Google said: ' + refusal.message : ''));
  }
  if (code === 404) {
    throw new Error('That Google Photos picking session no longer exists. Start the picker again.');
  }
  if (code < 200 || code >= 300) {
    var detail = '';
    try { detail = (JSON.parse(text).error || {}).message || ''; } catch (e) { detail = ''; }
    throw new Error('Google Photos answered ' + code + (detail ? ': ' + detail : '.'));
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('Google Photos sent back something unreadable.');
  }
}

function createPhotoPickerSession_(body) {
  var max = Math.max(1, Math.min(PICKER_MAX_ITEMS, parseInt(body.maxItems, 10) || PICKER_MAX_ITEMS));
  var session = pickerFetch_('post', '/sessions', {
    pickingConfig: { maxItemCount: String(max) }
  });
  return {
    sessionId: session.id,
    pickerUri: session.pickerUri,
    expireTime: session.expireTime || '',
    pollingConfig: session.pollingConfig || {}
  };
}

function getPhotoPickerSession_(params) {
  var id = String(params.sessionId || '');
  if (!id) throw new Error('Which picking session? None was named.');
  var session = pickerFetch_('get', '/sessions/' + encodeURIComponent(id));
  return {
    sessionId: session.id,
    mediaItemsSet: session.mediaItemsSet === true,
    pollingConfig: session.pollingConfig || {},
    expireTime: session.expireTime || ''
  };
}

function deletePhotoPickerSession_(body) {
  var id = String(body.sessionId || '');
  if (!id) return { deleted: false };
  try {
    pickerFetch_('delete', '/sessions/' + encodeURIComponent(id));
  } catch (error) {
    // A session that is already gone is the outcome we wanted.
  }
  return { deleted: true };
}

/**
 * Everything the person picked, straight through with pagination handled.
 * `baseUrl` rides along so the review screen can show thumbnails and the
 * import can download — it is temporary, and nothing here stores it.
 */
function listPickedPhotos_(body) {
  var id = String(body.sessionId || '');
  if (!id) throw new Error('Which picking session? None was named.');

  var items = [];
  var pageToken = '';
  do {
    var path = '/mediaItems?sessionId=' + encodeURIComponent(id) + '&pageSize=100' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var page = pickerFetch_('get', path);
    var got = page.mediaItems || [];
    for (var i = 0; i < got.length; i++) {
      var item = got[i] || {};
      var file = item.mediaFile || {};
      var meta = file.mediaFileMetadata || {};
      items.push({
        id: item.id || '',
        createTime: item.createTime || '',
        type: item.type || '',
        baseUrl: file.baseUrl || '',
        mimeType: file.mimeType || '',
        filename: file.filename || '',
        width: parseInt(meta.width, 10) || 0,
        height: parseInt(meta.height, 10) || 0
      });
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  // The review screen shows thumbnails, and picker base URLs only answer to
  // the OAuth token — which the browser rightly does not have. The links are
  // parked here for half an hour so getPickedPhotoPreview can resolve an
  // item id to its URL server-side; the browser never nominates a URL.
  try {
    var links = {};
    for (var k = 0; k < items.length; k++) {
      if (items[k].id && items[k].baseUrl) links[items[k].id] = items[k].baseUrl;
    }
    CacheService.getScriptCache().put('picker-links:' + id, JSON.stringify(links), 1800);
  } catch (cacheError) {
    // Previews degrade to placeholders; the selection itself is unaffected.
  }

  return { items: items };
}

/**
 * A small review thumbnail for one picked item. The item id is looked up in
 * the session's own cached links — an arbitrary URL from the browser would
 * otherwise ride out with the OAuth token attached, which is exactly the
 * shape of request this script never makes.
 */
function getPickedPhotoPreview_(params) {
  var sessionId = String(params.sessionId || '');
  var itemId = String(params.itemId || '');
  if (!sessionId || !itemId) throw new Error('A preview needs the session and the item.');

  var raw = CacheService.getScriptCache().get('picker-links:' + sessionId);
  if (!raw) {
    throw new Error('The preview links for this selection have expired. The photos can still be imported.');
  }
  var links;
  try {
    links = JSON.parse(raw);
  } catch (error) {
    throw new Error('The preview links for this selection are unreadable.');
  }
  var baseUrl = links[itemId];
  if (!baseUrl) throw new Error('That item is not part of this selection.');

  var response = UrlFetchApp.fetch(baseUrl + '=w256-h256', {
    headers: { Authorization: 'Bearer ' + photosBearerToken_() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('The preview could not be fetched (' + response.getResponseCode() + ').');
  }
  var blob = response.getBlob();
  return {
    itemId: itemId,
    mimeType: blob.getContentType() || 'image/jpeg',
    data: Utilities.base64Encode(blob.getBytes())
  };
}

/* ------------------------------------------------------------------ *
 * Google Photos — import to Drive + Travel_Photos
 * ------------------------------------------------------------------ */

var TRAVEL_PHOTOS_FOLDER_PROPERTY = 'TRAVEL_PHOTOS_FOLDER_ID';
var TRAVEL_PHOTOS_FOLDER_NAME = 'Travel App Photos';

/** Rendition sizes: gallery-sized copies, never the 80MB original photo.
 * The same width/height parameters on a video's base URL return a poster
 * frame as an image, so videos get real thumbnails for free; '=dv' asks for
 * the video bytes themselves. */
var PHOTO_THUMB_PARAMS = '=w512-h512';
var PHOTO_DISPLAY_PARAMS = '=w2048-h2048';
var VIDEO_BYTES_PARAMS = '=dv';

/** At most this many photos are imported per request; the app sends batches. */
var IMPORT_BATCH_LIMIT = 10;

/**
 * The private Drive folder imported photos live in. Unlike the older
 * uploadPhoto_ folder, files here are NOT link-shared: the only way bytes
 * leave is through getTravelPhoto, which checks the media access code.
 */
function travelPhotosFolder_() {
  var properties = PropertiesService.getScriptProperties();
  var savedId = properties.getProperty(TRAVEL_PHOTOS_FOLDER_PROPERTY);
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (error) {
      // The folder was deleted; fall through and make a fresh one.
    }
  }
  var existing = DriveApp.getFoldersByName(TRAVEL_PHOTOS_FOLDER_NAME);
  var folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(TRAVEL_PHOTOS_FOLDER_NAME);
  properties.setProperty(TRAVEL_PHOTOS_FOLDER_PROPERTY, folder.getId());
  return folder;
}

/** Reads a whole tab into { headers, map, rows } once, for lookups. */
function tableFor_(tabName) {
  var config = TABS[tabName];
  var sheet = sheetNamed_(tabName);
  var index = headerIndex_(sheet, config.header);
  var lastRow = sheet.getLastRow();
  var width = Math.max(sheet.getLastColumn(), 1);
  var rows = lastRow > config.header
    ? sheet.getRange(config.header + 1, 1, lastRow - config.header, width).getValues()
    : [];
  return { headers: index.headers, map: index.map, rows: rows };
}

function cellOf_(row, map, header) {
  var at = map[header];
  return at === undefined ? '' : String(row[at] == null ? '' : row[at]).trim();
}

/**
 * The association a photo claims, checked against the sheet before anything
 * is downloaded. The browser's word is never enough: a Visit ID must exist,
 * must not be deleted, must belong to the Place ID supplied, and must not
 * contradict the Trip ID supplied. What comes back is the validated triple,
 * with the visit's own place and trip filling any blanks.
 */
function resolveAssociation_(body) {
  var placeId = String(body.placeId || '').trim();
  var visitId = String(body.visitId || '').trim();
  var tripId = String(body.tripId || '').trim();

  if (!placeId && !visitId && !tripId) {
    throw new Error('These photos have nothing to attach to — no visit, trip or place was named.');
  }

  if (visitId) {
    var visits = tableFor_('Dates_Visits');
    var found = null;
    for (var i = 0; i < visits.rows.length; i++) {
      if (cellOf_(visits.rows[i], visits.map, 'Visit ID') === visitId) {
        found = visits.rows[i];
        break;
      }
    }
    if (!found) {
      throw new Error('The visit "' + visitId + '" is not in the sheet. If it was just added, let it sync first.');
    }
    if (cellOf_(found, visits.map, 'Deleted?').toLowerCase() === 'yes') {
      throw new Error('That visit has been deleted, so photos can no longer be added to it.');
    }
    var visitPlace = cellOf_(found, visits.map, 'Place ID');
    if (placeId && visitPlace && placeId !== visitPlace) {
      throw new Error('That visit belongs to a different place than the one named.');
    }
    var visitTrip = cellOf_(found, visits.map, 'Trip ID');
    if (tripId && visitTrip && tripId !== visitTrip) {
      throw new Error('That visit belongs to a different trip than the one named.');
    }
    placeId = visitPlace || placeId;
    tripId = visitTrip || tripId;
  }

  return { placeId: placeId, visitId: visitId, tripId: tripId };
}

/**
 * Imports a confirmed batch. Each item succeeds or fails on its own — 22
 * good photos are never rolled back over 3 bad ones — and the response says
 * exactly which was which so the app can offer to retry just the failures.
 */
function importPickedPhotos_(body) {
  var items = body.items;
  if (!items || !items.length) throw new Error('The import carried no photos.');
  if (items.length > IMPORT_BATCH_LIMIT) {
    throw new Error('Import at most ' + IMPORT_BATCH_LIMIT + ' photos per request; the app sends batches.');
  }

  var association = resolveAssociation_(body);
  var token = photosBearerToken_();
  var folder = travelPhotosFolder_();

  // What is already imported, by Google Photos item id — the durable identity
  // that makes "already added" answerable at all.
  var existing = tableFor_(TRAVEL_PHOTOS_TAB);
  var byItemId = {};
  for (var i = 0; i < existing.rows.length; i++) {
    var row = existing.rows[i];
    var itemId = cellOf_(row, existing.map, 'Google Photos Item ID');
    if (!itemId || cellOf_(row, existing.map, 'Deleted?').toLowerCase() === 'yes') continue;
    if (!byItemId[itemId]) byItemId[itemId] = [];
    byItemId[itemId].push({
      visitId: cellOf_(row, existing.map, 'Visit ID'),
      tripId: cellOf_(row, existing.map, 'Trip ID'),
      placeId: cellOf_(row, existing.map, 'Place ID'),
      thumbId: cellOf_(row, existing.map, 'Thumb Drive File ID'),
      displayId: cellOf_(row, existing.map, 'Display Drive File ID'),
      videoId: cellOf_(row, existing.map, 'Video Drive File ID')
    });
  }

  var results = [];
  var savedRows = [];
  var headers = null;

  for (var j = 0; j < items.length; j++) {
    var item = items[j] || {};
    var googleId = String(item.id || '');
    try {
      if (!googleId) throw new Error('The photo carried no Google Photos id.');
      var isVideo = String(item.type || '').toUpperCase() === 'VIDEO';

      var twins = byItemId[googleId] || [];
      var duplicate = false;
      for (var t = 0; t < twins.length; t++) {
        if (sameAssociation_(twins[t], association)) { duplicate = true; break; }
      }
      if (duplicate) {
        results.push({ id: googleId, status: 'duplicate' });
        continue;
      }

      // Already imported elsewhere: point a new metadata row at the same
      // Drive files rather than downloading and storing a second copy.
      var reuse = null;
      for (var r = 0; r < twins.length; r++) {
        if (twins[r].thumbId && twins[r].displayId) { reuse = twins[r]; break; }
      }

      var thumbId, displayId, videoId;
      if (reuse) {
        thumbId = reuse.thumbId;
        displayId = reuse.displayId;
        videoId = reuse.videoId || '';
      } else {
        var baseUrl = String(item.baseUrl || '');
        if (!baseUrl) throw new Error('The photo carried no download link. Reopen the picker and try again.');
        var safeName = String(item.filename || googleId).replace(/[\\\/:*?"<>|]/g, ' ').slice(0, 80).trim() || googleId;
        // The size parameters work on a video's base URL too, answering with
        // a poster frame — so both kinds get real image renditions, and
        // video bytes are never mistaken for an image.
        thumbId = downloadRendition_(baseUrl + PHOTO_THUMB_PARAMS, token, folder, safeName + ' (thumb)');
        displayId = downloadRendition_(baseUrl + PHOTO_DISPLAY_PARAMS, token, folder, safeName);
        videoId = '';
        if (isVideo) {
          // Best effort: a clip beyond the script's transfer limits keeps
          // its poster frames and imports anyway rather than failing.
          try {
            videoId = downloadRendition_(baseUrl + VIDEO_BYTES_PARAMS, token, folder, safeName + ' (video)');
          } catch (videoError) {
            videoId = '';
          }
        }
      }

      var saved = saveTravelPhotoRow_({
        'Google Photos Item ID': googleId,
        'Place ID': association.placeId,
        'Visit ID': association.visitId,
        'Trip ID': association.tripId,
        'Taken At': String(item.createTime || ''),
        'Filename': String(item.filename || ''),
        'MIME Type': String(item.mimeType || ''),
        'Width': item.width ? String(item.width) : '',
        'Height': item.height ? String(item.height) : '',
        'Thumb Drive File ID': thumbId,
        'Display Drive File ID': displayId,
        'Video Drive File ID': videoId,
        'Source': 'google-photos',
        'Sort Order': '',
        'Archived?': 'No',
        'Deleted?': 'No'
      });
      headers = saved.headers;
      savedRows.push(saved.row);
      // Later items in this same batch see this one as already imported.
      if (!byItemId[googleId]) byItemId[googleId] = [];
      byItemId[googleId].push({
        visitId: association.visitId, tripId: association.tripId,
        placeId: association.placeId, thumbId: thumbId, displayId: displayId,
        videoId: videoId
      });
      results.push({ id: googleId, status: 'imported', photoId: saved.id });
    } catch (error) {
      results.push({
        id: googleId,
        status: 'failed',
        error: String(error && error.message ? error.message : error)
      });
    }
  }

  return { results: results, photos: { headers: headers || [], rows: savedRows } };
}

/** Whether an existing row already says what this import would say. */
function sameAssociation_(twin, association) {
  if (association.visitId) return twin.visitId === association.visitId;
  if (association.tripId) return twin.tripId === association.tripId && !twin.visitId;
  return twin.placeId === association.placeId && !twin.visitId && !twin.tripId;
}

/**
 * The largest clip accepted whole from a device. The app keeps its own,
 * slightly smaller limit and sends bigger videos as poster frames only;
 * this bound is the server refusing to be talked past that.
 */
var MAX_DEVICE_CLIP_BYTES = 40 * 1024 * 1024;

/** Base64 out of an upload field, with the failure named after the field. */
function decodeMediaData_(data, label) {
  var text = String(data || '');
  if (!text) throw new Error('The upload carried no ' + label + ' data.');
  try {
    return Utilities.base64Decode(text);
  } catch (error) {
    throw new Error('The ' + label + ' data was not readable.');
  }
}

/**
 * One photo or video from a device, into Travel_Photos — the same tab, the
 * same private folder, the same association rules as a picker import. The
 * browser sends JPEG renditions it drew itself (this script cannot decode
 * an arbitrary video), plus the clip's own bytes when the video is small
 * enough to travel; a larger clip keeps its poster frames, exactly the deal
 * the picker import offers when a download is beyond this script's limits.
 */
function uploadTravelMedia_(body) {
  var association = resolveAssociation_(body);

  var mimeType = String(body.mimeType || '').trim();
  var isVideo = mimeType.indexOf('video/') === 0;
  if (!isVideo && mimeType.indexOf('image/') !== 0) {
    throw new Error('Only photos and videos can be added.');
  }

  // `device-<hash>` from the app — the same duplicate-and-reuse rules the
  // picker import keys on its Google Photos item id.
  var itemId = String(body.itemId || '').trim();
  var thumbId = '', displayId = '', videoId = '';

  if (itemId) {
    var existing = tableFor_(TRAVEL_PHOTOS_TAB);
    var twins = [];
    for (var i = 0; i < existing.rows.length; i++) {
      var row = existing.rows[i];
      if (cellOf_(row, existing.map, 'Google Photos Item ID') !== itemId) continue;
      if (cellOf_(row, existing.map, 'Deleted?').toLowerCase() === 'yes') continue;
      twins.push({
        visitId: cellOf_(row, existing.map, 'Visit ID'),
        tripId: cellOf_(row, existing.map, 'Trip ID'),
        placeId: cellOf_(row, existing.map, 'Place ID'),
        thumbId: cellOf_(row, existing.map, 'Thumb Drive File ID'),
        displayId: cellOf_(row, existing.map, 'Display Drive File ID'),
        videoId: cellOf_(row, existing.map, 'Video Drive File ID')
      });
    }
    for (var t = 0; t < twins.length; t++) {
      if (sameAssociation_(twins[t], association)) {
        return {
          status: 'duplicate',
          clipStored: Boolean(twins[t].videoId),
          photos: { headers: [], rows: [] }
        };
      }
    }
    // The same file already lives elsewhere in the library: point a new
    // metadata row at the same Drive files rather than storing a second copy.
    for (var r = 0; r < twins.length; r++) {
      if (twins[r].thumbId && twins[r].displayId) {
        thumbId = twins[r].thumbId;
        displayId = twins[r].displayId;
        videoId = twins[r].videoId || '';
        break;
      }
    }
  }

  if (!thumbId || !displayId) {
    var thumbBytes = decodeMediaData_(body.thumbData, 'thumbnail');
    var displayBytes = decodeMediaData_(body.displayData, 'preview');
    if (thumbBytes.length > MAX_PHOTO_BYTES || displayBytes.length > MAX_PHOTO_BYTES) {
      throw new Error('The preview images for that file came out too large to store.');
    }

    var clipBytes = null;
    if (isVideo && body.videoData) {
      clipBytes = decodeMediaData_(body.videoData, 'video');
      if (clipBytes.length > MAX_DEVICE_CLIP_BYTES) {
        throw new Error('That video is too large to store whole. Retry and it will be added as its preview frame.');
      }
    }

    var folder = travelPhotosFolder_();
    var safeName = String(body.filename || 'media')
      .replace(/[\\\/:*?"<>|]/g, ' ').slice(0, 80).trim() || 'media';
    // Files stay private, like every picker import — no setSharing on
    // purpose. getTravelPhoto is the only door, and it checks the media
    // access code every time.
    thumbId = folder.createFile(
      Utilities.newBlob(thumbBytes, 'image/jpeg', safeName + ' (thumb)')).getId();
    displayId = folder.createFile(
      Utilities.newBlob(displayBytes, 'image/jpeg', safeName)).getId();
    if (clipBytes) {
      videoId = folder.createFile(
        Utilities.newBlob(clipBytes, mimeType, safeName + ' (video)')).getId();
    }
  }

  var saved = saveTravelPhotoRow_({
    'Google Photos Item ID': itemId,
    'Place ID': association.placeId,
    'Visit ID': association.visitId,
    'Trip ID': association.tripId,
    'Taken At': String(body.takenAt || ''),
    'Filename': String(body.filename || ''),
    'MIME Type': mimeType,
    'Width': body.width ? String(body.width) : '',
    'Height': body.height ? String(body.height) : '',
    'Thumb Drive File ID': thumbId,
    'Display Drive File ID': displayId,
    'Video Drive File ID': videoId,
    'Source': 'manual',
    'Sort Order': '',
    'Archived?': 'No',
    'Deleted?': 'No'
  });

  return {
    status: 'imported',
    photoId: saved.id,
    clipStored: Boolean(videoId),
    photos: { headers: saved.headers, rows: [saved.row] }
  };
}

/** One rendition, from the temporary base URL into the private folder. */
function downloadRendition_(url, token, folder, name) {
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(
      code === 403 || code === 401
        ? 'The photo\'s temporary link has expired. Reopen the picker and choose it again.'
        : 'Google Photos would not hand the photo over (' + code + ').'
    );
  }
  var blob = response.getBlob();
  blob.setName(name);
  // The file stays private — no setSharing on purpose. getTravelPhoto is the
  // only door, and it checks the media access code every time.
  return folder.createFile(blob).getId();
}

/** Writes one Travel_Photos row under the script lock, via the same
 * machinery as every other row so ids and derived columns stay uniform. */
function saveTravelPhotoRow_(fields) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw new Error('The sheet is busy with another save. Try again in a moment.');
  }
  try {
    var sheet = sheetNamed_(TRAVEL_PHOTOS_TAB);
    var index = headerIndex_(sheet, TABS[TRAVEL_PHOTOS_TAB].header);
    // An existing hand-made tab may not carry every column; require only the
    // ones the gallery cannot work without, and write the rest where they fit.
    requireColumn_(index, 'Thumb Drive File ID', TRAVEL_PHOTOS_TAB);
    requireColumn_(index, 'Display Drive File ID', TRAVEL_PHOTOS_TAB);
    var kept = {};
    for (var header in fields) {
      if (fields.hasOwnProperty(header) && index.map[header] !== undefined) {
        kept[header] = fields[header];
      }
    }
    return upsertRow_({ tab: TRAVEL_PHOTOS_TAB, id: '', fields: kept });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 * Travel photos — serving and deleting
 *
 * The hard rule: the browser names a PHOTO ID, never a Drive file id. The
 * photo id is looked up in Travel_Photos, and only the Drive files that row
 * points at can ever be answered. There is deliberately no action anywhere
 * in this script that takes an arbitrary Drive file id.
 * ------------------------------------------------------------------ */

var MEDIA_ACCESS_CODE_PROPERTY = 'MEDIA_ACCESS_CODE';

/**
 * Photo bytes sit behind their own code, separate from the shared access
 * code (which is public by design — it ships in the static site). Out of
 * the box the code is simply '2026', matching the app's own default, so
 * photos view with nothing to set up. An owner who wants real secrecy sets
 * a long random MEDIA_ACCESS_CODE Script Property instead — it overrides
 * the default here, and each device is then asked for it once.
 */
var DEFAULT_MEDIA_CODE = '2026';

function authorizeMedia_(supplied) {
  var expected =
    PropertiesService.getScriptProperties().getProperty(MEDIA_ACCESS_CODE_PROPERTY) ||
    DEFAULT_MEDIA_CODE;
  if (!supplied || !constantTimeEquals_(String(supplied), expected)) {
    throw new Error('Wrong or missing media access code.');
  }
}

/** Finds one live Travel_Photos row by Photo ID, or throws readably. */
function travelPhotoById_(photoId) {
  var table = tableFor_(TRAVEL_PHOTOS_TAB);
  for (var i = 0; i < table.rows.length; i++) {
    var row = table.rows[i];
    if (cellOf_(row, table.map, 'Photo ID') !== photoId) continue;
    if (cellOf_(row, table.map, 'Deleted?').toLowerCase() === 'yes') {
      throw new Error('That photo has been deleted.');
    }
    return { row: row, map: table.map, rowNumber: TABS[TRAVEL_PHOTOS_TAB].header + 1 + i };
  }
  throw new Error('No photo with the id "' + photoId + '" exists.');
}

/**
 * One permitted image, as base64. Input is a photo id and a size word; the
 * Drive file id is resolved from the row and double-checked to live in the
 * app's own folder, so even a hand-edited row cannot exfiltrate an
 * unrelated Drive file.
 */
function getTravelPhoto_(params) {
  authorizeMedia_(params.media);

  var photoId = String(params.photoId || '').trim();
  if (!photoId) throw new Error('Which photo? No id was named.');
  var requested = String(params.size || 'thumb');
  var size = requested === 'display' || requested === 'video' ? requested : 'thumb';

  var found = travelPhotoById_(photoId);
  var fileId;
  if (size === 'video') {
    fileId = cellOf_(found.row, found.map, 'Video Drive File ID');
    if (!fileId) {
      throw new Error('This video\'s full clip wasn\'t stored — it was too large to copy. Its preview frames still show.');
    }
  } else {
    var column = size === 'display' ? 'Display Drive File ID' : 'Thumb Drive File ID';
    fileId = cellOf_(found.row, found.map, column) ||
      cellOf_(found.row, found.map, size === 'display' ? 'Thumb Drive File ID' : 'Display Drive File ID');
    if (!fileId) throw new Error('That photo has no stored image yet. Its import may still be running.');
  }

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    throw new Error('The photo\'s file is missing from Drive.');
  }

  // Belt and braces: only files that live in the app's own folder are served.
  var folderId = travelPhotosFolder_().getId();
  var inFolder = false;
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) { inFolder = true; break; }
  }
  if (!inFolder) throw new Error('That file is not one of the app\'s travel photos.');

  var blob = file.getBlob();
  return {
    photoId: photoId,
    size: size,
    mimeType: blob.getContentType() || 'image/jpeg',
    data: Utilities.base64Encode(blob.getBytes()),
    version: cellOf_(found.row, found.map, 'Updated At')
  };
}

/**
 * Soft-deletes the metadata row first — that is what every device follows —
 * then trashes the Drive files if no other live row still points at them.
 * Trash rather than delete, so a slip of the thumb is recoverable for 30
 * days from Drive itself.
 */
function deleteTravelPhoto_(body) {
  var photoId = String(body.id || '').trim();
  if (!photoId) throw new Error('A delete needs the photo id.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw new Error('The sheet is busy with another save. Try again in a moment.');
  }

  var thumbId = '';
  var displayId = '';
  var videoId = '';
  try {
    var found;
    try {
      found = travelPhotoById_(photoId);
    } catch (error) {
      // Already deleted or never existed: the outcome the caller wanted.
      appendLog_(TRAVEL_PHOTOS_TAB, photoId, 'delete', 'missing');
      return { id: photoId, deleted: true, missing: true };
    }
    thumbId = cellOf_(found.row, found.map, 'Thumb Drive File ID');
    displayId = cellOf_(found.row, found.map, 'Display Drive File ID');
    videoId = cellOf_(found.row, found.map, 'Video Drive File ID');

    deleteRow_({ tab: TRAVEL_PHOTOS_TAB, id: photoId });

    // Only now, with the metadata gone, are unreferenced files cleaned up.
    var table = tableFor_(TRAVEL_PHOTOS_TAB);
    var stillUsed = {};
    for (var i = 0; i < table.rows.length; i++) {
      var row = table.rows[i];
      if (cellOf_(row, table.map, 'Deleted?').toLowerCase() === 'yes') continue;
      stillUsed[cellOf_(row, table.map, 'Thumb Drive File ID')] = true;
      stillUsed[cellOf_(row, table.map, 'Display Drive File ID')] = true;
      stillUsed[cellOf_(row, table.map, 'Video Drive File ID')] = true;
    }
    trashIfUnused_(thumbId, stillUsed);
    trashIfUnused_(displayId, stillUsed);
    trashIfUnused_(videoId, stillUsed);
  } finally {
    lock.releaseLock();
  }
  return { id: photoId, deleted: true };
}

function trashIfUnused_(fileId, stillUsed) {
  if (!fileId || stillUsed[fileId]) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    // The metadata row is already tombstoned; a file that cannot be trashed
    // is an orphan in a private folder, not a data problem.
  }
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
    var mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
    // With the listing id the app saves from a Google search, the link opens
    // the actual place — the coordinates stay as the fallback query.
    var placeId = map['Google Place ID'] === undefined
      ? ''
      : String(values[map['Google Place ID']] || '').trim();
    if (placeId) mapUrl += '&query_place_id=' + encodeURIComponent(placeId);
    values[map['Map URL']] = mapUrl;
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
