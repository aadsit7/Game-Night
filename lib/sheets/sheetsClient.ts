import type { SheetConnection } from "@/lib/sheets/connection";
import type { SheetTable } from "@/lib/sheets/mapping";
import type { GooglePlace } from "@/lib/maps/googlePlaces";
import type { GooglePickedMedia, TravelPhotoSize } from "@/types/travelPhoto";

/**
 * The only module in the app that touches the network.
 *
 * Everything above it — the repository, the store, every screen — deals in
 * travel records and never in requests, so there is exactly one place to look
 * when a save doesn't land, and exactly one place the CORS rules have to be
 * right.
 */

export type SheetSnapshot = {
  tabs: Record<string, SheetTable>;
  lookups: Record<string, string[]>;
  settings: Record<string, string>;
  schemaVersion: string;
  /**
   * What this deployment can do beyond rows. Absent from an older script,
   * which reads as "none of it" and is exactly right — an app that offered a
   * search the script cannot serve would fail on every keystroke.
   */
  capabilities: SheetCapabilities;
  serverTime: string;
};

export type SheetCapabilities = {
  /** A Google Maps API key is set on the script, so Places search works. */
  placesSearch: boolean;
  /**
   * The script can save photos to the sheet owner's Google Drive, so a photo
   * added on one device can be seen on all of them. An older deployment
   * simply omits this and photos stay in the browser they were added in.
   */
  photoUpload: boolean;
  /** The deployment serves Dates_Visits rows individually. */
  visits: boolean;
  /** The deployment has the Travel_Photos tab and its photo actions. */
  travelPhotos: boolean;
  /** The deployment offers the Google Photos picker flow at all. Current
   * scripts always do — the script's own authorisation is the default way
   * in — while older ones only say so once OAuth credentials are set. */
  googlePhotosPicker: boolean;
  /** An import could run right now: the script's own token carries the
   * Picker scope, or an OAuth-client connection is live server-side. */
  googlePhotosConnected: boolean;
  /**
   * The deployment accepts photos and videos uploaded straight from a
   * device or a Drive folder into Travel_Photos. Older scripts omit this
   * and the app simply doesn't offer the source.
   */
  deviceMediaUpload: boolean;
};

export type UpsertResult = { id: string; row: unknown[]; headers: string[] };

export type SheetErrorKind =
  | "network"
  | "auth"
  | "notDeployed"
  | "server"
  | "malformed"
  | "timeout";

export class SheetError extends Error {
  readonly kind: SheetErrorKind;
  readonly cause?: unknown;

  constructor(message: string, kind: SheetErrorKind, cause?: unknown) {
    super(message);
    this.name = "SheetError";
    this.kind = kind;
    this.cause = cause;
  }

  /** Whether trying the same request again could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "timeout" || this.kind === "server";
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * A fetch with no deadline never rejects when the network simply goes away —
 * a captive portal, a wifi-to-cellular handoff — and the save it belongs to
 * would sit "saving" forever.
 */
function deadline(signal?: AbortSignal): AbortSignal | undefined {
  if (signal) return signal;
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return undefined;
  }
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function describeFailure(error: unknown): SheetError {
  if (error instanceof SheetError) return error;

  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new SheetError("The sheet took too long to answer.", "timeout", error);
  }

  // A blocked cross-origin request and an offline device are indistinguishable
  // from here: the browser reports both as a bare TypeError with no detail.
  return new SheetError(
    "Couldn’t reach the sheet. Check the connection, or that the web app address is still deployed.",
    "network",
    error,
  );
}

/**
 * Apps Script answers a script error with an HTML page, not JSON. Reading the
 * body as text first means that arrives as a readable message rather than a
 * "Unexpected token <" that says nothing about what went wrong.
 */
async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SheetError(
        "Google refused the request. Re-deploy the script with Who has access: Anyone.",
        "auth",
      );
    }
    if (response.status === 404) {
      throw new SheetError(
        "That web app address doesn’t exist. Check it, or deploy the script again.",
        "notDeployed",
      );
    }
    throw new SheetError(`The sheet answered with ${response.status}.`, "server");
  }

  if (/^\s*</.test(body)) {
    throw new SheetError(
      "The address returned a Google web page instead of data. That usually means the " +
        "deployment needs authorising, or the address is the /dev one rather than /exec.",
      "notDeployed",
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new SheetError("The sheet sent back something unreadable.", "malformed", error);
  }
}

