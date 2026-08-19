/**
 * Travel repository — Google Apps Script Web App.
 *
 * The only thing that touches the spreadsheet. The website has no Google
 * credentials of its own: it sends a request here, this script does the read
 * or write under the sheet owner's own account, and the sheet itself stays
 * private.
 *
 * Deploy: Extensions > Apps Script > paste this file > Project Settings >
 * Script Properties > add ACCESS_CODE > Deploy > New deployment > Web app >
 * Execute as: Me > Who has access: Anyone.
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
  Trips_Itinerary: { header: 3, idColumn: 'Itinerary Item ID', prefix: 'ITEM',  pad: 4 }
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
var SETTINGS_TAB = 'App_Settings';
var LOG_TAB = 'Sync_Log';
var LOG_MAX_ROWS = 1000;
var LOG_TRIM_TO = 900;

var SCHEMA_VERSION = '1';

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
      case 'getAll':      return getAll_();
      case 'getLookups':  return { lookups: readLookups_() };
      case 'ping':        return { ok: true, schemaVersion: SCHEMA_VERSION };
      default:
        throw new Error('Unknown action "' + (params.action || '') + '". Expected getAll, getLookups or ping.');
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
          throw new Error('Unknown action "' + (body.action || '') + '". Expected upsertRow, deleteRow or setSetting.');
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
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');

  if (!expected) {
    throw new Error(
      'This script has no ACCESS_CODE set. In the Apps Script editor open ' +
      'Project Settings and add a Script Property named ACCESS_CODE.'
    );
  }
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
  var sheet = book_().getSheetByName(name);
  if (!sheet) throw new Error('The tab "' + name + '" is missing from this spreadsheet.');
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

/** One request, every data tab. Startup makes exactly this call. */
function getAll_() {
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
    serverTime: nowStamp_()
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
  var code = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  Logger.log(code ? 'ACCESS_CODE is set.' : 'ACCESS_CODE is MISSING — add it in Project Settings.');

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
