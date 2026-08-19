import type { VisitedPlace } from "@/types/place";

/**
 * Writes that haven't reached the sheet yet.
 *
 * A save is never dropped because the network wasn't there. It goes on this
 * queue, the queue survives a reload because it lives in localStorage, and it
 * drains as soon as a request succeeds again. Until it drains the app says so
 * rather than showing a change that only exists on this device.
 */

const KEY = "travel-globe.sheet-queue.v1";

export type PendingUpsert = {
  kind: "upsert";
  /** The id the record has in the app right now — temporary for offline creates. */
  key: string;
  /** The sheet's own id, absent until the sheet has assigned one. */
  id?: string;
  tab: string;
  fields: Record<string, string>;
  queuedAt: string;
};

export type PendingDelete = {
  kind: "delete";
  key: string;
  id: string;
  tab: string;
  queuedAt: string;
};

export type PendingWrite = PendingUpsert | PendingDelete;

/**
 * A record created while offline has no sheet id yet, so it carries a local
 * one until the sheet assigns the real thing.
 */
export const LOCAL_ID_PREFIX = "local-";

export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

export function loadQueue(): PendingWrite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingWrite[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: PendingWrite[]): void {
  if (typeof window === "undefined") return;
  try {
    if (queue.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Losing the queue to a full disk is bad, but throwing here would also
    // lose the edit that is already in memory. The status indicator still
    // reports the write as pending.
  }
}

/**
 * Adds a write, folding it into one already waiting for the same record.
 *
 * Typing in a form produces an edit per keystroke; without this, a minute of
 * typing would become a minute of separate requests and Apps Script's quota
 * would run out long before the sentence did.
 */
export function enqueue(queue: PendingWrite[], write: PendingWrite): PendingWrite[] {
  const next = [...queue];
  const at = next.findIndex((pending) => pending.key === write.key);

  if (write.kind === "delete") {
    // A delete supersedes any edit still waiting: the row is going away.
    // A record that was only ever local disappears with its queued create.
    const filtered = next.filter((pending) => pending.key !== write.key);
    if (isLocalId(write.id)) return filtered;
    return [...filtered, write];
  }

  if (at === -1) return [...next, write];

  const existing = next[at];
  if (existing.kind === "delete") {
    // Editing something already queued for deletion: the deletion still wins,
    // because that is the more recent intent the person expressed.
    return next;
  }

  next[at] = {
    ...existing,
    id: write.id ?? existing.id,
    fields: { ...existing.fields, ...write.fields },
    queuedAt: write.queuedAt,
  };
  return next;
}

/** Drops the write that just succeeded, by identity rather than by position. */
export function settle(queue: PendingWrite[], write: PendingWrite): PendingWrite[] {
  return queue.filter((pending) => pending !== write);
}

/**
 * Rewrites a temporary id to the one the sheet assigned.
 *
 * Anything queued behind an offline create refers to it by its local id; once
 * the create lands, those must point at the real row or they would create a
 * second one.
 */
export function adoptId(queue: PendingWrite[], localKey: string, assignedId: string): PendingWrite[] {
  return queue.map((pending) =>
    pending.key === localKey ? { ...pending, key: assignedId, id: assignedId } : pending,
  );
}

export function pendingKeys(queue: PendingWrite[]): Set<string> {
  return new Set(queue.map((pending) => pending.key));
}

/** Places whose edits are still only on this device, for the "not saved yet" mark. */
export function markPending(places: VisitedPlace[], queue: PendingWrite[]): Set<string> {
  const keys = pendingKeys(queue);
  return new Set(places.filter((place) => keys.has(place.id)).map((place) => place.id));
}
