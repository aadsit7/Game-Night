/**
 * What a swipe on a list row means once the finger leaves the screen.
 *
 * The gesture itself is a few lines of drag handling; deciding what it *was*
 * is the part with all the judgement in it, and none of that judgement can be
 * seen by looking at the row. Pull an inch and let go — did you mean to reveal
 * the button, or to run it? Flick hard and short — is that a commit, or a
 * fumble? Get it wrong in the timid direction and the gesture feels broken;
 * get it wrong in the eager direction and the app deletes a place nobody asked
 * it to.
 *
 * So the decision lives here, as arithmetic over the numbers the browser hands
 * back, and the component below it only animates whatever this returns.
 */

/** Which side of the row an action lives on. `left` is revealed by a rightward pull. */
export type SwipeSide = "left" | "right";

export type SwipeOutcome = {
  /** Where the row should come to rest, in pixels from home. */
  x: number;
  /** The action to run, if the pull went far enough to mean it. */
  commit: SwipeSide | null;
  /** The side left standing open, if it did not. */
  open: SwipeSide | null;
};

export const CLOSED: SwipeOutcome = { x: 0, commit: null, open: null };

/**
 * Past this much of the row's width, the pull is the action rather than a
 * request to see it. A little under half: far enough that no accidental drag
 * reaches it, close enough that a deliberate one does not feel like work.
 */
const COMMIT_FRACTION = 0.42;

/**
 * A flick can commit from closer in, because speed is intent — but only once
 * the row is open far enough to prove the direction was meant. Pixels per
 * second, as the pointer events report it.
 */
const FLICK_VELOCITY = 900;

export function settleSwipe({
  offset,
  velocity,
  width,
  reveal,
  hasLeft,
  hasRight,
}: {
  /** Where the row is now: negative for a leftward pull. */
  offset: number;
  velocity: number;
  width: number;
  /** How wide the action panel is when open. */
  reveal: number;
  /** An action revealed by pulling right. */
  hasLeft: boolean;
  /** An action revealed by pulling left. */
  hasRight: boolean;
}): SwipeOutcome {
  const side: SwipeSide = offset < 0 ? "right" : "left";
  const available = side === "right" ? hasRight : hasLeft;
  // A pull towards a side with nothing on it always springs back, however far
  // it went — the row has no promise to keep in that direction.
  if (!available || offset === 0) return CLOSED;

  const distance = Math.abs(offset);
  const speed = Math.abs(velocity);
  // Velocity that points back the way it came is a reversal, not a flick.
  const flicking = speed > FLICK_VELOCITY && Math.sign(velocity) === Math.sign(offset);

  const commitAt = Math.max(reveal * 2, width * COMMIT_FRACTION);
  if (distance >= commitAt || (flicking && distance >= reveal)) {
    // Off the edge it went out of, so the row leaves rather than snapping back
    // into a list it is no longer part of.
    return { x: side === "right" ? -width : width, commit: side, open: null };
  }

  // Halfway to the detent is a request to see the button; anything less is a
  // change of mind.
  if (distance >= reveal * 0.5 || flicking) {
    return { x: side === "right" ? -reveal : reveal, commit: null, open: side };
  }

  return CLOSED;
}
