"use client";

import { Check, Luggage, MapPinMinus, Plus, X } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { canUntag, tagState } from "@/lib/trips/tagging";
import { formatPlaceCount, placesInTrip, sortTrips } from "@/lib/trips/tripDays";
import { formatVisitRange } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * Where a handful of selected places are going.
 *
 * Every trip already in the sheet, with what it already holds, plus the two
 * escapes that keep this from being a dead end: making the trip on the spot,
 * and taking places back out of one. A trip every selected place is already in
 * is ticked rather than hidden — knowing a place is already filed is as useful
 * as filing it, and hiding the row would just make people wonder where it
 * went.
 */
export function TripTagSheet({
  open,
  selected,
  trips,
  places,
  saving,
  onClose,
  onChoose,
  onCreateTrip,
}: {
  open: boolean;
  /** The places about to be tagged. */
  selected: VisitedPlace[];
  trips: Trip[];
  /** Everything saved, for counting what each trip already holds. */
  places: VisitedPlace[];
  saving: boolean;
  onClose: () => void;
  /** `null` takes the selection out of whatever trip it is in. */
  onChoose: (trip: Trip | null) => void;
  onCreateTrip: () => void;
}) {
  const ordered = sortTrips(trips);
  const showRemove = canUntag(selected);
  const count = selected.length;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Add to trip"
      dismissOnBackdrop={!saving}
      header={
        <div className="pb-2 pt-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[20px] font-semibold tracking-[-0.02em] text-ink">
                Add to Trip
              </h2>
              <p className="mt-0.5 truncate text-[14px] text-ink-2">
                {count} {count === 1 ? "place" : "places"} selected
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              disabled={saving}
              className="pressable grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2 disabled:opacity-40"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      }
    >
      <div className="pb-4" aria-busy={saving || undefined}>
        <button
          type="button"
          onClick={onCreateTrip}
          disabled={saving}
          className="pressable flex w-full items-center gap-3 rounded-[16px] py-3 pr-2 text-left disabled:opacity-40"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent">
            <Plus size={19} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-medium text-accent">New Trip</span>
            <span className="block truncate text-[13.5px] text-ink-2">
              Make one and file these into it
            </span>
          </span>
        </button>

        {ordered.length > 0 ? (
          <ul className="mt-1 border-t border-separator pt-1">
            {ordered.map((trip) => {
              const state = tagState(selected, trip.id);
              const when = formatVisitRange(trip.startDate, trip.endDate);
              const held = placesInTrip(trip, places).length;
              return (
                <li key={trip.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(trip)}
                    disabled={saving}
                    aria-pressed={state === "all"}
                    className="pressable flex w-full items-center gap-3 rounded-[16px] py-3 pr-2 text-left disabled:opacity-40"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-fill-strong text-ink-2">
                      <Luggage size={19} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] font-medium text-ink">
                        {trip.name}
                      </span>
                      <span className="block truncate text-[13.5px] text-ink-2">
                        {[when, formatPlaceCount(held)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {/*
                      Ticked when the whole selection is already in this trip;
                      a half-tick when only part of it is, which is the state
                      that tells you the tap will do something.
                    */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full",
                        state === "all"
                          ? "bg-accent text-on-accent"
                          : state === "some"
                            ? "bg-accent-soft text-accent"
                            : "border border-separator",
                      )}
                    >
                      {state === "all" ? (
                        <Check size={14} strokeWidth={3} aria-hidden="true" />
                      ) : state === "some" ? (
                        <span className="h-[2.5px] w-2.5 rounded-full bg-current" />
                      ) : null}
                    </span>
                    <span className="sr-only">
                      {state === "all"
                        ? "every selected place is already in this trip"
                        : state === "some"
                          ? "some selected places are already in this trip"
                          : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            className="pt-3"
            icon={<Luggage size={24} aria-hidden="true" />}
            title="No trips yet"
            description="Make one above and these places go straight into it."
          />
        )}

        {showRemove ? (
          <div className="mt-1 border-t border-separator pt-1">
            <button
              type="button"
              onClick={() => onChoose(null)}
              disabled={saving}
              className="pressable flex w-full items-center gap-3 rounded-[16px] py-3 pr-2 text-left disabled:opacity-40"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-fill text-ink-2">
                <MapPinMinus size={19} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-medium text-ink">
                  Remove from trip
                </span>
                <span className="block truncate text-[13.5px] text-ink-2">
                  The places stay saved — only the trip is cleared
                </span>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