function unwrap(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    throw new SheetError("The sheet sent back something unreadable.", "malformed");
  }

  const envelope = payload as { ok?: boolean; data?: unknown; error?: string };
  if (envelope.ok === true) return envelope.data;

  const message = envelope.error ?? "The sheet reported an error it couldn’t describe.";
  // The script says this in as many words when the code is wrong or absent.
  const kind: SheetErrorKind = /access code/i.test(message) ? "auth" : "server";
  throw new SheetError(message, kind);
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function getFromSheet(
  connection: SheetConnection,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = new URL(connection.url);
  url.searchParams.set("code", connection.code);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      // The /exec address answers with a redirect to script.googleusercontent.com,
      // which is where the body actually comes from.
      redirect: "follow",
      signal: deadline(signal),
    });
    return unwrap(await readPayload(response));
  } catch (error) {
    throw describeFailure(error);
  }
}

/* ------------------------------------------------------------------ *
 * Writes — every one of them goes through here
 * ------------------------------------------------------------------ */

/**
 * The single write path.
 *
 * The content type is `text/plain` on purpose and must stay that way. A JSON
 * content type makes the request "non-simple", so the browser sends a
 * preflight OPTIONS first — and Apps Script serves only GET and POST, with no
 * way to answer an OPTIONS at all, so the real request is never sent. The body
 * is still JSON; only the label on it differs, and the script parses it with
 * JSON.parse(e.postData.contents).
 *
 * `mode: 'no-cors'` would also stop the browser complaining, and is the wrong
 * fix: it makes the response opaque, so a save could fail and look identical
 * to one that worked.
 */
async function postToSheet(
  connection: SheetConnection,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(connection.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...body, code: connection.code }),
      redirect: "follow",
      signal: deadline(signal),
    });
    return unwrap(await readPayload(response));
  } catch (error) {
    throw describeFailure(error);
  }
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function asTable(value: unknown): SheetTable {
  const table = (value ?? {}) as Partial<SheetTable>;
  return {
    headers: Array.isArray(table.headers) ? table.headers.map((h) => String(h ?? "")) : [],
    rows: Array.isArray(table.rows) ? (table.rows as unknown[][]) : [],
  };
}

/** Every data tab in one request, which is all that startup needs. */
export async function getAll(
  connection: SheetConnection,
  signal?: AbortSignal,
): Promise<SheetSnapshot> {
  const data = (await getFromSheet(connection, { action: "getAll" }, signal)) as
    | Partial<SheetSnapshot>
    | undefined;

  const rawTabs = (data?.tabs ?? {}) as Record<string, unknown>;
  const tabs: Record<string, SheetTable> = {};
  for (const [name, table] of Object.entries(rawTabs)) tabs[name] = asTable(table);

  const capabilities = (data?.capabilities ?? {}) as Partial<SheetCapabilities>;

  return {
    tabs,
    lookups: (data?.lookups ?? {}) as Record<string, string[]>,
    settings: (data?.settings ?? {}) as Record<string, string>,
    schemaVersion: String(data?.schemaVersion ?? ""),
    capabilities: {
      placesSearch: capabilities.placesSearch === true,
      photoUpload: capabilities.photoUpload === true,
      visits: capabilities.visits === true,
      travelPhotos: capabilities.travelPhotos === true,
      googlePhotosPicker: capabilities.googlePhotosPicker === true,
      googlePhotosConnected: capabilities.googlePhotosConnected === true,
      deviceMediaUpload: capabilities.deviceMediaUpload === true,
    },
    serverTime: String(data?.serverTime ?? new Date().toISOString()),
  };
}

/**
 * Google Places search, run by the script so its API key never reaches the
 * browser. Only called when `capabilities.placesSearch` says there is one.
 */
export async function searchPlaces(
  connection: SheetConnection,
  request: { query: string; proximity?: [number, number]; language?: string },
  signal?: AbortSignal,
): Promise<GooglePlace[]> {
  const params: Record<string, string> = { action: "searchPlaces", q: request.query };
  if (request.language) params.lang = request.language;
  if (request.proximity) {
    params.lng = request.proximity[0].toFixed(4);
    params.lat = request.proximity[1].toFixed(4);
  }

  const data = (await getFromSheet(connection, params, signal)) as
    | { places?: GooglePlace[] }
    | undefined;

  return Array.isArray(data?.places) ? data.places : [];
}

export async function getLookups(
  connection: SheetConnection,
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  const data = (await getFromSheet(connection, { action: "getLookups" }, signal)) as
    | { lookups?: Record<string, string[]> }
    | undefined;
  return data?.lookups ?? {};
}

