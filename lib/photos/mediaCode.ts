/**
 * The private media access code, on this device.
 *
 * Viewing already-imported photos must not need Google Photos OAuth — but
 * the photo bytes are private, and the shared sheet access code is public
 * by design (it ships in the static bundle). So the bytes sit behind a
 * second, genuinely secret code: set once in Apps Script Script Properties,
 * typed once per device, stored here in that browser's localStorage, and
 * never committed anywhere.
 */

const KEY = "travel-globe.media-code.v1";

export function loadMediaCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveMediaCode(code: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = code.trim();
    if (next) window.localStorage.setItem(KEY, next);
    else window.localStorage.removeItem(KEY);
  } catch {
    // A browser that refuses storage simply asks again next session.
  }
}

export function clearMediaCode(): void {
  saveMediaCode("");
}
