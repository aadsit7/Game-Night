import type { SheetConnection } from "@/lib/sheets/connection";
import type { SheetTable } from "@/lib/sheets/mapping";
import type { GooglePlace } from "@/lib/maps/googlePlaces";

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
    capabilities: { placesSearch: capabilities.placesSearch === true },
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
