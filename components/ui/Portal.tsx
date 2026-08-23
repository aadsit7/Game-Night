"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders its children into `<body>`, out of wherever they were written.
 *
 * Every floating layer in this app needs this, and for one reason. The shell
 * is a `position: fixed` element, which makes it a stacking context of its
 * own: a `z-index` set inside it is ranked *among its siblings*, not against
 * the rest of the page. So a dialog written inside the shell and given the
 * highest number in the file still paints underneath a sheet that was
 * portalled out to the body — the sheet is comparing itself to the shell as a
 * whole, and winning.
 *
 * That is not a subtle mis-stacking. It cost the app its delete: "Delete
 * Place" in a place's own sheet raised an alert that was drawn entirely behind
 * that sheet, so the button did nothing anybody could see, on every path that
 * asked a question from inside a sheet.
 *
 * Everything that floats over the app therefore leaves through here, and their
 * layers are declared together in `lib/ui/sheetStack.ts` so the order between
 * them is written down in one place rather than inferred from four files.
 */
export function Portal({ children }: { children: ReactNode }) {
  return useIsClient() ? createPortal(children, document.body) : null;
}

/** Whether there is a DOM to portal into. Never changes once answered. */
const noSubscription = () => () => {};
export const useIsClient = () =>
  useSyncExternalStore(noSubscription, () => true, () => false);
