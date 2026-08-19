/**
 * Every paint expression the globe applies, run through MapLibre's own style
 * spec.
 *
 * These fail *silently* at runtime — the renderer fires an error event nobody
 * is listening for and quietly keeps the previous paint — so a type-check
 * passing says nothing about whether the map will actually honour them. This
 * caught `["case", selected, 11, <interpolate on zoom>]`, which TypeScript is
 * perfectly happy with and MapLibre rejects outright.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";
import {
  createPropertyExpression,
  latest as styleSpec,
} from "@maplibre/maplibre-gl-style-spec";

const paint = await import("../lib/maps/basemap.ts");

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

/**
 * The real property definitions out of the spec package, not hand-written
 * stand-ins — the point is to validate exactly what the renderer validates.
 */
const SPEC = {
  "circle-radius": styleSpec.paint_circle["circle-radius"],
  "circle-color": styleSpec.paint_circle["circle-color"],
  "circle-stroke-width": styleSpec.paint_circle["circle-stroke-width"],
  "text-opacity": styleSpec.paint_symbol["text-opacity"],
  "symbol-sort-key": styleSpec.layout_symbol["symbol-sort-key"],
};

for (const [name, def] of Object.entries(SPEC)) {
  if (!def) throw new Error(`the style spec has no definition for ${name}`);
}

function compile(property, value) {
  return createPropertyExpression(value, property, SPEC[property]);
}

function valid(property, value) {
  const result = compile(property, value);
  if (result.result === "error") {
    throw new Error(result.value.map((e) => `${property}: ${e.message}`).join("; "));
  }
}

console.log("pin paint expressions (selected and unselected)");

for (const selectedId of ["place-123", null]) {
  const state = selectedId ? "with a selection" : "with nothing selected";
  const selected = paint.selectedFilter(selectedId);

  check(`circle-radius ${state}`, () => valid("circle-radius", paint.pinRadius(selected)));
  check(`circle-color ${state}`, () => valid("circle-color", paint.pinColor(selected)));
  check(`circle-stroke-width ${state}`, () =>
    valid("circle-stroke-width", paint.pinStrokeWidth(selected)));
  check(`text-opacity ${state}`, () => valid("text-opacity", paint.labelOpacity(selected)));
  check(`symbol-sort-key ${state}`, () =>
    valid("symbol-sort-key", paint.labelSortKey(selected)));
}

console.log("layer defaults");
check("circle-radius default", () => valid("circle-radius", paint.PIN_RADIUS_DEFAULT));
check("text-opacity default", () => valid("text-opacity", paint.LABEL_OPACITY_DEFAULT));

console.log("the behaviour the expressions are meant to encode");

check("a selected pin is bigger than an unselected one at every zoom", () => {
  const on = compile("circle-radius", paint.pinRadius(paint.selectedFilter("x")));
  const feature = { properties: { id: "x" } };
  const other = { properties: { id: "y" } };
  for (const zoom of [1, 2, 4, 7, 10, 14]) {
    const selected = on.value.evaluate({ zoom }, feature);
    const plain = on.value.evaluate({ zoom }, other);
    assert.ok(
      selected > plain,
      `at zoom ${zoom} the selected radius ${selected} is not larger than ${plain}`,
    );
  }
});

check("pins grow with zoom rather than staying a fixed size", () => {
  const expr = compile("circle-radius", paint.PIN_RADIUS_DEFAULT);
  const near = expr.value.evaluate({ zoom: 1 }, {});
  const far = expr.value.evaluate({ zoom: 10 }, {});
  assert.ok(far > near, `radius did not grow: ${near} → ${far}`);
});

check("the selected label is visible at globe zoom, others are not", () => {
  const expr = compile("text-opacity", paint.labelOpacity(paint.selectedFilter("x")));
  const zoom = paint.LABEL_FADE_START - 1;
  assert.equal(expr.value.evaluate({ zoom }, { properties: { id: "x" } }), 1);
  assert.equal(expr.value.evaluate({ zoom }, { properties: { id: "y" } }), 0);
});

check("every label is readable once zoomed in", () => {
  const expr = compile("text-opacity", paint.labelOpacity(paint.selectedFilter(null)));
  assert.equal(expr.value.evaluate({ zoom: paint.LABEL_FADE_END }, { properties: { id: "y" } }), 1);
});

console.log(failures ? `\n${failures} failing.` : "\nAll paint expressions are valid.");
process.exit(failures ? 1 : 0);
