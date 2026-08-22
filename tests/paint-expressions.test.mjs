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
const theme = await import("../lib/maps/theme.ts");
const markers = await import("../lib/maps/flagMarkers.ts");

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
  "icon-size": styleSpec.layout_symbol["icon-size"],
  "icon-image": styleSpec.layout_symbol["icon-image"],
};

/**
 * `icon-offset` and `text-offset` are handed to the renderer as plain
 * two-number arrays, which is how every offset in this app is written and what
 * the spec calls for. They are deliberately not run through the expression
 * compiler: to that, a bare `[13, -13]` is a call to an operator named `13`.
 */
const OFFSET_SPEC = {
  "icon-offset": styleSpec.layout_symbol["icon-offset"],
  "text-offset": styleSpec.layout_symbol["text-offset"],
};
for (const [name, def] of Object.entries(OFFSET_SPEC)) {
  if (!def || def.type !== "array" || def.length !== 2) {
    throw new Error(`the spec no longer describes ${name} as a pair of numbers`);
  }
}

function validOffset(property, value) {
  assert.ok(Array.isArray(value) && value.length === 2, `${property} is not a pair`);
  for (const part of value) {
    assert.ok(Number.isFinite(part), `${property} has a non-number in it: ${part}`);
  }
}

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

console.log("chip layout expressions (selected and unselected)");

for (const selectedId of ["place-123", null]) {
  const state = selectedId ? "with a selection" : "with nothing selected";
  const selected = paint.selectedFilter(selectedId);

  check(`icon-size ${state}`, () => valid("icon-size", paint.markerIconSize(selected)));
  check(`symbol-sort-key on the chip ${state}`, () =>
    valid("symbol-sort-key", paint.markerSortKey(selected)));
  check(`text-opacity ${state}`, () => valid("text-opacity", paint.labelOpacity(selected)));
  check(`symbol-sort-key on the label ${state}`, () =>
    valid("symbol-sort-key", paint.labelSortKey(selected)));
}

console.log("layer defaults");
check("icon-size default", () => valid("icon-size", paint.MARKER_ICON_SIZE_DEFAULT));
check("icon-image", () => valid("icon-image", paint.MARKER_ICON_IMAGE));
check("halo radius", () => valid("circle-radius", paint.HALO_RADIUS));
check("text-opacity default", () => valid("text-opacity", paint.LABEL_OPACITY_DEFAULT));

console.log("clusters, which are chips too");

check("the cluster's own layout compiles", () => {
  valid("icon-size", paint.clusterIconSize());
  validOffset("icon-offset", paint.countBadgeOffset());
  validOffset("text-offset", paint.countBadgeTextOffset());
});

check("a cluster reads as bigger than one place, at every zoom", () => {
  const one = compile("icon-size", paint.MARKER_ICON_SIZE_DEFAULT);
  const many = compile("icon-size", paint.clusterIconSize());
  for (const zoom of [0, 1, 3, 6, 9]) {
    const single = one.value.evaluate({ zoom }, {});
    const cluster = many.value.evaluate({ zoom }, {});
    assert.ok(cluster > single, `at zoom ${zoom} a cluster (${cluster}) is not bigger than a pin (${single})`);
  }
});

check("the count sits on its badge rather than beside it", () => {
  /* Two properties in two different units describing one point on screen:
     `icon-offset` in the icon's pixels, `text-offset` in ems of the text. Drift
     between them is invisible in code and obvious on the map — a number
     hanging off the edge of the disc it is supposed to be inside. */
  const [iconX, iconY] = paint.countBadgeOffset();
  const [textX, textY] = paint.countBadgeTextOffset();
  const size = paint.COUNT_BADGE_TEXT_SIZE;
  assert.ok(Math.abs(textX * size - iconX) < 0.5, `badge x is ${iconX}px, its number is ${(textX * size).toFixed(1)}px`);
  assert.ok(Math.abs(textY * size - iconY) < 0.5, `badge y is ${iconY}px, its number is ${(textY * size).toFixed(1)}px`);
});

check("the badge hangs clear of the marks the chip already carries", () => {
  // Bottom right belongs to the favourite and wishlist badges, and a cluster
  // wears one of its members' chips — so the count goes the other way.
  const [, y] = paint.countBadgeOffset();
  assert.ok(y < 0, "the count badge is on top of the favourite badge");
});

console.log("the behaviour the expressions are meant to encode");

check("a selected chip is bigger than an unselected one at every zoom", () => {
  const on = compile("icon-size", paint.markerIconSize(paint.selectedFilter("x")));
  const feature = { properties: { id: "x" } };
  const other = { properties: { id: "y" } };
  for (const zoom of [1, 2, 4, 7, 10, 14]) {
    const selected = on.value.evaluate({ zoom }, feature);
    const plain = on.value.evaluate({ zoom }, other);
    assert.ok(
      selected > plain,
      `at zoom ${zoom} the selected size ${selected} is not larger than ${plain}`,
    );
  }
});

