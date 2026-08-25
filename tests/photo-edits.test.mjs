/**
 * Exercises photo edits made from the viewer.
 *
 * The dangerous mistakes here are shape mistakes: a deleted cover leaving a
 * decapitated card instead of promoting the next photo, or a cleared field
 * going *absent* instead of present-and-empty — absent means "leave the cell
 * alone" all the way down to the sheet, and the photo would resurrect on the
 * next sync.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { makeCoverPhoto, placePhotoRefs, removePlacePhoto } = await import(
  "../lib/places/photoEdits.ts"
);

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

console.log("photo edits");

const PLACE = { coverImage: "a", photos: ["b", "c"] };

test("the viewer's order is cover first, then the rest", () => {
  assert.deepEqual(placePhotoRefs(PLACE), ["a", "b", "c"]);
  assert.deepEqual(placePhotoRefs({ coverImage: undefined, photos: undefined }), []);
});

test("deleting an extra photo leaves everything else standing", () => {
  const changes = removePlacePhoto(PLACE, "b");
  assert.deepEqual(changes, { photos: ["c"] });
  assert.equal("coverImage" in changes, false, "the cover cell is left alone");
});

test("deleting the cover promotes the next photo", () => {
  const changes = removePlacePhoto(PLACE, "a");
  assert.deepEqual(changes, { coverImage: "b", photos: ["c"] });
});

test("deleting the last photo clears the fields rather than omitting them", () => {
  const changes = removePlacePhoto({ coverImage: "a", photos: undefined }, "a");
  assert.equal("coverImage" in changes, true);
  assert.equal(changes.coverImage, undefined);

  const lastExtra = removePlacePhoto({ coverImage: "a", photos: ["b"] }, "b");
  assert.equal("photos" in lastExtra, true);
  assert.equal(lastExtra.photos, undefined);
});

test("a photo the place doesn't hold is nothing to save", () => {
  assert.equal(removePlacePhoto(PLACE, "zz"), null);
  assert.equal(makeCoverPhoto(PLACE, "zz"), null);
});

test("making a cover reorders; it never deletes", () => {
  const changes = makeCoverPhoto(PLACE, "c");
  assert.deepEqual(changes, { coverImage: "c", photos: ["a", "b"] });

  // Every ref survives the move.
  assert.deepEqual(
    placePhotoRefs({ ...PLACE, ...changes }).sort(),
    placePhotoRefs(PLACE).sort(),
  );
});

test("the cover made cover again changes nothing", () => {
  assert.equal(makeCoverPhoto(PLACE, "a"), null);
});

process.exit(failures === 0 ? 0 : 1);
