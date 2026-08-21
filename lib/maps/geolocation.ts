/**
 * Where the device is, for placing a pin without hunting for it on the map.
 *
 * Asked for only when someone is actually placing a pin, never on load. A
 * permission prompt on the first screen is the fastest way to get a permanent
 * "no", and this app has nothing to do with the answer until a pin needs a
 * home.
 */

export type Fix = {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in metres, as the device reports it. */
  accuracy: number;
};

export type LocationErrorKind =
  | "unsupported"
  | "insecure"
  | "denied"
  | "unavailable"
  | "timeout";

export class LocationError extends Error {
  readonly kind: LocationErrorKind;

  constructor(message: string, kind: LocationErrorKind) {
    super(message);
    this.name = "LocationError";
    this.kind = kind;
  }
}

/**
 * Wording aimed at the one person who can act on it.
 *
 * "Denied" is the only one worth explaining at length, because the fix is in
 * a settings screen the app cannot open and cannot even link to.
 */
const MESSAGES: Record<LocationErrorKind, string> = {
  unsupported: "This browser can’t share a location.",
  insecure:
    "Location needs a secure connection. Open the site over https and try again.",
  denied:
    "Location is turned off for this site. Turn it on in your browser’s settings for this page, then tap again.",
  unavailable: "Your device couldn’t get a fix. Try again in a moment.",
  timeout: "Finding your location took too long. Try again.",
};

const TIMEOUT_MS = 12_000;

/**
 * A single fix.
 *
 * `enableHighAccuracy` is on because the point of this is to drop a pin on a
 * building rather than a city — the extra second and the extra battery are
 * the right trade when someone has explicitly asked where they are. The cached
 * position is accepted if it is under a minute old, which makes a second tap
 * instant without ever showing a stale street.
 */
export function currentLocation(options: { signal?: AbortSignal } = {}): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new LocationError(MESSAGES.unsupported, "unsupported"));
      return;
    }

    // Every browser refuses geolocation outside a secure context, and the
    // error it raises for it is indistinguishable from a denial. Naming it
    // here means a person running the site over http is told the real reason.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      reject(new LocationError(MESSAGES.insecure, "insecure"));
      return;
    }

    let settled = false;
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      run();
    };

    function onAbort() {
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    }
    options.signal?.addEventListener("abort", onAbort);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        finish(() =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            // Some browsers report accuracy as null rather than omitting it.
            accuracy: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : 0,
          }),
        );
      },
      (error) => {
        const kind: LocationErrorKind =
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "unavailable";
        finish(() => reject(new LocationError(MESSAGES[kind], kind)));
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/** "±12 m" · "±1.4 km" — the honest width of a fix, kept short. */
export function formatAccuracy(metres: number): string | null {
  if (!Number.isFinite(metres) || metres <= 0) return null;
  if (metres < 1000) return `±${Math.round(metres)} m`;
  return `±${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}