/** Cheapest possible round trip, used by the setup screen to check a code. */
export async function ping(connection: SheetConnection, signal?: AbortSignal): Promise<void> {
  await getFromSheet(connection, { action: "ping" }, signal);
}

/**
 * Creates or updates one row.
 *
 * Only the changed fields travel. Omitting an id asks the script to assign the
 * next one and hand it back, so ids stay the sheet's to give out and two
 * devices adding a place at once cannot land on the same one.
 */
export async function upsertRow(
  connection: SheetConnection,
  request: { tab: string; id?: string; fields: Record<string, string> },
  signal?: AbortSignal,
): Promise<UpsertResult> {
  const data = (await postToSheet(
    connection,
    { action: "upsertRow", tab: request.tab, id: request.id ?? "", fields: request.fields },
    signal,
  )) as Partial<UpsertResult> | undefined;

  const id = String(data?.id ?? "").trim();
  if (!id) throw new SheetError("The sheet saved the row but didn’t say which one.", "malformed");

  return {
    id,
    row: Array.isArray(data?.row) ? data.row : [],
    headers: Array.isArray(data?.headers) ? data.headers.map((h) => String(h ?? "")) : [],
  };
}

/**
 * Sends one photo to the script, which files it in the sheet owner's Drive
 * and answers with a link any device can render.
 *
 * Not queued with the row writes on purpose: a photo is hundreds of kilobytes
 * where a row is hundreds of bytes, and a queue that survives reloads in
 * localStorage cannot reasonably carry it. A failed upload simply leaves the
 * photo local, and the next sweep tries again.
 */
export async function uploadPhoto(
  connection: SheetConnection,
  request: { name: string; mimeType: string; data: string },
  signal?: AbortSignal,
): Promise<{ url: string; fileId: string }> {
  const uploadDeadline =
    signal ??
    (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? // A photo on a slow uplink needs longer than a row does.
        AbortSignal.timeout(90_000)
      : undefined);

  const data = (await postToSheet(
    connection,
    {
      action: "uploadPhoto",
      name: request.name,
      mimeType: request.mimeType,
      data: request.data,
    },
    uploadDeadline,
  )) as { url?: string; fileId?: string } | undefined;

  const url = String(data?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new SheetError("The script saved the photo but didn’t hand back its link.", "malformed");
  }
  return { url, fileId: String(data?.fileId ?? "").trim() };
}

/** Sets Deleted? to Yes. The row itself always stays where it is. */
export async function deleteRow(
  connection: SheetConnection,
  request: { tab: string; id: string },
  signal?: AbortSignal,
): Promise<void> {
  await postToSheet(connection, { action: "deleteRow", tab: request.tab, id: request.id }, signal);
}

export async function setSetting(
  connection: SheetConnection,
  key: string,
  value: string,
  signal?: AbortSignal,
): Promise<void> {
  await postToSheet(connection, { action: "setSetting", key, value }, signal);
}

/* ------------------------------------------------------------------ *
 * Google Photos — every call the picker flow makes
 *
 * All of these talk to the Apps Script, never to Google directly: the
 * script holds the OAuth tokens, and the browser only ever sees session
 * ids, picker URLs and picked-item metadata.
 * ------------------------------------------------------------------ */

export type PhotosAuthStatus = {
  /** Imports can run, or there is at least a connect path worth offering. */
  configured: boolean;
  /** An import could run right now, under whichever mode. */
  connected: boolean;
  /**
   * Which authorisation Photos calls ride on: "script" — the script's own
   * Google authorisation, nothing to connect in-app — or "oauth", the
   * optional OAuth-client connection (also what every older script is,
   * since they predate the field).
   */
  mode: "script" | "oauth";
  /** Script mode's ground truth: the script token carries the Picker scope. */
  scopeGranted: boolean;
  /** The script's own wording for what to do when not connected, if any. */
  advice: string;
  connectedAt: string;
  accountHint: string;
  /** The exact redirect URI to register on the optional OAuth client. */
  redirectUri: string;
};

export async function photosAuthStatus(
  connection: SheetConnection,
  signal?: AbortSignal,
): Promise<PhotosAuthStatus> {
  const data = (await getFromSheet(connection, { action: "photosAuthStatus" }, signal)) as
    | Partial<PhotosAuthStatus>
    | undefined;
  return {
    configured: data?.configured === true,
    connected: data?.connected === true,
    mode: data?.mode === "script" ? "script" : "oauth",
    scopeGranted: data?.scopeGranted === true,
    advice: String(data?.advice ?? ""),
    connectedAt: String(data?.connectedAt ?? ""),
    accountHint: String(data?.accountHint ?? ""),
    redirectUri: String(data?.redirectUri ?? ""),
  };
}

