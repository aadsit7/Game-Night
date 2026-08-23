/**
 * Which sheet is in front, and what layer each one paints on.
 *
 * The shell renders every sheet in one fixed order and decides at runtime
 * which of them are open and in what order they were opened. Those two orders
 * are not the same: opening a place from a trip has to put the place in front,
 * and the place sheet happens to be written above the trip sheet in the JSX.
 * Left to the DOM, paint order follows the source and the sheet you just
 * opened ends up *behind* the one you opened it from — two full-height cards
 * occupying the same rectangle, their text interleaved.
 *
 * So layering is computed from the stack instead.
 */

/** The frontmost sheet's layer. */
export const FRONT_LAYER = 56;

/*
 * What floats above the sheets, and in what order.
 *
 * Everything below goes through `Portal`, so all of these numbers are compared
 * in the same stacking context — the body's — and mean exactly what they say
 * relative to `FRONT_LAYER` above. Keeping them here rather than as a `z-[90]`
 * in each component is the only way the order between them is legible: an
 * alert has to outrank a menu, a menu has to outrank a toast, and all three
 * have to outrank the frontmost sheet, because every one of them can be raised
 * from inside one.
 */

/** A toast: above the sheets, below anything waiting on an answer. */
export const TOAST_LAYER = 70;

/** A `•••` menu. */
export const MENU_LAYER = 80;

/** An alert. Nothing is allowed over the question you have to answer. */
export const ALERT_LAYER = 90;

/**
 * Each step back down the stack costs two layers: one for the sheet, one for
 * the scrim that dims whatever is behind it.
 */
const LAYERS_PER_SHEET = 2;

/**
 * How far back a sheet of this kind sits — 0 for the one in front.
 *
 * A kind that is not in the stack answers 0: it is not on screen, and the
 * sheet component uses the value only to present itself once it is.
 */
export function sheetDepth<K extends string>(
  stack: ReadonlyArray<{ kind: K }>,
  kind: K,
): number {
  const index = stack.findIndex((entry) => entry.kind === kind);
  return index === -1 ? 0 : stack.length - 1 - index;
}

/** The z-index a sheet at this depth paints on. */
export function sheetLayer(depth: number): number {
  return FRONT_LAYER - depth * LAYERS_PER_SHEET;
}

/**
 * The z-index of that sheet's scrim: directly beneath its own sheet, and
 * still above every sheet further back.
 */
export function scrimLayer(depth: number): number {
  return sheetLayer(depth) - 1;
}
