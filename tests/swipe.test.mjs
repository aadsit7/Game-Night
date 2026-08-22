/**
 * What a swipe on a list row meant, once the finger has gone.
 *
 * Every rule here is one that can only be felt, never seen: a threshold too
 * eager deletes a place somebody was only scrolling past, one too timid makes
 * the gesture feel broken, and a flick that reads as a fumble does both
 * depending on which way it went. None of it shows up in a screenshot.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const swipe = await import("../lib/ui/swipe.ts");

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log("  ✓", label);
  } catch (error) {
    failures += 1;
    console.log("  ✗", label, "—", error.message.split("\n")[0]);
  }
};

const ROW = { width: 370, reveal: 88, hasLeft: true, hasRight: true };
const settle = (offset, velocity = 0, row = ROW) =>
  swipe.settleSwipe({ offset, velocity, ...row });

console.log("a pull that was not really a pull");

check("a row barely moved goes home", () => {
  for (const offset of [0, 6, -9, 20, -30]) {
    const outcome = settle(offset);
    assert.equal(outcome.x, 0, `${offset}px did not spring back`);
    assert.equal(outcome.commit, null);
    assert.equal(outcome.open, null);
  }
});

check("a pull towards a side with nothing on it always goes home", () => {
  const oneSided = { ...ROW, hasLeft: false };
  // Far enough to commit, in a direction that has no action to commit to.
  const outcome = settle(300, 2000, oneSided);
  assert.deepEqual(outcome, swipe.CLOSED);
});

console.log("opening the button");

check("halfway to the detent opens it, and stops there", () => {
  const outcome = settle(-60);
  assert.equal(outcome.open, "right");
  assert.equal(outcome.commit, null);
  assert.equal(outcome.x, -ROW.reveal, "the row did not come to rest on the detent");
});

check("both directions open their own side", () => {
  assert.equal(settle(-60).open, "right");
  assert.equal(settle(60).open, "left");
  assert.equal(settle(60).x, ROW.reveal);
});

console.log("committing");

check("most of the way across runs the action", () => {
  const outcome = settle(-200);
  assert.equal(outcome.commit, "right");
  assert.equal(outcome.open, null);
  assert.equal(outcome.x, -ROW.width, "a committed row should leave the way it went");
});

check("a fast flick commits from the detent, a slow drag does not", () => {
  assert.equal(settle(-95, -1600).commit, "right", "a flick did not carry");
  assert.equal(settle(-95, -120).commit, null, "a slow drag committed");
});

check("a flick back the way it came is a reversal, not a commit", () => {
  // Pulled left, but the finger was already returning when it lifted.
  const outcome = settle(-95, 1600);
  assert.equal(outcome.commit, null, "a reversal was read as a commit");
});

check("nothing commits before the button has been fully revealed", () => {
  // Whatever the speed: the row has to have been pulled past its own detent.
  for (const velocity of [-900, -3000, -12000]) {
    assert.equal(settle(-40, velocity).commit, null, `${velocity}px/s committed from 40px`);
  }
});

console.log("the numbers behind the feel");

check("the commit threshold scales with the row, and never sits under the detent", () => {
  // On a phone the row is wide and the fraction decides. On a narrow column
  // the fraction would put the threshold inside the button itself, so twice
  // the detent takes over — a row cannot commit before the thing it is
  // committing to has finished appearing.
  const wide = { ...ROW, width: 900 };
  const narrow = { ...ROW, width: 200 };

  assert.equal(settle(-300, 0, wide).commit, null, "a wide row committed too early");
  assert.equal(settle(-380, 0, wide).commit, "right", "a wide row never commits");

  assert.equal(settle(-170, 0, narrow).commit, null, "a narrow row committed inside its button");
  assert.equal(settle(-180, 0, narrow).commit, "right", "a narrow row never commits");
});

check("every outcome is one of the three the row can animate to", () => {
  for (let offset = -360; offset <= 360; offset += 7) {
    for (const velocity of [-2000, -400, 0, 400, 2000]) {
      const outcome = settle(offset, velocity);
      const resting = [0, ROW.reveal, -ROW.reveal, ROW.width, -ROW.width];
      assert.ok(resting.includes(outcome.x), `${offset}px at ${velocity}px/s rests at ${outcome.x}`);
      // A row cannot both run an action and sit open holding it.
      assert.ok(!(outcome.commit && outcome.open), "an outcome both committed and opened");
    }
  }
});

console.log(failures ? `\n${failures} failing.` : "\nAll swipe rules hold.");
process.exit(failures ? 1 : 0);
