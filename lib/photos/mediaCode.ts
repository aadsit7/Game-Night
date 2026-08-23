/**
 * The media access code, on this device.
 *
 * Viewing already-imported photos must not need Google Photos OAuth — but
 * the photo bytes are private, and the shared sheet access code is public
 * by design (it ships in the static bundle). So the bytes sit behind a
 * second code checked by the script on every request.
 *
 * Out of the box that code is simply `2026`, on both sides — the script
 * defaults to it when no `MEDIA_ACCESS_CODE` Script Property is set — so
 * photos view with nothing to type on any device. An owner who wants real
 * secrecy sets a long random property; the app then asks each device for it
 * once and keeps it in that browser's localStorage, never anywhere else.
 */

const KEY = "travel-globe.media-code.v1";

/**
 * The code used when none has been typed on this device. Matches the
 * script's own default so a fresh browser just works; a stored code — typed
 * for a deployment whose owner set their own — always wins over it.
 */
export const DEFAULT_MEDIA_CODE = "2026";

/** What this device has actually been given, or empty. For settings copy. */
export function storedMediaCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** The code requests carry: what was typed here, else the standard default. */
export function loadMediaCode(): string {
  return storedMediaCode() || DEFAULT_MEDIA_CODE;
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
