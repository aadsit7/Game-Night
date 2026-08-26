"use client";

import { ChevronRight, Heart, PlaneTakeoff } from "lucide-react";

import { FlagChip } from "@/components/ui/FlagChip";
import { UPCOMING_LIMIT, type TravelDashboard } from "@/lib/insights/dashboard";
import { formatVisitShort } from "@/lib/utils/date";

/**
 * What is still ahead.
 *
 * Every other number on this tab is about what already happened, which makes
 * a stats tab a museum. A travel dashboard that cannot say "Paris, in 38
 * days" is missing the one figure its owner checks most, and the wishlist —
 * places saved and never yet been — is the same question with no date on it
 * yet.
 *
 * Only ever shown under the all-time lens: "what's next" inside a filter for
 * 2019 would be a contradiction.
 */
export function HorizonCard({
  upcoming,
  wishlist,
  onOpenPlace,
}: {
  upcoming: TravelDashboard["upcoming"];
  wishlist: TravelDashboard["wishlist"];
  onOpenPlace: (id: string) => void;
}) {
  if (upcoming.length === 0 && wishlist.places === 0) return null;

  return (
    <div className="divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
      {upcoming.slice(0, UPCOMING_LIMIT).map(({ place, visit, inDays }) => (
        <button
          key={visit.id}
          type="button"
          onClick={() => onOpenPlace(place.id)}
          className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-fill-strong"
        >
          <FlagChip countryCode={place.countryCode} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {place.name}
            </span>
            <span className="mt-[3px] block truncate text-[13px] leading-tight text-ink-3">
              {[countdown(inDays), formatVisitShort(visit.startDate, visit.endDate)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-ink-3" />
        </button>
      ))}

      {upcoming.length > UPCOMING_LIMIT ? (
        <p className="flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-ink-3">
          <PlaneTakeoff size={14} aria-hidden="true" className="shrink-0" />
          {upcoming.length - UPCOMING_LIMIT} more booked after that
        </p>
      ) : null}

      {wishlist.places > 0 ? (
        <p className="flex items-center gap-2 px-3.5 py-3 text-[14px] text-ink-2">
          <Heart size={15} aria-hidden="true" className="shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="font-semibold tabular-nums text-ink">{wishlist.places}</span>{" "}
            {wishlist.places === 1 ? "place" : "places"} on your wishlist
            {wishlist.newCountries > 0 ? (
              <span className="text-ink-3">
                {" · "}
                <span className="tabular-nums">{wishlist.newCountries}</span> new{" "}
                {wishlist.newCountries === 1 ? "country" : "countries"}
              </span>
            ) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** "in 3 days", "tomorrow", "in 4 months" — never a bare date. */
function countdown(inDays: number | null): string | null {
  if (inDays === null || inDays < 0) return null;
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  if (inDays < 45) return `in ${inDays} days`;
  const months = Math.round(inDays / 30.44);
  if (months < 18) return `in ${months} months`;
  const years = Math.round(inDays / 365.25);
  return `in ${years} ${years === 1 ? "year" : "years"}`;
}
