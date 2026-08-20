"use client";

import { ChevronRight, Luggage, Plus } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { EmptyState } from "@/components/ui/EmptyState";
import {
  formatPlaceCount,
  formatTripLength,
  tripSummary,
} from "@/lib/trips/tripDays";
import { formatVisitRange } from "@/lib/utils/date";
import type { VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * Trips, most recent first.
 *
 * Every number on a card — its length, how many places it holds, which
 * countries it covers — is worked out from the places themselves at render
 * time. Nothing is stored twice, so nothing can go stale when a place is added
 * to a trip or its dates are changed.
 */
export function TripsView({
  trips,
  places,
  loading,
  bottomInset,
  onOpenTrip,
  onCreateTrip,
}: {
  trips: Trip[];
  places: VisitedPlace[];
  loading: boolean;
  bottomInset: number;
  onOpenTrip: (id: string) => void;
  onCreateTrip: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="absolute inset-0 bg-bg">
      <div className="scroll-area absolute inset-0" style={{ paddingBottom: bottomInset }}>
        <div className="mx-auto w-full max-w-[720px] px-4 sm:max-w-[880px]">
          <header
            className="pb-4"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">
                Trips
              </h1>
              {trips.length > 0 ? (
                <button
                  type="button"
                  onClick={onCreateTrip}
                  className="pressable mt-1.5 inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-pill bg-fill px-3.5 text-[14px] font-medium text-accent"
                >
                  <Plus size={15} aria-hidden="true" />
                  New Trip
                </button>
              ) : null}
            </div>
            {!loading && trips.length > 0 ? (
              <p className="mt-1 text-[15px] text-ink-2">
                {trips.length === 1 ? "1 trip" : `${trips.length} trips`}
              </p>
            ) : null}
          </header>

          {loading ? (
            <ul className="space-y-3" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <li key={index} className="skeleton h-[104px] rounded-[20px]" />
              ))}
            </ul>
          ) : trips.length === 0 ? (
            <EmptyState
              className="pt-8"
              icon={<Luggage size={28} aria-hidden="true" />}
              title="No trips yet"
              description="Create a trip to group the places you’ve visited."
              action={
                <button
                  type="button"
                  onClick={onCreateTrip}
                  className="pressable inline-flex min-h-[50px] items-center gap-2 rounded-md bg-accent px-6 text-[17px] font-semibold text-on-accent"
                >
                  <Plus size={19} aria-hidden="true" />
                  Create Trip
                </button>
              }
            />
          ) : (
            <motion.ul
              className="space-y-3 pb-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.3, 1] }}
            >
              {trips.map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  places={places}
                  onOpen={() => onOpenTrip(trip.id)}
                />
              ))}
            </motion.ul>
          )}
        </div>
      </div>

      {/* Keeps scrolling content from running into the status bar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-bg/85 backdrop-blur-xl"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />
    </div>
  );
}

/** One trip: what it was called, when it was, and how much is in it. */
function TripRow({
  trip,
  places,
  onOpen,
}: {
  trip: Trip;
  places: VisitedPlace[];
  onOpen: () => void;
}) {
  const summary = tripSummary(trip, places);
  const when = formatVisitRange(trip.startDate, trip.endDate);
  const length = formatTripLength(summary.days);

  // Cities read better than countries on a single-country trip, and countries
  // better on a sprawling one. Whichever there are more of is the useful line.
  const where =
    summary.countries.length > 1
      ? summary.countries.slice(0, 3).join(" · ")
      : summary.cities.slice(0, 3).join(" · ") || summary.countries.join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="pressable flex w-full items-center gap-3 rounded-[20px] bg-fill/60 px-4 py-4 text-left"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Luggage size={20} aria-hidden="true" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[18px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {trip.name}
          </span>
          {when ? (
            <span className="mt-0.5 block truncate text-[14px] text-ink-2">{when}</span>
          ) : null}
          <span className="mt-0.5 block truncate text-[13px] tabular-nums text-ink-3">
            {[length, formatPlaceCount(summary.places)].filter(Boolean).join(" · ")}
          </span>
          {where ? (
            <span className="mt-0.5 block truncate text-[13px] text-ink-3">{where}</span>
          ) : null}
        </span>

        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
      </button>
    </li>
  );
}
