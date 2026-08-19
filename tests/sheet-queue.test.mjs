/**
 * Exercises the offline write queue.
 *
 * These rules decide whether an edit made without a connection survives. The
 * failure they guard against is quiet: a queue that duplicates a create makes
 * two rows in the sheet, and one that drops an edit loses it with no error
 * anywhere.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { LOCAL_ID_PREFIX, adoptId, enqueue, isLocalId, markPending, pendingKeys, settle } =
  await import("../lib/sheets/queue.ts");

const upsert = (key, fields, id = key) => ({
  kind: "upsert",
  key,
  id: isLocalId(key) ? undefined : id,
  tab: "Places",
  fields,
  queuedAt: "2026-08-19T10:00:00.000Z",
});

const remove = (key) => ({
  kind: "delete",
  key,
  id: key,
  tab: "Places",
  queuedAt: "2026-08-19T10:00:00.000Z",
});

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

console.log("sheet queue");

test("edits to one record collapse into a single write", () => {
  // Typing in a form fires an edit per keystroke. One request per keystroke
  // would exhaust the Apps Script quota inside a sentence.
  let queue = [];
  queue = enqueue(queue, upsert("PL-0001", { "Place Name": "Kyo" }));
  queue = enqueue(queue, upsert("PL-0001", { "Place Name": "Kyoto" }));
  queue = enqueue(queue, upsert("PL-0001", { "Personal Notes": "Temples" }));

  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0].fields, { "Place Name": "Kyoto", "Personal Notes": "Temples" });
});

test("edits to different records stay separate", () => {
  let queue = [];
  queue = enqueue(queue, upsert("PL-0001", { "Place Name": "Kyoto" }));
  queue = enqueue(queue, upsert("PL-0002", { "Place Name": "Osaka" }));

  assert.equal(queue.length, 2);
});

test("a delete supersedes edits still waiting on that record", () => {
  let queue = [];
  queue = enqueue(queue, upsert("PL-0001", { "Place Name": "Kyoto" }));
  queue = enqueue(queue, remove("PL-0001"));

  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, "delete");
});

test("deleting a place created offline cancels it outright", () => {
  // The sheet has never heard of this record, so there is nothing to soft
  // delete — sending one would be an error about a row that doesn't exist.
  const local = `${LOCAL_ID_PREFIX}abc`;
  let queue = enqueue([], upsert(local, { "Place Name": "Typo" }));
  queue = enqueue(queue, remove(local));

  assert.equal(queue.length, 0);
});

test("editing something already queued for deletion does not revive it", () => {
  let queue = enqueue([], remove("PL-0001"));
  queue = enqueue(queue, upsert("PL-0001", { "Place Name": "Kyoto" }));

  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, "delete", "the deletion is the more recent intent");
});

test("an offline create hands its id on to everything queued behind it", () => {
  const local = `${LOCAL_ID_PREFIX}abc`;
  let queue = enqueue([], upsert(local, { "Place Name": "Kyoto" }));
  queue = enqueue(queue, upsert(local, { "Personal Notes": "Temples" }));
  assert.equal(queue.length, 1, "both fold into the create while it is still local");

  queue = adoptId(queue, local, "PL-0007");
  assert.equal(queue[0].key, "PL-0007");
  assert.equal(queue[0].id, "PL-0007", "or the next write would create a second row");
});

test("settling removes exactly the write that succeeded", () => {
  const first = upsert("PL-0001", { "Place Name": "Kyoto" });
  const second = upsert("PL-0002", { "Place Name": "Osaka" });
  const queue = settle([first, second], first);

  assert.equal(queue.length, 1);
  assert.equal(queue[0].key, "PL-0002");
});

test("pending records are reported so the app can say 'not saved yet'", () => {
  const queue = [upsert("PL-0001", { "Place Name": "Kyoto" })];
  const places = [
    { id: "PL-0001", name: "Kyoto" },
    { id: "PL-0002", name: "Osaka" },
  ];

  assert.deepEqual([...pendingKeys(queue)], ["PL-0001"]);
  assert.deepEqual([...markPending(places, queue)], ["PL-0001"]);
});

if (failures > 0) {
  console.error(`\n${failures} queue test(s) failed.`);
  process.exit(1);
}
console.log("  all queue tests passed\n");
