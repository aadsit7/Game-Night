/**
 * Where the sheet lives, and the code that opens it.
 *
 * Neither value is in the published bundle. This is a public repository on a
 * free GitHub Pages plan, so anything committed here is readable by anyone —
 * an access code in the source would be an access code in everyone's hands.
 * Instead both are typed once per browser and kept in localStorage, which on
 * a Pages site behaves exactly as it does anywhere else.
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

export function loadConnection(): SheetConnection | null {
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

/** Forgets this browser's connection. The sheet itself is untouched. */
export function clearConnection(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do if even removal fails.
  }
}
