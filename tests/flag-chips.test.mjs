/**
 * The flag chip's logic, which the globe and the lists share.
 *
 * None of this can be caught by type-checking: an emoji built from the wrong
 * code point is a valid string, a variant that loses a precedence contest is a
 * valid variant, and a sprite id that changes shape between the place that
 * registers the image and the place that asks for it is two valid strings that
 * never meet — the symptom of which is a globe with no pins on it and nothing
 * in the console but "image not found".
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const flags = await import("../lib/ui/flags.ts");
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

console.log("the flag itself");

check("a country code becomes its regional-indicator pair", () => {
  assert.equal(flags.flagEmoji("JP"), "\u{1F1EF}\u{1F1F5}");
  assert.equal(flags.flagEmoji("us"), "\u{1F1FA}\u{1F1F8}");
  assert.equal(flags.flagEmoji("Fr"), "\u{1F1EB}\u{1F1F7}");
});

check("anything that is not a country code is no flag at all", () => {
  for (const value of [undefined, "", "U", "USA", "1A", "u1", "  "]) {
    assert.equal(flags.flagEmoji(value), null, `${JSON.stringify(value)} produced a flag`);
  }
});

check("the letters fallback is the code, upper-cased", () => {
  assert.equal(flags.countryInitials("jp"), "JP");
  assert.equal(flags.countryInitials(undefined), "");
});

check("a country's fallback colour is stable, and countries differ", () => {
  assert.equal(flags.flagTint("JP"), flags.flagTint("jp"));
  assert.notEqual(flags.flagTint("AR"), flags.flagTint("AT"));
});

check("with no canvas to ask, the chip assumes flags work", () => {
  // The server-render path. Assuming the worse answer would ship the letters
  // fallback to every phone that can draw flags perfectly well.
  assert.equal(typeof document, "undefined");
  assert.equal(flags.flagEmojiSupported(), true);
});

console.log("which mark a place gets");

check("a wish outranks a favourite, and a favourite outranks a plain visit", () => {
  assert.equal(flags.flagVariant({ wantToGo: true, favorite: true }), "wishlist");
  assert.equal(flags.flagVariant({ favorite: true }), "favorite");
  assert.equal(flags.flagVariant({}), "visited");
  // A place saved before either flag existed carries neither property.
  assert.equal(flags.flagVariant({ wantToGo: undefined, favorite: undefined }), "visited");
});

console.log("the sprite the renderer is asked for");

check("the id is the country and the variant, and nothing else", () => {
  assert.equal(markers.markerImageId("JP", "visited"), "flag:JP:visited");
  assert.equal(markers.markerImageId("jp", "favorite"), "flag:JP:favorite");
});

check("a place with no country still asks for a chip that exists", () => {
  // The component registers exactly this id as its fallback; a mid-ocean pin
  // with no country must land on it rather than on a name nobody drew.
  for (const value of [undefined, "", "XYZ"]) {
    assert.equal(markers.markerImageId(value, "visited"), "flag:__:visited");
  }
});

check("drawing without a canvas is a missing chip, not a crash", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(
    markers.drawMarker("JP", "visited", { pin: "#BF421F", pinStroke: "#FFF" }),
    null,
  );
});

console.log(failures ? `\n${failures} failing.` : "\nAll flag-chip rules hold.");
process.exit(failures ? 1 : 0);
