/**
 * The layering behind stacked sheets.
 *
 * The bug this exists to prevent looked like a rendering glitch and was not
 * one: opening a place from inside a trip drew both sheets in the same
 * rectangle, the trip's headings and the place's headings interleaved on one
 * screen. The cause was paint order coming from the order the sheets happen to
 * be written in the shell rather than the order they were opened in, so the
 * fix is arithmetic and the arithmetic is what is checked here.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { sheetDepth, sheetLayer, scrimLayer, FRONT_LAYER } = await import("../lib/ui/sheetStack.ts");

let failures = 0;
function test(name, body) {
  try {
    body();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log("sheet stack");

test("the sheet opened last is the one in front", () => {
  const stack = [{ kind: "trip" }, { kind: "detail" }];
  assert.equal(sheetDepth(stack, "detail"), 0);
  assert.equal(sheetDepth(stack, "trip"), 1);
});

test("opening the same two the other way round reverses the layering", () => {
  // Which component is written first in the shell must not decide this.
  const stack = [{ kind: "detail" }, { kind: "trip" }];
  assert.equal(sheetDepth(stack, "trip"), 0);
  assert.equal(sheetDepth(stack, "detail"), 1);
});

test("a sheet that is not open is not in anyone's way", () => {
  assert.equal(sheetDepth([{ kind: "trip" }], "form"), 0);
  assert.equal(sheetDepth([], "detail"), 0);
});

test("a sheet always paints above the one behind it", () => {
  for (let depth = 0; depth < 5; depth += 1) {
    assert.ok(
      sheetLayer(depth) > sheetLayer(depth + 1),
      `depth ${depth} should paint above depth ${depth + 1}`,
    );
  }
});

test("a sheet's scrim covers the sheet behind it but never the sheet itself", () => {
  for (let depth = 0; depth < 5; depth += 1) {
    assert.ok(scrimLayer(depth) < sheetLayer(depth), "the scrim stays under its own sheet");
    assert.ok(scrimLayer(depth) > sheetLayer(depth + 1), "and over the one behind");
  }
});

test("sheets stay between the tab bar and the pin-adjust bar", () => {
  // The tab bar sits at 30 and the pin bar at 60; a sheet that escaped either
  // side would be dismissable-but-covered, or would cover the pin controls.
  assert.equal(sheetLayer(0), FRONT_LAYER);
  assert.ok(FRONT_LAYER < 60);
  for (let depth = 0; depth < 8; depth += 1) {
    assert.ok(scrimLayer(depth) > 30, `depth ${depth} still clears the tab bar`);
  }
});

process.exit(failures === 0 ? 0 : 1);
