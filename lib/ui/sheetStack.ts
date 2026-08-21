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
