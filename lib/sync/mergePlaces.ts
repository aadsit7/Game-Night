import type { VisitedPlace } from "@/types/place";

/**
 * Reconciles two copies of the collection.
 *
 * Every record carries `updatedAt`, and deletions are tombstones rather than
 * removals, so the rule is simply "the most recently touched version of each
 * id wins" — which makes a delete on one device beat an older edit on another,
 * and a newer edit beat an older delete, without either side needing to know
 * what the other did.
 *
 * This is last-write-wins per record, not per field: two devices editing the
 * *same* place while both offline will keep one of the two edits, not a blend.
 * For a personal travel journal that is the right trade — the alternative is a
 * merge UI nobody wants to use.
 */
export function mergePlaces(
  local: VisitedPlace[],
  remote: VisitedPlace[],
): VisitedPlace[] {
  const byId = new Map<string, VisitedPlace>();

  for (const place of [...remote, ...local]) {
    const existing = byId.get(place.id);
    if (!existing) {
      byId.set(place.id, place);
      continue;
    }
    byId.set(place.id, newerOf(existing, place));
  }

  return [...byId.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function newerOf(a: VisitedPlace, b: VisitedPlace): VisitedPlace {
  const at = Date.parse(a.updatedAt);
  const bt = Date.parse(b.updatedAt);
  if (Number.isNaN(at)) return b;
  if (Number.isNaN(bt)) return a;
  if (at === bt) {
    // Identical timestamps: let a deletion settle it, so the two sides agree
    // on the outcome no matter which order they merged in.
    if (a.deletedAt && !b.deletedAt) return a;
    if (b.deletedAt && !a.deletedAt) return b;
    return a;
  }
  return at > bt ? a : b;
}

/** True when the two collections would render identically. */
export function sameCollection(a: VisitedPlace[], b: VisitedPlace[]): boolean {
  if (a.length !== b.length) return false;
  const key = (place: VisitedPlace) => `${place.id}:${place.updatedAt}:${place.deletedAt ?? ""}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Tombstones are only needed until every device has seen them. Dropping ones
 * older than this keeps the stored file from growing without bound.
 */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function pruneTombstones(places: VisitedPlace[], now = Date.now()): VisitedPlace[] {
  return places.filter((place) => {
    if (!place.deletedAt) return true;
    const at = Date.parse(place.deletedAt);
    return Number.isNaN(at) || now - at < TOMBSTONE_TTL_MS;
  });
}
