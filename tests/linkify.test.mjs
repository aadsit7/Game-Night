/**
 * The linkifier under the guidance texts. Setup advice from the script can
 * carry the exact Google console page that fixes a problem; these pin that
 * the address comes out whole and tappable, that the sentence punctuation
 * around it stays text, and that nothing else is ever turned into a link.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { linkifyText } = await import("../lib/ui/linkify.ts");

let failures = 0;
async function test(name, body) {
  try {
    await body();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log("linkify");

await test("plain text passes through as one inert segment", () => {
  assert.deepEqual(linkifyText("Nothing to tap here."), [
    { text: "Nothing to tap here." },
  ]);
});

await test("a console URL mid-sentence links whole, its trailing comma staying text", () => {
  const url =
    "https://console.developers.google.com/apis/api/photospicker.googleapis.com/overview?project=000000000000";
  const segments = linkifyText(`Enable the API at ${url}, then try again.`);
  assert.deepEqual(segments, [
    { text: "Enable the API at " },
    { text: url, href: url },
    { text: "," },
    { text: " then try again." },
  ]);
});

await test("a URL ending the sentence keeps the full stop out of the address", () => {
  const segments = linkifyText("See https://example.com/fix.");
  assert.deepEqual(segments, [
    { text: "See " },
    { text: "https://example.com/fix", href: "https://example.com/fix" },
    { text: "." },
  ]);
});

await test("every URL in the text links, independently", () => {
  const segments = linkifyText("First https://a.example then https://b.example done");
  assert.deepEqual(
    segments.filter((segment) => segment.href).map((segment) => segment.href),
    ["https://a.example", "https://b.example"],
  );
});

await test("only https links — plain http and bare schemes stay text", () => {
  for (const text of ["Visit http://example.com now", "A stray https:// alone"]) {
    assert.equal(
      linkifyText(text).some((segment) => segment.href),
      false,
      `expected no link in: ${text}`,
    );
  }
});

if (failures > 0) {
  console.error(`\n${failures} linkify test(s) failed.`);
  process.exit(1);
}
console.log("  all linkify tests passed\n");