/**
 * A URL the app may point a window at: https anywhere, or plain http only on
 * localhost — which is what `npm run mock-sheet` serves during development.
 * Anything else — a javascript: URL, a bare path — is refused as malformed.
 */
function isNavigableUrl(url: string): boolean {
  return /^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
}

/** Starts the OAuth dance; the browser opens the returned consent URL. */
export async function photosAuthStart(
  connection: SheetConnection,
  signal?: AbortSignal,
): Promise<{ authUrl: string }> {
  const data = (await postToSheet(connection, { action: "photosAuthStart" }, signal)) as
    | { authUrl?: string }
    | undefined;
  const authUrl = String(data?.authUrl ?? "");
  if (!isNavigableUrl(authUrl)) {
    throw new SheetError("The script didn’t hand back a Google sign-in link.", "malformed");
  }
  return { authUrl };
}

export async function photosAuthDisconnect(
  connection: SheetConnection,
  signal?: AbortSignal,
): Promise<void> {
  await postToSheet(connection, { action: "photosAuthDisconnect" }, signal);
}

export type PickerSession = {
  sessionId: string;
  pickerUri: string;
  expireTime: string;
  /** Google's recommended polling cadence, passed through as-is. */
  pollingConfig: { pollInterval?: string; timeoutIn?: string };
};

export async function createPickerSession(
  connection: SheetConnection,
  request: { maxItems?: number } = {},
  signal?: AbortSignal,
): Promise<PickerSession> {
  const data = (await postToSheet(
    connection,
    { action: "createPhotoPickerSession", maxItems: request.maxItems ?? 50 },
    signal,
  )) as Partial<PickerSession> | undefined;

  const sessionId = String(data?.sessionId ?? "");
  const pickerUri = String(data?.pickerUri ?? "");
  if (!sessionId || !isNavigableUrl(pickerUri)) {
    throw new SheetError("Google Photos didn’t open a picking session.", "malformed");
  }
  return {
    sessionId,
    pickerUri,
    expireTime: String(data?.expireTime ?? ""),
    pollingConfig: (data?.pollingConfig ?? {}) as PickerSession["pollingConfig"],
  };
}

export async function getPickerSession(
  connection: SheetConnection,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ mediaItemsSet: boolean; pollingConfig: PickerSession["pollingConfig"] }> {
  const data = (await getFromSheet(
    connection,
    { action: "getPhotoPickerSession", sessionId },
    signal,
  )) as { mediaItemsSet?: boolean; pollingConfig?: PickerSession["pollingConfig"] } | undefined;
  return {
    mediaItemsSet: data?.mediaItemsSet === true,
    pollingConfig: data?.pollingConfig ?? {},
  };
}

