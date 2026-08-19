import { DEFAULT_CONFIG, type GithubConfig } from "@/lib/sync/githubStore";

/**
 * Where the sync settings live: this browser, and nowhere else.
 *
 * The token in particular never leaves the device it was pasted into — it is
 * not in the published bundle and not in the repository. Each device you want
 * to *edit* from gets its own; reading works everywhere with no setup at all.
 */

const KEY = "travel-globe.sync.v1";

export type SyncSettings = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
  /** Off by default; turned on once a token is saved. */
  enabled: boolean;
};

export function defaultSettings(): SyncSettings {
  return { ...DEFAULT_CONFIG, token: "", enabled: false };
}

export function loadSettings(): SyncSettings {
  const fallback = defaultSettings();
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return {
      owner: parsed.owner?.trim() || fallback.owner,
      repo: parsed.repo?.trim() || fallback.repo,
      branch: parsed.branch?.trim() || fallback.branch,
      path: parsed.path?.trim() || fallback.path,
      token: typeof parsed.token === "string" ? parsed.token : "",
      enabled: parsed.enabled !== false,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: SyncSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A browser refusing to store settings is not worth failing a save over.
  }
}

export function clearToken(): void {
  const settings = loadSettings();
  saveSettings({ ...settings, token: "", enabled: false });
}

export function toConfig(settings: SyncSettings): GithubConfig {
  return {
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch,
    path: settings.path,
    token: settings.token || undefined,
  };
}

/** Reading is always possible on a public repository; writing needs a token. */
export function canWrite(settings: SyncSettings): boolean {
  return settings.enabled && settings.token.trim().length > 0;
}
