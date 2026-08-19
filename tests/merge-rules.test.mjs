/**
 * Exercises the sync merge rules directly — the part that decides whether one
 * device's edit or another's delete wins. Getting this wrong loses data, and
 * the browser suite can't reach GitHub from this sandbox.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";

const { mergePlaces, pruneTombstones, sameCollection } = await import(
  "../lib/sync/mergePlaces.ts"
);

const place = (id, updatedAt, extra = {}) => ({
  id,
  name: id,
  country: "Nowhere",
  latitude: 0,
  longitude: 0,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt,
  ...extra,
});

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log("  ✓", label);
  } catch (error) {
    failures += 1;
    console.log("  ✗", label, "—", error.message);
  }
};

console.log("merge rules");

check("a newer edit on one device beats an older one on the other", () => {
  const merged = mergePlaces(
    [place("a", "2025-06-02T00:00:00.000Z", { name: "newer" })],
    [place("a", "2025-06-01T00:00:00.000Z", { name: "older" })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "newer");
});

check("a delete propagates rather than being undone by a stale copy", () => {
  const merged = mergePlaces(
    [place("a", "2025-06-01T00:00:00.000Z")],
    [place("a", "2025-06-02T00:00:00.000Z", { deletedAt: "2025-06-02T00:00:00.000Z" })],
  );
  assert.equal(merged[0].deletedAt, "2025-06-02T00:00:00.000Z");
});

check("re-adding after a delete wins over the older tombstone", () => {
  const merged = mergePlaces(
    [place("a", "2025-06-03T00:00:00.000Z", { name: "back" })],
    [place("a", "2025-06-02T00:00:00.000Z", { deletedAt: "2025-06-02T00:00:00.000Z" })],
  );
  assert.equal(merged[0].deletedAt, undefined);
  assert.equal(merged[0].name, "back");
});

check("records only one side has are kept, not dropped", () => {
  const merged = mergePlaces(
    [place("local-only", "2025-06-01T00:00:00.000Z")],
    [place("remote-only", "2025-06-01T00:00:00.000Z")],
  );
  assert.deepEqual(merged.map((p) => p.id).sort(), ["local-only", "remote-only"]);
});

check("merging is order-independent on identical timestamps", () => {
  const a = place("a", "2025-06-01T00:00:00.000Z", { name: "edit" });
  const b = place("a", "2025-06-01T00:00:00.000Z", { deletedAt: "2025-06-01T00:00:00.000Z" });
  assert.equal(mergePlaces([a], [b])[0].deletedAt, mergePlaces([b], [a])[0].deletedAt);
});

check("merging is idempotent", () => {
  const local = [place("a", "2025-06-02T00:00:00.000Z"), place("b", "2025-06-01T00:00:00.000Z")];
  const remote = [place("a", "2025-06-01T00:00:00.000Z"), place("c", "2025-06-03T00:00:00.000Z")];
  const once = mergePlaces(local, remote);
  const twice = mergePlaces(once, remote);
  assert.ok(sameCollection(once, twice));
});

console.log("tombstone pruning");

check("recent tombstones survive so other devices still see the delete", () => {
  const recent = place("a", "2025-06-01T00:00:00.000Z", {
    deletedAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(pruneTombstones([recent]).length, 1);
});

check("ancient tombstones are dropped so the file can't grow forever", () => {
  const old = place("a", "2020-01-01T00:00:00.000Z", { deletedAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(pruneTombstones([old]).length, 0);
});

check("live records are never pruned", () => {
  assert.equal(pruneTombstones([place("a", "2020-01-01T00:00:00.000Z")]).length, 1);
});

console.log(failures === 0 ? "\nAll merge rules hold." : `\n${failures} failing.`);
process.exitCode = failures === 0 ? 0 : 1;
