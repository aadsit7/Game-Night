/**
 * Device media: the pure decisions behind "pick a photo or a video straight
 * from the device and it joins the memories".
 *
 * The silent failures this guards against: a Drive file arriving with no
 * MIME type and being refused as "not a photo or a video"; a clip a byte
 * over the limit riding along anyway and blowing the script's request cap;
 * a device hash colliding with the Google Photos item-id space; a bogus
 * file-system date crashing the chronology instead of being left blank.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const {
  DEVICE_MEDIA_BATCH_LIMIT,
  MAX_DEVICE_CLIP_BYTES,
  classifyPickedFile,
  deviceItemId,
  shouldInlineClip,
  takenAtFrom,
} = await import("../lib/photos/deviceMedia.ts");

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

console.log("device media");

/* ------------------------------------------------------------------ *
 * What a picked file is
 * ------------------------------------------------------------------ */

test("a MIME type decides first, whatever the name says", () => {
  assert.equal(classifyPickedFile("holiday.dat", "image/jpeg"), "photo");
  assert.equal(classifyPickedFile("holiday.jpg", "video/mp4"), "video");
});

test("a typeless Drive file falls back to its extension", () => {
  assert.equal(classifyPickedFile("1770516082982.mp4", ""), "video");
  assert.equal(classifyPickedFile("IMG_2041.HEIC", ""), "photo");
  assert.equal(classifyPickedFile("clip.MOV", ""), "video");
});

test("what is neither is refused, not guessed", () => {
  assert.equal(classifyPickedFile("itinerary.pdf", "application/pdf"), null);
  assert.equal(classifyPickedFile("notes.txt", ""), null);
  assert.equal(classifyPickedFile("", ""), null);
});

/* ------------------------------------------------------------------ *
 * Whether the clip's own bytes travel
 * ------------------------------------------------------------------ */

test("a clip at the limit rides along; a byte over stays behind", () => {
  assert.equal(shouldInlineClip(MAX_DEVICE_CLIP_BYTES), true);
  assert.equal(shouldInlineClip(MAX_DEVICE_CLIP_BYTES + 1), false);
});

test("an empty or unknowable size never inlines", () => {
  assert.equal(shouldInlineClip(0), false);
  assert.equal(shouldInlineClip(-1), false);
  assert.equal(shouldInlineClip(Number.NaN), false);
});

test("the limit leaves room for base64 inside one script request", () => {
  // ~50 MB of postData, minus a third for base64, minus the JSON around it.
  assert.ok((MAX_DEVICE_CLIP_BYTES * 4) / 3 < 36 * 1024 * 1024);
});

test("one picking session is capped, not unbounded", () => {
  assert.ok(DEVICE_MEDIA_BATCH_LIMIT >= 1 && DEVICE_MEDIA_BATCH_LIMIT <= 50);
});

/* ------------------------------------------------------------------ *
 * Identity and chronology
 * ------------------------------------------------------------------ */

test("a device id can never collide with a Google Photos item id", () => {
  const id = deviceItemId("abc123");
  assert.equal(id, "device-abc123");
  assert.ok(id.startsWith("device-"));
});

test("the file system's date becomes the capture time, ISO-shaped", () => {
  const iso = takenAtFrom(Date.UTC(2026, 1, 7, 12, 0, 0));
  assert.equal(iso, "2026-02-07T12:00:00.000Z");
});

test("a missing or bogus date is left blank rather than invented", () => {
  assert.equal(takenAtFrom(0), undefined);
  assert.equal(takenAtFrom(-5), undefined);
  assert.equal(takenAtFrom(Number.NaN), undefined);
});

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("All device-media rules hold.");
}
