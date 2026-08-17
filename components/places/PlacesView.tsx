"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Compass, MapPin, Plus, SearchX } from "lucide-react";

import { PlaceCard } from "@/components/places/PlaceCard";
import { PlacesFilters } from "@/components/places/PlacesFilters";
import { PlacesSearch } from "@/components/places/PlacesSearch";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { visitTimestamp } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { PlaceSort, VisitedPlace } from "@/types/place";

/**
 * One column on a phone, more once there is room — the iPhone layout is never
 * compromised to make the desktop one work.
 */
const GRID = "grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3";

/**
 * Everything saved, as a scrollable collection. It reads from the same
 * `places` array the globe does — there is no second dataset to fall out of
 * sync.
 */

function matches(place: VisitedPlace, query: string): boolean {
  const haystack = [place.name, place.city, place.region, place.country, place.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // Every word must appear somewhere, so "kyoto japan" and "japan kyoto" agree.
  return query.split(/\s+/).every((term) => haystack.includes(term));
}

function sortPlaces(places: VisitedPlace[], sort: PlaceSort): VisitedPlace[] {
  const next = [...places];
  switch (sort) {
    case "recentlyVisited":
      return next.sort(
        (a, b) => (visitTimestamp(b.visitedFrom) ?? -Infinity) - (visitTimestamp(a.visitedFrom) ?? -Infinity),
      );
    case "oldestVisited":
      return next.sort(
        (a, b) => (visitTimestamp(a.visitedFrom) ?? Infinity) - (visitTimestamp(b.visitedFrom) ?? Infinity),
      );
    case "name":
      return next.sort((a, b) => a.name.localeCompare(b.name));
    case "country":
      return next.sort(
        (a, b) =>
          (a.country || "￿").localeCompare(b.country || "￿") ||
          a.name.localeCompare(b.name),
      );
    case "recentlyAdded":
    default:
      return next.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}

export function PlacesView({
  places,
  countries,
  stats,
  loading,
  bottomInset,
  onOpenPlace,
  onPlaceActions,
  onAdd,
  onShowGlobe,
}: {
  places: VisitedPlace[];
  countries: Array<{ key: string; label: string; code?: string; count: number }>;
  stats: { places: number; countries: number };
  loading: boolean;
  bottomInset: number;
  onOpenPlace: (id: string) => void;
  onPlaceActions: (id: string) => void;
  onAdd: () => void;
  onShowGlobe: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PlaceSort>("recentlyAdded");
  const [country, setCountry] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 140);

  const visible = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    let result = places;
    if (country) {
      result = result.filter(
        (place) => (place.countryCode ?? place.country).toLowerCase() === country,
      );
    }
    if (term) result = result.filter((place) => matches(place, term));
    return sortPlaces(result, sort);
  }, [places, debouncedQuery, sort, country]);

  const filtersActive = country !== null || sort !== "recentlyAdded";
  const isEmpty = places.length === 0;

  return (
    <div className="absolute inset-0 bg-bg">
      <div className="scroll-area absolute inset-0" style={{ paddingBottom: bottomInset }}>
      <div className="mx-auto w-full max-w-[720px] px-4 sm:max-w-[880px] lg:max-w-[1180px]">
        <header
          className="pb-4"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)" }}
        >
          <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">
            My Places
          </h1>
          <p className="mt-1 text-[15px] text-ink-2">
            {loading ? (
              <span className="inline-block h-4 w-40 animate-pulse rounded bg-fill align-middle" />
            ) : (
              <>
                {stats.places} {stats.places === 1 ? "place" : "places"}
                <span aria-hidden="true" className="mx-1.5 text-ink-3">
                  ·
                </span>
                {stats.countries} {stats.countries === 1 ? "country" : "countries"}
              </>
            )}
          </p>
        </header>

        {!isEmpty && (
          <div
            className="sticky z-10 -mx-4 mb-5 bg-bg/85 px-4 pb-3 pt-1 backdrop-blur-xl"
            // Pins below the status bar, never underneath it.
            style={{ top: "env(safe-area-inset-top, 0px)" }}
          >
            <PlacesSearch
              value={query}
              onChange={setQuery}
              onOpenFilters={() => setFiltersOpen(true)}
              filtersActive={filtersActive}
              resultCount={visible.length}
            />
          </div>
        )}

        {loading ? (
          <ul className={GRID} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index}>
                <div className="skeleton aspect-[16/10] w-full rounded-[20px]" />
                <div className="skeleton mt-3 h-5 w-1/2 rounded" />
                <div className="skeleton mt-2 h-4 w-1/3 rounded" />
              </li>
            ))}
          </ul>
        ) : isEmpty ? (
          <EmptyState
            className="pt-8"
            icon={<Compass size={28} aria-hidden="true" />}
            title="Your world starts here"
            description="Add the places you’ve been and watch your travel history come to life."
            action={
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={onAdd}
                  className="pressable inline-flex min-h-[50px] items-center gap-2 rounded-md bg-accent px-6 text-[17px] font-semibold text-on-accent"
                >
                  <Plus size={19} aria-hidden="true" />
                  Add your first place
                </button>
                <button
                  type="button"
                  onClick={onShowGlobe}
                  className="pressable min-h-11 rounded-pill px-4 text-[16px] font-medium text-accent"
                >
                  Back to the globe
                </button>
              </div>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            className="pt-6"
            icon={<SearchX size={28} aria-hidden="true" />}
            title="No places found"
            description="Try another city, country, or place name."
            action={
              query || country ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCountry(null);
                  }}
                  className="pressable min-h-11 rounded-pill bg-fill px-5 text-[16px] font-medium text-ink"
                >
                  Clear search
                </button>
              ) : null
            }
          />
        ) : (
          <motion.ul
            className={cn(GRID, "pb-4")}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.3, 1] }}
          >
            {visible.map((place, index) => (
              <PlaceCard
                key={place.id}
                place={place}
                priority={index < 2}
                onOpen={() => onOpenPlace(place.id)}
                onActions={() => onPlaceActions(place.id)}
              />
            ))}
          </motion.ul>
        )}

        {!isEmpty && visible.length > 0 ? (
          <p className="flex items-center justify-center gap-1.5 pb-6 pt-2 text-[13px] text-ink-3">
            <MapPin size={13} aria-hidden="true" />
            {visible.length === stats.places
              ? `${stats.places} ${stats.places === 1 ? "place" : "places"} in your history`
              : `${visible.length} of ${stats.places} shown`}
          </p>
        ) : null}
      </div>

      </div>

      {/* Keeps scrolling content from running into the status bar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-bg/85 backdrop-blur-xl"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />

      <PlacesFilters
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        sort={sort}
        onSortChange={setSort}
        country={country}
        onCountryChange={setCountry}
        countries={countries}
      />
    </div>
  );
}