export async function listPickedPhotos(
  connection: SheetConnection,
  sessionId: string,
  signal?: AbortSignal,
): Promise<GooglePickedMedia[]> {
  const data = (await postToSheet(connection, { action: "listPickedPhotos", sessionId }, signal)) as
    | { items?: GooglePickedMedia[] }
    | undefined;
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * A review thumbnail for one picked item, proxied through the script so the
 * OAuth token never reaches the browser. Item id in, bytes out — the
 * browser never nominates a URL.
 */
export async function getPickedPhotoPreview(
  connection: SheetConnection,
  request: { sessionId: string; itemId: string },
  signal?: AbortSignal,
): Promise<{ mimeType: string; data: string }> {
  const data = (await getFromSheet(
    connection,
    { action: "getPickedPhotoPreview", sessionId: request.sessionId, itemId: request.itemId },
    signal,
  )) as { mimeType?: string; data?: string } | undefined;
  return {
    mimeType: String(data?.mimeType ?? "image/jpeg"),
    data: String(data?.data ?? ""),
  };
}

export async function deletePickerSession(
  connection: SheetConnection,
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  await postToSheet(connection, { action: "deletePhotoPickerSession", sessionId }, signal);
}

export type ImportItemResult = {
  /** The Google Photos item id the result is about. */
  id: string;
  status: "imported" | "duplicate" | "video" | "failed";
  photoId?: string;
  error?: string;
};

export type ImportResult = {
  results: ImportItemResult[];
  /** The Travel_Photos rows created, for merging without a full reload. */
  photos: SheetTable;
};

/**
 * Imports one confirmed batch. Deliberately small — the script downloads
 * every image inside one execution, and Apps Script executions have a
 * budget. The caller sends several of these, not one big one.
 */
export async function importPickedPhotos(
  connection: SheetConnection,
  request: {
    items: GooglePickedMedia[];
    placeId?: string;
    visitId?: string;
    tripId?: string;
  },
  signal?: AbortSignal,
): Promise<ImportResult> {
  const importDeadline =
    signal ??
    (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? // Several Drive downloads ride in one request.
        AbortSignal.timeout(120_000)
      : undefined);

  const data = (await postToSheet(
    connection,
    {
      action: "importPickedPhotos",
      items: request.items,
      placeId: request.placeId ?? "",
      visitId: request.visitId ?? "",
      tripId: request.tripId ?? "",
    },
    importDeadline,
  )) as { results?: ImportItemResult[]; photos?: Partial<SheetTable> } | undefined;

  return {
    results: Array.isArray(data?.results) ? data.results : [],
    photos: asTable(data?.photos),
  };
}

export type DeviceMediaUploadRequest = {
  placeId?: string;
  visitId?: string;
  tripId?: string;
  /** `device-<hash>` — the durable identity deduplication keys on. Optional. */
  itemId?: string;
  filename: string;
  mimeType: string;
  takenAt?: string;
  width?: number;
  height?: number;
  /** Base64, no data-URL prefix — same wire shape as every other upload. */
  thumbData: string;
  displayData: string;
  /** The clip's own bytes, when the video is small enough to send whole. */
  videoData?: string;
};

export type DeviceMediaUploadResult = {
  status: "imported" | "duplicate";
  photoId?: string;
  /** Whether the clip's bytes were stored, or only its poster frames. */
  clipStored: boolean;
  /** The Travel_Photos row created, for merging without a full reload. */
  photos: SheetTable;
};

/**
 * One photo or video from the device, straight into Travel_Photos. The
 * renditions are made in the browser — the script can resize a Google
 * Photos download but cannot decode an arbitrary upload — so every row is
 * still guaranteed its thumb and display frames.
 */
export async function uploadTravelMedia(
  connection: SheetConnection,
  request: DeviceMediaUploadRequest,
  signal?: AbortSignal,
): Promise<DeviceMediaUploadResult> {
  const deadline =
    signal ??
    (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? // A clip is tens of megabytes riding a phone's uplink.
        AbortSignal.timeout(300_000)
      : undefined);

  const data = (await postToSheet(
    connection,
    {
      action: "uploadTravelMedia",
      placeId: request.placeId ?? "",
      visitId: request.visitId ?? "",
      tripId: request.tripId ?? "",
      itemId: request.itemId ?? "",
      filename: request.filename,
      mimeType: request.mimeType,
      takenAt: request.takenAt ?? "",
      width: request.width ?? "",
      height: request.height ?? "",
      thumbData: request.thumbData,
      displayData: request.displayData,
      videoData: request.videoData ?? "",
    },
    deadline,
  )) as
    | { status?: string; photoId?: string; clipStored?: boolean; photos?: Partial<SheetTable> }
    | undefined;

  return {
    status: data?.status === "duplicate" ? "duplicate" : "imported",
    photoId: typeof data?.photoId === "string" ? data.photoId : undefined,
    clipStored: data?.clipStored === true,
    photos: asTable(data?.photos),
  };
}

/**
 * The only parameters the photo endpoint is ever asked with. A Drive file id
 * has no field to travel in — the script resolves files from the photo id
 * alone, which is the whole of the "no arbitrary Drive reads" rule.
 */
export function travelPhotoRequestParams(
  photoId: string,
  size: TravelPhotoSize,
  mediaCode: string,
): Record<string, string> {
  return {
    action: "getTravelPhoto",
    photoId,
    size: size === "display" || size === "video" ? size : "thumb",
    media: mediaCode,
  };
}

export async function getTravelPhoto(
  connection: SheetConnection,
  request: { photoId: string; size: TravelPhotoSize; mediaCode: string },
  signal?: AbortSignal,
): Promise<{ mimeType: string; data: string; version: string }> {
  const data = (await getFromSheet(
    connection,
    travelPhotoRequestParams(request.photoId, request.size, request.mediaCode),
    signal,
  )) as { mimeType?: string; data?: string; version?: string } | undefined;

  const bytes = String(data?.data ?? "");
  if (!bytes) {
    throw new SheetError("The script answered without the photo’s bytes.", "malformed");
  }
  return {
    mimeType: String(data?.mimeType ?? "image/jpeg"),
    data: bytes,
    version: String(data?.version ?? ""),
  };
}

export async function deleteTravelPhotoRemote(
  connection: SheetConnection,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  await postToSheet(connection, { action: "deleteTravelPhoto", id }, signal);
}
