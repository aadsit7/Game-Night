import type { SheetConnection } from "@/lib/sheets/connection";

/**
 * The sheet connection built into the published site.
 *
 * Filling these in means the app works the moment it opens, on any device,
 * with nothing to type. That is the point of them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE CHANGING THEM
 *
 * Both values below are PUBLIC. They are compiled into the JavaScript that
 * every visitor downloads, so anyone who opens the site — or the repository —
 * can read them out and send requests to the web app themselves. Making the
 * repository private would not change that: the built bundle is served
 * publicly either way.
 *
 * There is no way around this on a static site with no server of its own. A
 * browser cannot hold a secret. The choice is between typing the code once per
 * device (leave these blank) and accepting that the code is public (fill them
 * in) — and this file exists because the second was chosen deliberately.
 *
 * What still limits the damage:
 *   - The script never deletes a row; the worst case is edited or added rows.
 *   - Every write is appended to the Sync_Log tab, so unexpected changes are
 *     visible and attributable to a time.
 *   - The spreadsheet itself stays private. This is a door into it, not a
 *     share link — nobody gains access to the file, Drive, or the account.
 *   - Rotating the code takes seconds: change ACCESS_CODE in the Apps Script
 *     Project Settings, update the value here, and redeploy the site. No new
 *     script deployment is needed, because Script Properties are read per
 *     request.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Leave either one empty and the app falls back to asking for both on first
 * open, storing them in that browser alone.
 */

/** The Apps Script web app address. Ends in /exec, never /dev. */
export const DEFAULT_WEB_APP_URL = "";

/** The shared code the script checks on every request. */
export const DEFAULT_ACCESS_CODE = "2dHoDYeD-XLTSecCG-qcZVCM5d";

/**
 * The built-in connection, or `null` if the site was published without one.
 *
 * Both halves are required: an address with no code, or a code with no
 * address, cannot reach anything, and falling back to the setup screen is a
 * far better outcome than a stream of rejected requests.
 */
export function defaultConnection(): SheetConnection | null {
  const url = DEFAULT_WEB_APP_URL.trim();
  const code = DEFAULT_ACCESS_CODE.trim();
  return url && code ? { url, code } : null;
}

/** Whether the published site carries a connection of its own. */
export function hasDefaultConnection(): boolean {
  return defaultConnection() !== null;
}
