import { defaultConnection } from "@/lib/sheets/defaultConnection";

/**
 * Where the sheet lives, and the code that opens it.
 *
 * Two places can supply them. `lib/sheets/defaultConnection.ts` holds the pair
 * built into the published site, so the app works on any device with nothing
 * to type — at the cost of both being public, which that file explains at
 * length. A pair saved in this browser overrides it, and is the only source
 * when the site was published without a built-in one.
 */

const KEY = "travel-globe.sheet-connection.v1";

export type SheetConnection = {
  /** The Apps Script web app address, ending in /exec. */
  url: string;
  /** The shared code the script checks on every request. */
  code: string;
};

/**
 * Apps Script hands out three addresses that look alike, and only one works.
 * `/dev` serves the unpublished draft and requires a Google login; a bare
 * project URL is not an endpoint at all. Catching that here turns a confusing
 * "failed to fetch" into something the setup screen can explain.
 */
export function validateUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return "Paste the web app address that ends in /exec.";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That doesn’t look like a web address.";
  }

  if (parsed.protocol !== "https:") return "The address must start with https://";
  if (!/\.google\.com$/.test(parsed.hostname)) {
    return "That isn’t a Google Apps Script address.";
  }
  if (parsed.pathname.endsWith("/dev")) {
    return "That is the draft address. Deploy the script and use the one ending in /exec.";
  }
  if (!parsed.pathname.endsWith("/exec")) {
    return "The address should end in /exec.";
  }
  return null;
}

/**
 * What this browser was told to use, if anything.
 *
 * Kept separate from `loadConnection` so the two sources stay distinguishable:
 * an override is something the person chose, and "Reset connection" should
 * remove it without disturbing the built-in one underneath.
 */
export function loadOverride(): SheetConnection | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SheetConnection>;
    const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
    const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
    if (!url || !code) return null;

    return { url, code };
  } catch {
    return null;
  }
}

/**
 * The connection to actually use.
 *
 * An override wins, because it was typed deliberately and usually points
 * somewhere the built-in one does not — a copy of the sheet, or a second
 * deployment being tested.
 */
export function loadConnection(): SheetConnection | null {
  return loadOverride() ?? defaultConnection();
}

export function saveConnection(connection: SheetConnection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ url: connection.url.trim(), code: connection.code.trim() }),
    );
  } catch {
    // A browser refusing to store this leaves the app unconfigured, which the
    // setup screen already handles — there is nothing better to do here.
  }
}

/**
 * Forgets this browser's override. The sheet itself is untouched, and if the
 * site carries a built-in connection the app falls straight back to it rather
 * than to the setup screen.
 */
export function clearConnection(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do if even removal fails.
  }
}