check("chips grow with zoom rather than staying a fixed size", () => {
  const expr = compile("icon-size", paint.MARKER_ICON_SIZE_DEFAULT);
  const near = expr.value.evaluate({ zoom: 1 }, {});
  const far = expr.value.evaluate({ zoom: 10 }, {});
  assert.ok(far > near, `size did not grow: ${near} → ${far}`);
});

check("a chip never shrinks so far that the flag inside it stops being one", () => {
  const expr = compile("icon-size", paint.MARKER_ICON_SIZE_DEFAULT);
  for (const zoom of [0, 1, 2, 4, 8, 14]) {
    const size = expr.value.evaluate({ zoom }, {});
    const diameter = size * markers.MARKER_RADIUS * 2;
    assert.ok(diameter >= 20, `at zoom ${zoom} the chip is only ${diameter.toFixed(1)}px across`);
  }
});

check("the selection halo sits proud of the chip it is behind, at every zoom", () => {
  // A halo the chip covers is a halo nobody can see, and the two are sized by
  // separate expressions in different units — one a radius in pixels, one a
  // multiplier on a 32px sprite — so nothing but this keeps them in step.
  const halo = compile("circle-radius", paint.HALO_RADIUS);
  const size = compile("icon-size", paint.markerIconSize(paint.selectedFilter("x")));
  const feature = { properties: { id: "x" } };
  for (const zoom of [0, 1, 3, 6, 8, 12]) {
    const ring = size.value.evaluate({ zoom }, feature) * markers.MARKER_RADIUS;
    const glow = halo.value.evaluate({ zoom }, feature);
    assert.ok(glow > ring, `at zoom ${zoom} the halo (${glow}) is inside the chip (${ring})`);
  }
});

check("the selected chip draws over its neighbours, and its label outranks theirs", () => {
  /* The two sort keys point in opposite directions on purpose, and the spec is
     the reason: with `icon-allow-overlap` on, a *higher* key draws on top; in
     the collision grid, which is where labels live, a *lower* key is placed
     first and wins. Getting either backwards is invisible until two places sit
     on the same city. */
  const chip = compile("symbol-sort-key", paint.markerSortKey(paint.selectedFilter("x")));
  const label = compile("symbol-sort-key", paint.labelSortKey(paint.selectedFilter("x")));
  const mine = { properties: { id: "x" } };
  const theirs = { properties: { id: "y" } };

  assert.ok(
    chip.value.evaluate({ zoom: 4 }, mine) > chip.value.evaluate({ zoom: 4 }, theirs),
    "the selected chip does not sort above its neighbours",
  );
  assert.ok(
    label.value.evaluate({ zoom: 6 }, mine) < label.value.evaluate({ zoom: 6 }, theirs),
    "the selected label does not win placement against its neighbours",
  );
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


console.log("the colour system's own rules");

/** Relative luminance, per WCAG. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

check("dark land is lighter than dark sea, so the night globe has coastlines", () => {
  const dark = theme.paletteFor(true);
  assert.ok(
    luminance(dark.land) > luminance(dark.water),
    `land ${dark.land} is not lighter than water ${dark.water}`,
  );
  const contrast = ratio(dark.land, dark.water);
  assert.ok(contrast >= 1.35, `land/water contrast is only ${contrast.toFixed(2)}:1`);
});

check("light keeps a land/water edge too", () => {
  const light = theme.paletteFor(false);
  const contrast = ratio(light.land, light.water);
  assert.ok(contrast >= 1.35, `land/water contrast is only ${contrast.toFixed(2)}:1`);
});

check("the relief photograph is off in both schemes", () => {
  assert.equal(theme.paletteFor(false).reliefOpacity, 0);
  assert.equal(theme.paletteFor(true).reliefOpacity, 0);
});

check("roads are never in the pin's hue family", () => {
  // A pin and a motorway must not be the same kind of mark. Compare hue by
  // channel order: the pin is red-dominant, the roads must not be.
  for (const dark of [false, true]) {
    const { road, roadMinor } = theme.paletteFor(dark);
    const { pin } = paint.overlayFor(dark);
    const redDominant = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return r > g + 24 && r > b + 24;
    };
    assert.ok(redDominant(pin), `pin ${pin} should be red-dominant`);
    assert.ok(!redDominant(road), `road ${road} shares the pin's hue`);
    assert.ok(!redDominant(roadMinor), `minor road ${roadMinor} shares the pin's hue`);
  }
});

check("the pin reads against land and water in both schemes", () => {
  for (const dark of [false, true]) {
    const ground = theme.paletteFor(dark);
    const { pin, pinWishlist } = paint.overlayFor(dark);
    for (const [label, colour] of [["pin", pin], ["wishlist pin", pinWishlist]]) {
      for (const [name, against] of [["land", ground.land], ["water", ground.water]]) {
        const contrast = ratio(colour, against);
        assert.ok(
          contrast >= 2.4,
          `${dark ? "dark" : "light"} ${label} vs ${name} is ${contrast.toFixed(2)}:1`,
        );
      }
    }
  }
});

/** Hue angle in degrees, which is the axis these two are told apart on. */
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span === 0) return 0;
  const angle =
    max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return ((angle * 60) % 360 + 360) % 360;
}

