/**
 * A trip: a named stretch of time that visits belong to.
 *
 * Trips are an organising layer over the travel record, never a container for
 * it. A place knows which trip it belongs to through `tripId`; a trip knows
 * nothing about its places. That direction matters — renaming a trip touches
 * one row, deleting one leaves every place exactly where it was, and a place
 * with no trip is the normal case rather than an orphan.
 */
export type Trip = {
  /** The sheet's own id, e.g. `TRIP-0001`. Stable across row reordering. */
  id: string;
  name: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  startDate?: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  endDate?: string;
  description?: string;
  /** Optional: the place whose photo represents the trip. */
  coverPlaceId?: string;
  createdAt: string;
  updatedAt: string;
  /** Tombstone, for the same reason places have one. */
  deletedAt?: string;
};

/** Fields a caller supplies when creating a trip; the rest is generated. */
export type NewTripInput = Omit<Trip, "id" | "createdAt" | "updatedAt">;

/** A partial patch. `id` and `createdAt` are immutable once assigned. */
export type TripChanges = Partial<Omit<Trip, "id" | "createdAt">>;
