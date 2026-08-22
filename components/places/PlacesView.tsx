"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Cloud, CloudOff, Compass, Heart, Loader2, Luggage, MapPin, Plus, RefreshCw, SearchX,
} from "lucide-react";

import { PlaceCard } from "@/components/places/PlaceCard";
import { TripTagSheet } from "@/components/places/TripTagSheet";
import { TravelStats } from "@/components/places/TravelStats";
import { PlacesFilters } from "@/components/places/PlacesFilters";
import { PlacesSearch } from "@/components/places/PlacesSearch";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { visitTimestamp } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { SheetStatus } from "@/lib/storage/sheetPlaceRepository";
import { PLACE_FILTER_LABELS, type PlaceFilter, type PlaceSort, type VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * One column on a phone, more once there is room — the iPhone layout is never
 * compromised to make the desktop one work.
 */
/* Rows sit close; photo cards are big enough to separate themselves. A 28px
   gutter was tuned when every entry was a picture. */
const GRID = "grid grid-cols-1 gap-x-5 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3";

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
  syncState,
  onOpenSync,
  trips,
  tagging,
  onTagPlaces,
  onCreateTripFor,
  onSelectingChange,
}: {
  places: VisitedPlace[];
  countries: Array<{ key: string; label: string; code?: string; count: number }>;
  stats: { saved: number; visited: number; countries: number };
  loading: boolean;
  bottomInset: number;
  onOpenPlace: (id: string) => void;
  onPlaceActions: (id: string) => void;
  onAdd: () => void;
  onShowGlobe: () => void;
  syncState: SheetStatus;
  onOpenSync: () => void;
  /** Every trip a selection can be filed into. */
  trips: Trip[];
  /** True while a tag is being written, so the sheet can hold still. */
  tagging: boolean;
  /** `null` takes the selection out of whatever trip it is in. */
  onTagPlaces: (ids: string[], trip: Trip | null) => Promise<boolean>;
  /** Opens the new-trip form; these places go into whatever comes back. */
  onCreateTripFor: (ids: string[]) => void;
  /** Lets the shell stand the tab bar down while the selection bar is up. */
  onSelectingChange: (selecting: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PlaceSort>("recentlyAdded");
  const [filter, setFilter] = useState<PlaceFilter>("all");
  const [country, setCountry] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tagOpen, setTagOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 140);

  const visible = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    let result = places;
    if (filter === "favorites") result = result.filter((place) => place.favorite);
    else if (filter === "been") result = result.filter((place) => !place.wantToGo);
    else if (filter === "wantToGo") result = result.filter((place) => place.wantToGo);
    if (country) {
      result = result.filter(
        (place) => (place.countryCode ?? place.country).toLowerCase() === country,
      );
    }
    if (term) result = result.filter((place) => matches(place, term));
    return sortPlaces(result, sort);
  }, [places, debouncedQuery, sort, country, filter]);

  /** Only the counts worth a chip: an empty one is a dead end, so it is hidden. */
  const counts = useMemo(
    () => ({
      all: places.length,
      favorites: places.filter((place) => place.favorite).length,
      been: places.filter((place) => !place.wantToGo).length,
      wantToGo: places.filter((place) => place.wantToGo).length,
    }),
    [places],
  );

  const filtersActive = country !== null || sort !== "recentlyAdded";
  const isEmpty = places.length === 0;

  /*
   * Selection is held as ids rather than places so it survives a sync landing
   * mid-selection, and it is narrowed to what is on screen whenever it is
   * read: filtering down to "Want to go" with three ticks behind it must not
   * quietly file away places nobody can see.
   */
  const selected = useMemo(() => {
    const ids = new Set(selectedIds);
    return visible.filter((place) => ids.has(place.id));
  }, [visible, selectedIds]);

  const setSelectionMode = useCallback(
    (next: boolean) => {
      setSelecting(next);
      if (!next) {
        setSelectedIds([]);
        setTagOpen(false);
      }
      onSelectingChange(next);
    },
    [onSelectingChange],
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }, []);

  const allVisibleSelected = visible.length > 0 && selected.length === visible.length;

  const applyTag = useCallback(
    async (trip: Trip | null) => {
      const ids = selected.map((place) => place.id);
      const done = await onTagPlaces(ids, trip);
      // A failed write keeps the selection, so the tap can simply be repeated
      // once whatever went wrong is fixed.
      if (done) setSelectionMode(false);
    },
    [selected, onTagPlaces, setSelectionMode],
  );

  return (
    <div className="absolute inset-0 bg-bg">
      <div className="scroll-area absolute inset-0" style={{ paddingBottom: bottomInset }}>
      <div className="mx-auto w-full max-w-[720px] px-4 sm:max-w-[880px] lg:max-w-[1180px]">
        <header
          className="pb-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">
              My Places
            </h1>
            {selecting ? (
              <button
                type="button"
                onClick={() => setSelectionMode(false)}
                className="pressable mt-1.5 min-h-9 shrink-0 rounded-pill px-2 text-[16px] font-semibold text-accent"
              >
                Done
              </button>
            ) : isEmpty ? (
              <SyncChip state={syncState} onPress={onOpenSync} />
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectionMode(true)}
                  className="pressable mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-fill px-3 text-[13px] font-medium text-ink-2"
                >
                  <Luggage size={14} aria-hidden="true" />
                  Select
                </button>
                <SyncChip state={syncState} onPress={onOpenSync} />
              </div>
            )}
          </div>

          {loading ? (
            <div className="mt-2.5 flex gap-2" aria-hidden="true">
              <div className="skeleton h-4 w-40 rounded" />
            </div>
          ) : !isEmpty ? (
            <div className="mt-2">
              <TravelStats
                visited={stats.visited}
                countries={stats.countries}
                collected={countries}
                selected={country}
                onSelect={setCountry}
              />
            </div>
          ) : null}
        </header>

        {!isEmpty && (
          <div
            className="sticky z-10 -mx-4 mb-3.5 bg-bg/85 px-4 pb-2.5 pt-1 backdrop-blur-xl"
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

            {/*
              The two questions a travel app is actually asked — what did I
              love, and where do I still want to go — answered in one tap
              rather than from inside a sort-and-filter sheet.
            */}
            <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto scrollbar-none px-4">
              {(["all", "favorites", "been", "wantToGo"] as PlaceFilter[])
                .filter((key) => key === "all" || counts[key] > 0)
                .map((key) => (
                  <FilterChip
                    key={key}
                    active={filter === key}
                    count={counts[key]}
                    icon={key === "favorites" ? <Heart size={13} aria-hidden="true" /> : null}
                    label={PLACE_FILTER_LABELS[key]}
                    onPress={() => setFilter(key)}
                  />
                ))}
            </div>
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
            description="Save the places you’ve been and the ones you still want to go, and watch your travel history come to life."
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
              query || country || filter !== "all" ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCountry(null);
                    setFilter("all");
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
                selecting={selecting}
                selected={selectedIds.includes(place.id)}
                onToggleSelect={() => toggle(place.id)}
              />
            ))}
          </motion.ul>
        )}

        {!isEmpty && visible.length > 0 ? (
          <p className="flex items-center justify-center gap-1.5 pb-6 pt-2 text-[13px] text-ink-3">
            <MapPin size={13} aria-hidden="true" />
            {visible.length === stats.saved
              ? `${stats.saved} ${stats.saved === 1 ? "place" : "places"} saved`
              : `${visible.length} of ${stats.saved} shown`}
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

      {/*
        Stands where the tab bar was — the shell hides it while this is up, the
        way iOS swaps its own toolbar out during a selection. Two bars stacked
        would put "Add to Trip" and "Add a place" a thumb-width apart.
      */}
      <AnimatePresence>
        {selecting ? (
          <motion.div
            className="fixed inset-x-0 bottom-0 z-30 px-4 pt-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.2, 0.8, 0.3, 1] }}
          >
            <div className="glass mx-auto flex max-w-[520px] items-center gap-2 rounded-[26px] border border-glass-border p-2 pl-3 shadow-float">
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(allVisibleSelected ? [] : visible.map((place) => place.id))
                }
                className="pressable min-h-11 shrink-0 rounded-pill px-2 text-[15px] font-medium text-accent"
              >
                {allVisibleSelected ? "Clear" : "Select all"}
              </button>

              <p
                aria-live="polite"
                className="min-w-0 flex-1 truncate text-center text-[14px] tabular-nums text-ink-2"
              >
                {selected.length === 0
                  ? "Pick some places"
                  : `${selected.length} selected`}
              </p>

              <button
                type="button"
                onClick={() => setTagOpen(true)}
                disabled={selected.length === 0}
                className={cn(
                  "pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill px-4",
                  "text-[15px] font-semibold transition-colors",
                  selected.length === 0
                    ? "bg-fill text-ink-3"
                    : "bg-accent text-on-accent",
                )}
              >
                <Luggage size={16} aria-hidden="true" />
                Add to Trip
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <TripTagSheet
        open={tagOpen && selected.length > 0}
        selected={selected}
        trips={trips}
        places={places}
        saving={tagging}
        onClose={() => setTagOpen(false)}
        onChoose={(trip) => void applyTag(trip)}
        onCreateTrip={() => {
          onCreateTripFor(selected.map((place) => place.id));
          setSelectionMode(false);
        }}
      />
    </div>
  );
}

/** One tap, one slice of the collection, with its size on it. */
function FilterChip({
  active,
  count,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  count: number;
  icon?: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={cn(
        /* Four filters have to fit the width of a phone without one of them
           hanging off the edge — a filter you cannot see is a filter nobody
           uses. This is as tight as the type gets before the counts stop
           reading. */
        "pressable inline-flex min-h-9 shrink-0 items-center gap-1 rounded-pill px-3",
        "text-[13.5px] font-medium transition-colors",
        active ? "bg-accent text-on-accent" : "bg-fill text-ink-2",
      )}
    >
      {icon}
      {label}
      <span className={cn("tabular-nums", active ? "text-on-accent/75" : "text-ink-3")}>
        {count}
      </span>
    </button>
  );
}

/**
 * A quiet indicator of where the data stands: reading-only, saving, up to
 * date, or stuck. Tapping it opens the sync settings.
 */
function SyncChip({ state, onPress }: { state: SheetStatus; onPress: () => void }) {
  const busy = state.phase === "loading" || state.phase === "saving";
  const stuck = state.phase === "error" || state.phase === "offline";
  const Icon = busy ? Loader2 : stuck ? CloudOff : state.connected ? Cloud : RefreshCw;

  // "Not saved yet" is the one state worth naming outright: everything else is
  // reassurance, but a change sitting on this device is something to act on.
  const label =
    state.phase === "error"
      ? "Sync problem"
      : state.pending > 0
        ? "Not saved yet"
        : busy
          ? state.phase === "loading"
            ? "Loading"
            : "Saving"
          : state.phase === "offline"
            ? "Offline"
            : state.connected
              ? "Saved"
              : "Not connected";

  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={`Sync: ${label}. Open sync settings.`}
      className={cn(
        "pressable mt-1.5 inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium",
        stuck ? "bg-danger-soft text-danger" : "bg-fill text-ink-2",
      )}
    >
      <Icon size={14} aria-hidden="true" className={busy ? "animate-spin" : undefined} />
      {label}
    </button>
  );
}
