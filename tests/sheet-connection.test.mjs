/**
 * Exercises how the app decides which sheet to talk to.
 *
 * The built-in connection is the one thing here that is edited by hand rather
 * than typed into a form, so nothing validates it at the moment it is pasted.
 * These tests do it at build time instead: a `/dev` address, a missing `/exec`,
 * or half a pair fails `npm test` rather than failing silently in a browser on
 * the other side of a deploy.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { DEFAULT_ACCESS_CODE, DEFAULT_WEB_APP_URL, defaultConnection, hasDefaultConnection } =
  await import("../lib/sheets/defaultConnection.ts");

const { loadConnection, loadOverride, validateUrl } = await import(
  "../lib/sheets/connection.ts"
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

console.log("sheet connection");

test("a built-in address, if there is one, is a deployed /exec address", () => {
  if (!DEFAULT_WEB_APP_URL.trim()) return; // Nothing baked in; nothing to check.

  const problem = validateUrl(DEFAULT_WEB_APP_URL);
  assert.equal(
    problem,
    null,
    `DEFAULT_WEB_APP_URL in lib/sheets/defaultConnection.ts is not usable: ${problem}`,
  );
});

test("both halves are required, or the app falls back to asking", () => {
  // An address with no code, or a code with no address, reaches nothing. The
  // setup screen is a far better outcome than a stream of rejected requests.
  const complete = Boolean(DEFAULT_WEB_APP_URL.trim()) && Boolean(DEFAULT_ACCESS_CODE.trim());
  assert.equal(hasDefaultConnection(), complete);
  assert.equal(defaultConnection() === null, !complete);
});

test("hasDefaultConnection and defaultConnection never disagree", () => {
  assert.equal(hasDefaultConnection(), defaultConnection() !== null);
});

test("the built-in connection is trimmed, not passed through raw", () => {
  const connection = defaultConnection();
  if (!connection) return;

  assert.equal(connection.url, connection.url.trim());
  assert.equal(connection.code, connection.code.trim());
});

test("with no browser there is no override, so the built-in one is used", () => {
  // Node has no localStorage, which is the same position the static export is
  // in while it renders. Neither may throw.
  assert.equal(loadOverride(), null);
  assert.deepEqual(loadConnection(), defaultConnection());
});

test("a /dev address is rejected — it serves the unpublished draft", () => {
  assert.match(
    validateUrl("https://script.google.com/macros/s/AKfycbx/dev") ?? "",
    /draft/i,
  );
});

test("an address that isn't a deployment is rejected", () => {
  assert.ok(validateUrl("https://script.google.com/home/projects/abc/edit"));
  assert.ok(validateUrl("http://script.google.com/macros/s/AKfycbx/exec"), "https only");
  assert.ok(validateUrl("https://example.com/macros/s/AKfycbx/exec"), "Google only");
  assert.ok(validateUrl("not a url"));
  assert.ok(validateUrl(""));
});

test("a real /exec address is accepted", () => {
  assert.equal(
    validateUrl("https://script.google.com/macros/s/AKfycbxSomeLongRandomId/exec"),
    null,
  );
  assert.equal(
    validateUrl("  https://script.google.com/macros/s/AKfycbxSomeLongRandomId/exec  "),
    null,
    "surrounding whitespace from a paste is fine",
  );
});

if (failures > 0) {
  console.error(`\n${failures} connection test(s) failed.`);
  process.exit(1);
}
console.log("  all connection tests passed\n");
