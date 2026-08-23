/**
 * The Google Photos window, handled the way Safari demands.
 *
 * iOS Safari blocks a `window.open` that does not happen synchronously in a
 * user gesture — and creating a Picker session is a network round trip. So
 * the tap opens a blank window on the spot, the session is created while a
 * holding message shows, and the same window is then *navigated* to the
 * pickerUri. One window, opened inside the gesture, pointed somewhere useful
 * a second later.
 *
 * Module-level rather than React state: a WindowProxy is not data, and
 * exactly one picker window is ever meant to exist.
 */

let pickerWindow: Window | null = null;

/**
 * Opens the blank window. MUST be called synchronously inside the click
 * handler — calling it after any `await` is what popup blocking is. Returns
 * false when the browser refused, which the flow treats as "offer a direct
 * link instead", never as a dead end.
 */
export function openPickerWindow(): boolean {
  closePickerWindow();
  try {
    pickerWindow = window.open("", "_blank");
  } catch {
    pickerWindow = null;
  }
  if (!pickerWindow) return false;

  try {
    pickerWindow.document.write(
      '<!doctype html><title>Google Photos</title>' +
        '<body style="font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#444">' +
        "<p>Opening Google Photos…</p></body>",
    );
    pickerWindow.document.close();
  } catch {
    // Cross-origin or refused writes just leave the window blank; the
    // navigation moments later is what matters.
  }
  return true;
}

/** Points the held window at the picker. False when it is gone or was never opened. */
export function navigatePickerWindow(url: string): boolean {
  if (!pickerWindow || pickerWindow.closed) return false;
  try {
    pickerWindow.location.replace(url);
    return true;
  } catch {
    return false;
  }
}

export function closePickerWindow(): void {
  if (pickerWindow && !pickerWindow.closed) {
    try {
      pickerWindow.close();
    } catch {
      // A window that refuses to close is the user's to close.
    }
  }
  pickerWindow = null;
}

/** Whether the picker window is (still) on screen, for the waiting copy. */
export function isPickerWindowOpen(): boolean {
  return Boolean(pickerWindow && !pickerWindow.closed);
}

/**
 * The address the picker window is sent to. `/autoclose` asks Google Photos
 * to close the window itself once the selection is confirmed — the flow
 * never depends on that happening (Safari often keeps the tab), it is just
 * nicer when it works; the "I've finished selecting" control is the path
 * that always exists.
 */
export function pickerNavigationUrl(pickerUri: string): string {
  return pickerUri.endsWith("/autoclose") ? pickerUri : `${pickerUri}/autoclose`;
}
