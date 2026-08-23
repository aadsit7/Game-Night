/**
 * The Google Photos status answer, as the app reads it.
 *
 * The script grew two authorisation modes, and the fields that tell them
 * apart (`mode`, `scopeGranted`, `advice`) simply do not exist in older
 * deployments' answers. These tests pin the compatibility contract: an old
 * script's answer must keep reading as the OAuth-client mode it is — so a
 * connection made under the old world keeps working untouched — and a new
 * script-mode answer must read as ready with nothing to connect.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { photosAuthStatus } = await import("../lib/sheets/sheetsClient.ts");

const connection = { url: "https://script.google.com/macros/s/mock/exec", code: "test" };

/** The next photosAuthStatus call answers with this envelope's data. */
function answerWith(data) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

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

console.log("photos auth status");

await test("an old script's answer still reads as the OAuth mode it is", async () => {
  // Word for word what a pre-manifest deployment sends: no mode, no
  // scopeGranted, no advice. It must land as a live OAuth connection.
  answerWith({
    configured: true,
    connected: true,
    connectedAt: "2026-01-01T00:00:00",
    accountHint: "owner@example.com",
    redirectUri: "https://script.google.com/macros/s/mock/exec",
  });
  const status = await photosAuthStatus(connection);
  assert.equal(status.mode, "oauth");
  assert.equal(status.connected, true);
  assert.equal(status.scopeGranted, false);
  assert.equal(status.advice, "");
  assert.equal(status.connectedAt, "2026-01-01T00:00:00");
});

await test("a script-mode deployment reads as ready, with nothing to connect", async () => {
  answerWith({
    configured: true,
    connected: true,
    mode: "script",
    scopeGranted: true,
    advice: "",
    connectedAt: "",
    accountHint: "",
    redirectUri: "https://script.google.com/macros/s/mock/exec",
  });
  const status = await photosAuthStatus(connection);
  assert.equal(status.mode, "script");
  assert.equal(status.connected, true);
  assert.equal(status.scopeGranted, true);
});

await test("a missing scope arrives not-connected, carrying the script's advice", async () => {
  answerWith({
    configured: false,
    connected: false,
    mode: "script",
    scopeGranted: false,
    advice: "One-time step: add the Google Photos Picker scope to the script’s appsscript.json manifest and re-authorise the deployment — see docs/SHEET-SETUP.md → Google Photos.",
  });
  const status = await photosAuthStatus(connection);
  assert.equal(status.mode, "script");
  assert.equal(status.connected, false);
  assert.equal(status.configured, false);
  assert.match(status.advice, /appsscript\.json/);
  // Absent legacy fields read as empty strings, never as "undefined".
  assert.equal(status.connectedAt, "");
  assert.equal(status.redirectUri, "");
});

if (failures > 0) {
  console.error(`\n${failures} photos auth status test(s) failed.`);
  process.exit(1);
}
console.log("  all photos auth status tests passed\n");
