import type { VisitedPlace } from "@/types/place";

/**
 * The travel collection, stored as a JSON file in a GitHub repository.
 *
 * Reading needs nothing: the repository is public, so any device that opens
 * the site pulls the current file and sees the same history. Writing needs a
 * token, and that token is supplied by the person using the app and kept in
 * their own browser — it is deliberately *not* compiled into the published
 * bundle, because anything shipped to the browser can be read out of it by
 * anyone who loads the page.
 *
 * Concurrency is handled the way git does it: every read returns the file's
 * blob SHA, and every write must quote the SHA it is replacing. If someone
 * else wrote first, GitHub rejects the update and the caller re-reads, merges
 * and retries.
 */

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

export type GithubConfig = {
  owner: string;
  repo: string;
  branch: string;
  /** Path to the JSON file inside the repository. */
  path: string;
  /** Fine-grained token with Contents: read and write. Optional. */
  token?: string;
};

export type RemoteSnapshot = {
  places: VisitedPlace[];
  /** Blob SHA of the file this snapshot came from; `null` if it doesn't exist. */
  sha: string | null;
};

export type SyncErrorKind = "auth" | "conflict" | "network" | "notFound" | "unknown";

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly cause?: unknown;

  constructor(message: string, kind: SyncErrorKind, cause?: unknown) {
    super(message);
    this.name = "SyncError";
    this.kind = kind;
    this.cause = cause;
  }
}

export const DEFAULT_CONFIG: Omit<GithubConfig, "token"> = {
  owner: process.env.NEXT_PUBLIC_SYNC_OWNER || "aadsit7",
  repo: process.env.NEXT_PUBLIC_SYNC_REPO || "Game-Night",
  branch: process.env.NEXT_PUBLIC_SYNC_BRANCH || "main",
  path: process.env.NEXT_PUBLIC_SYNC_PATH || "data/places.json",
};

function headers(token?: string): HeadersInit {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

function contentsUrl(config: GithubConfig): string {
  const path = config.path.split("/").map(encodeURIComponent).join("/");
  return `${API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(
    config.repo,
  )}/contents/${path}`;
}

/** Base64 that survives non-ASCII place names and notes. */
function encodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeUtf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function describe(status: number): SyncError {
  if (status === 401 || status === 403) {
    return new SyncError(
      "That token was rejected. Check it hasn’t expired and that it grants Contents: read and write on this repository.",
      "auth",
    );
  }
  if (status === 409 || status === 422) {
    return new SyncError("Someone else saved first.", "conflict");
  }
  if (status === 404) {
    return new SyncError("That repository or file could not be found.", "notFound");
  }
  return new SyncError(`GitHub responded with ${status}.`, "unknown");
}

/** The stored file's shape. Versioned so the format can move later. */
type StoredFile = { version: number; updatedAt: string; places: VisitedPlace[] };

function parseFile(text: string): VisitedPlace[] {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as VisitedPlace[];
  const file = parsed as Partial<StoredFile>;
  return Array.isArray(file?.places) ? file.places : [];
}

/**
 * Reads through the raw CDN, which has no rate limit.
 *
 * Used by devices with no token. The unauthenticated Contents API allows only
 * 60 requests an hour *per IP*, which a couple of read-only devices polling for
 * updates would exhaust between them. It doesn't report a blob SHA, but a
 * device that never writes has no use for one.
 *
 * The trade is staleness: the CDN sends `max-age=300` and keys its cache on the
 * path alone, so the query below defeats the *browser's* cache but not GitHub's
 * — a read-only device can be up to five minutes behind. Devices with a token
 * go through the API instead and see writes immediately.
 */
async function readViaCdn(
  config: GithubConfig,
  signal?: AbortSignal,
): Promise<RemoteSnapshot> {
  const path = config.path.split("/").map(encodeURIComponent).join("/");
  const url =
    `${RAW}/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/` +
    `${encodeURIComponent(config.branch)}/${path}?t=${Date.now()}`;

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new SyncError("Couldn’t reach GitHub.", "network", error);
  }

  // Nothing saved yet — the normal state before the first write.
  if (response.status === 404) return { places: [], sha: null };
  if (!response.ok) throw describe(response.status);

  try {
    return { places: parseFile(await response.text()), sha: null };
  } catch (error) {
    throw new SyncError("The stored travel file couldn’t be read.", "unknown", error);
  }
}

export async function readRemote(
  config: GithubConfig,
  signal?: AbortSignal,
): Promise<RemoteSnapshot> {
  // Without a token there is nothing to write, so the SHA the API would give
  // us is unnecessary and the CDN is the cheaper, unmetered way in.
  if (!config.token) return readViaCdn(config, signal);

  const url = `${contentsUrl(config)}?ref=${encodeURIComponent(config.branch)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: headers(config.token),
      // The Contents API is CDN-cached; without this a device can keep seeing
      // its own last write instead of someone else's newer one.
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new SyncError("Couldn’t reach GitHub.", "network", error);
  }

  // A missing file is the normal state before the first save, not an error.
  if (response.status === 404) return { places: [], sha: null };
  if (!response.ok) throw describe(response.status);

  const payload = (await response.json()) as { content?: string; sha?: string };
  if (!payload.content || !payload.sha) return { places: [], sha: payload.sha ?? null };

  try {
    return { places: parseFile(decodeUtf8(payload.content)), sha: payload.sha };
  } catch (error) {
    throw new SyncError("The stored travel file couldn’t be read.", "unknown", error);
  }
}

export async function writeRemote(
  config: GithubConfig,
  places: VisitedPlace[],
  sha: string | null,
  message: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!config.token) {
    throw new SyncError("A token is needed to save to GitHub.", "auth");
  }

  const file: StoredFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    places,
  };

  let response: Response;
  try {
    response = await fetch(contentsUrl(config), {
      method: "PUT",
      headers: { ...headers(config.token), "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        message,
        content: encodeUtf8(`${JSON.stringify(file, null, 2)}\n`),
        branch: config.branch,
        // Omitted entirely when creating the file for the first time.
        ...(sha ? { sha } : {}),
      }),
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new SyncError("Couldn’t reach GitHub.", "network", error);
  }

  if (!response.ok) throw describe(response.status);

  const payload = (await response.json()) as { content?: { sha?: string } };
  const nextSha = payload.content?.sha;
  if (!nextSha) throw new SyncError("GitHub didn’t return the saved file.", "unknown");
  return nextSha;
}

/**
 * Cheap credential check for the settings screen. `canWrite` is `null` when
 * GitHub doesn't report permissions — fine-grained tokens often omit them, and
 * claiming "no write access" on that basis would be a lie.
 */
export async function verifyAccess(
  config: GithubConfig,
  signal?: AbortSignal,
): Promise<{ canWrite: boolean | null }> {
  const response = await fetch(
    `${API}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
    { headers: headers(config.token), cache: "no-store", signal },
  ).catch((error) => {
    if ((error as Error)?.name === "AbortError" || (error as Error)?.name === "TimeoutError") {
      throw new SyncError("GitHub didn’t answer in time.", "network", error);
    }
    throw new SyncError("Couldn’t reach GitHub.", "network", error);
  });

  if (!response.ok) throw describe(response.status);
  const payload = (await response.json()) as { permissions?: { push?: boolean } };
  if (!payload.permissions) return { canWrite: null };
  return { canWrite: Boolean(payload.permissions.push) };
}
