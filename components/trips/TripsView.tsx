"use client";

import { ChevronRight, Luggage, Plus } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { EmptyState } from "@/components/ui/EmptyState";
import { FlagChip } from "@/components/ui/FlagChip";
import {
  formatPlaceCount,
  formatTripLength,
  tripSummary,
} from "@/lib/trips/tripDays";
import { formatVisitRange } from "@/lib/utils/date";
import type { PlaceVisit, VisitedPlace } from "@/types/place";
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
  visits,
  loading,
  bottomInset,
  onOpenTrip,
  onCreateTrip,
}: {
  trips: Trip[];
  places: VisitedPlace[];
  /** Every logged stay — visit-level trip membership reads from these. */
  visits: PlaceVisit[];
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
            className="pb-3"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">
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
              <p className="mt-1 text-[14px] text-ink-2">
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
              className="space-y-2.5 pb-6 sm:grid sm:grid-cols-2 sm:gap-2.5 sm:space-y-0"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.3, 1] }}
            >
              {trips.map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  places={places}
                  visits={visits}
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

/**
 * Where a trip went, as flags.
 *
 * A trip's identity is its countries, so that is what leads the row. The
 * generic suitcase that used to sit here was identical on every trip ever
 * taken — a mark that cannot tell two things apart is decoration. It survives
 * for the one case it is actually true of: a trip with nothing in it yet.
 */
function FlagStack({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <Luggage size={17} aria-hidden="true" />
      </span>
    );
  }

  // Three is the most that reads as a stack rather than a smear; the count on
  // the line below says how many there really were.
  const shown = codes.slice(0, 3);

  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      {shown.map((code, index) => (
        <FlagChip
          key={code}
          countryCode={code}
          size="lg"
          // First country on top, the way a stack of anything is read.
          style={{ zIndex: shown.length - index }}
          className={index > 0 ? "-ml-3.5" : undefined}
        />
      ))}
    </span>
  );
}

/** One trip: what it was called, when it was, and how much is in it. */
function TripRow({
  trip,
  places,
  visits,
  onOpen,
}: {
  trip: Trip;
  places: VisitedPlace[];
  visits: PlaceVisit[];
  onOpen: () => void;
}) {
  const summary = tripSummary(trip, places, visits);
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
        className="pressable flex w-full items-center gap-3 rounded-[18px] bg-fill/50 py-2.5 pl-3 pr-2 text-left"
      >
        <FlagStack codes={summary.countryCodes} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {trip.name}
          </span>
          {when ? (
            <span className="mt-0.5 block truncate text-[13.5px] leading-snug text-ink-2">
              {when}
            </span>
          ) : null}
          <span className="block truncate text-[13px] leading-snug text-ink-3">
            {[length, formatPlaceCount(summary.places), where].filter(Boolean).join(" · ")}
          </span>
        </span>

        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
      </button>
    </li>
  );
}