/** Shortest way round the wheel. */
function hueDistance(a, b) {
  const gap = Math.abs(hue(a) - hue(b)) % 360;
  return gap > 180 ? 360 - gap : gap;
}

check("a place you want to go is not the same mark as one you have been to", () => {
  // Two states of the same 5px dot, so the difference has to carry on colour
  // alone. Contrast is the wrong axis here — a red and a violet of the same
  // lightness are unmistakable and would fail a ratio test — so this measures
  // the axis they actually differ on.
  for (const dark of [false, true]) {
    const { pin, pinWishlist } = paint.overlayFor(dark);
    assert.notEqual(pin, pinWishlist);

    const apart = hueDistance(pin, pinWishlist);
    assert.ok(
      apart >= 60,
      `${dark ? "dark" : "light"} wishlist pin is only ${apart.toFixed(0)}° from the visited pin`,
    );

    // And not simply the selection colour by another name: three states on one
    // dot, all three of which have to be distinct.
    const { pinSelected } = paint.overlayFor(dark);
    assert.ok(
      hueDistance(pinWishlist, pinSelected) >= 40,
      `${dark ? "dark" : "light"} wishlist pin is too close to the selected pin`,
    );
  }
});

check("a place you want to go asks the renderer for a different chip", () => {
  // Validity is not the same as correctness: the sprite id is what carries
  // wishlist-ness onto the globe now that the mark is a flag rather than a
  // coloured dot, so this checks the id the feature actually asks for.
  const wish = markers.markerImageId("JP", "wishlist");
  const been = markers.markerImageId("JP", "visited");
  const loved = markers.markerImageId("JP", "favorite");
  assert.notEqual(wish, been);
  assert.notEqual(loved, been);
  assert.notEqual(wish, loved);
  // And the same place always asks for the same picture.
  assert.equal(markers.markerImageId("jp", "visited"), been);
});

check("the wishlist colour is outside the water's hue family too", () => {
  for (const dark of [false, true]) {
    const { water } = theme.paletteFor(dark);
    const { pinWishlist } = paint.overlayFor(dark);
    const contrast = ratio(pinWishlist, water);
    assert.ok(
      contrast >= 2.4,
      `${dark ? "dark" : "light"} wishlist pin vs water is ${contrast.toFixed(2)}:1`,
    );
  }
});

check("visited countries are not in the water's hue family", () => {
  // A blue country on a blue sea is the one adjacency this map cannot afford:
  // at globe zoom most of a country's perimeter is coastline.
  for (const dark of [false, true]) {
    const { water } = theme.paletteFor(dark);
    const { country } = paint.overlayFor(dark);
    // Hue, not saturation: both a near-black navy and a desaturated blue-grey
    // are unmistakably in the water family, and neither clears a ratio test.
    const blueDominant = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return b === Math.max(r, g, b) && b - r >= 12;
    };
    assert.ok(blueDominant(water), `water ${water} should be blue-dominant`);
    assert.ok(!blueDominant(country), `country ${country} shares the water's hue`);
  }
});

check("the selected pin is distinguishable from an unselected one", () => {
  for (const dark of [false, true]) {
    const { pin, pinSelected } = paint.overlayFor(dark);
    assert.notEqual(pin, pinSelected);
    // Brighter in dark, darker in light: salience is measured against the
    // ground, not in the abstract.
    const brighter = luminance(pinSelected) > luminance(pin);
    assert.equal(brighter, dark, `${dark ? "dark" : "light"} selection went the wrong way`);
  }
});

check("the country outline contains the fill rather than competing with it", () => {
  for (const dark of [false, true]) {
    const { country, countryLine } = paint.overlayFor(dark);
    const lighter = luminance(countryLine) > luminance(country);
    // On a dark map the containing edge has to be the lighter of the two.
    assert.equal(lighter, dark, `${dark ? "dark" : "light"} country outline went the wrong way`);
  }
});

console.log(failures ? `\n${failures} failing.` : "\nAll paint and palette rules hold.");
process.exit(failures ? 1 : 0);
