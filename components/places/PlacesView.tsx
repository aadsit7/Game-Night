"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Cloud, CloudOff, Compass, Heart, Loader2, Luggage, MapPin, Plus, RefreshCw, SearchX, Trash2,
} from "lucide-react";

import { PlaceCard } from "@/components/places/PlaceCard";
import { TripTagSheet } from "@/components/places/TripTagSheet";
import { TravelStats } from "@/components/places/TravelStats";
import { PlacesFilters } from "@/components/places/PlacesFilters";
import { PlacesSearch } from "@/components/places/PlacesSearch";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FlagChip } from "@/components/ui/FlagChip";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { groupPlacesByCountry } from "@/lib/places/grouping";
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
  onDeletePlace,
  onDeletePlaces,
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
  /**
   * Removes a place. Swiping a row is a decision, not a question, so this is
   * expected to delete and leave an undo standing rather than ask again.
   */
  onDeletePlace: (id: string) => void;
  /**
   * Removes a whole selection at once. Asked about first — a swipe is one
   * deliberate gesture aimed at one row, but a tick list is easy to build up
   * without looking, and "seven places" is not something to find out about
   * from a toast.
   */
  onDeletePlaces: (ids: string[]) => void;
  /** Lets the shell stand the tab bar down while the selection bar is up. */
  onSelectingChange: (selecting: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  /*
   * Country-grouped by default. "Where have I been?" is the question this
   * screen exists to answer, and a country at a time is how people remember
   * the answer — two hundred places sorted by when they were typed in is a
   * changelog, not a travel history. Recency is still one tap away in the
   * filters for the times "what did I just add?" is the actual question.
   */
  const [sort, setSort] = useState<PlaceSort>("country");
  const [filter, setFilter] = useState<PlaceFilter>("all");
  const [country, setCountry] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /*
   * Who is being filed into a trip: the ticked selection, or the single place
   * whose row was swiped. Held as ids for the same reason the selection is —
   * a sync landing mid-gesture must not leave a stale record in a sheet.
   */
  const [tagIds, setTagIds] = useState<string[] | null>(null);
  /** The one row currently pulled open, so two can never be. */
  const [swipedId, setSwipedId] = useState<string | null>(null);
  /** Up while the selection is being asked about before it is deleted. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  const filtersActive = country !== null || sort !== "country";
  const isEmpty = places.length === 0;

  /** Section per country when the collection is arranged that way. */
  const grouped = useMemo(
    () => (sort === "country" ? groupPlacesByCountry(visible) : null),
    [sort, visible],
  );
  /** The first cards on screen load their images eagerly, grouped or not. */
  const priorityIds = useMemo(
    () => new Set(visible.slice(0, 2).map((place) => place.id)),
    [visible],
  );

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
        setTagIds(null);
        setConfirmingDelete(false);
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

  /** The places the tag sheet is about, whichever way it was opened. */
  const tagTargets = useMemo(() => {
    if (!tagIds) return [];
    const ids = new Set(tagIds);
    return places.filter((place) => ids.has(place.id));
  }, [places, tagIds]);

  const applyTag = useCallback(
    async (trip: Trip | null) => {
      if (!tagIds) return;
      const done = await onTagPlaces(tagIds, trip);
      // A failed write keeps the selection, so the tap can simply be repeated
      // once whatever went wrong is fixed.
      if (!done) return;
      setTagIds(null);
      if (selecting) setSelectionMode(false);
    },
    [tagIds, selecting, onTagPlaces, setSelectionMode],
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
          ) : selecting ? (
            /*
              How many are ticked, under the title — where iOS puts it, and
              where it does not have to compete for width with the actions.
              It lived in the middle of the bar below until that bar had two
              actions in it and the count was squeezed down to "Pick so…".
            */
            <p aria-live="polite" className="mt-2 text-[15px] tabular-nums text-ink-2">
              {selected.length === 0
                ? "Pick some places"
                : selected.length === 1
                  ? "1 place selected"
                  : `${selected.length} places selected`}
            </p>
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
            {(grouped ?? [null]).map((group) => (
              <Fragment key={group?.key ?? "all"}>
                {group ? (
                  /*
                    A country at a time. The heading spans the grid so the
                    cards beneath it read as that country's shelf, and the
                    count answers "how much of my travelling was here?"
                    before a single card is read.
                  */
                  <li className="col-span-full flex items-center justify-between gap-3 pb-0.5 pt-3.5 first:pt-1">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <FlagChip countryCode={group.code} />
                      <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
                        {group.label}
                      </span>
                    </span>
                    <span className="shrink-0 text-[14px] tabular-nums text-ink-3">
                      {group.places.length === 1 ? "1 place" : `${group.places.length} places`}
                    </span>
                  </li>
                ) : null}
                {(group?.places ?? visible).map((place) => (
                  <SwipeRow
                    key={place.id}
                    open={swipedId === place.id}
                    onOpenChange={(next) => setSwipedId(next ? place.id : null)}
                    // Ticking places is its own mode with its own gestures; a row
                    // that both swipes and selects is a coin toss every touch.
                    disabled={selecting}
                    radius={place.coverImage ? 20 : 18}
                    left={{
                      label: "Trip",
                      tone: "accent",
                      icon: <Luggage size={19} aria-hidden="true" />,
                      onAction: () => setTagIds([place.id]),
                    }}
                    right={{
                      label: "Delete",
                      tone: "danger",
                      icon: <Trash2 size={19} aria-hidden="true" />,
                      onAction: () => onDeletePlace(place.id),
                    }}
                  >
                    <PlaceCard
                      place={place}
                      priority={priorityIds.has(place.id)}
                      onOpen={() => onOpenPlace(place.id)}
                      onActions={() => onPlaceActions(place.id)}
                      selecting={selecting}
                      selected={selectedIds.includes(place.id)}
                      onToggleSelect={() => toggle(place.id)}
                    />
                  </SwipeRow>
                ))}
              </Fragment>
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
            <div className="glass mx-auto flex max-w-[520px] items-center gap-1.5 rounded-[26px] border border-glass-border p-2 pl-3 shadow-float">
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(allVisibleSelected ? [] : visible.map((place) => place.id))
                }
                className="pressable min-h-11 shrink-0 rounded-pill px-2 text-[15px] font-medium text-accent"
              >
                {allVisibleSelected ? "Clear" : "Select all"}
              </button>

              {/* Pushes the two actions to the far side, under the thumb. */}
              <div aria-hidden="true" className="min-w-0 flex-1" />

              {/*
                The other half of what a selection is for. Ticking places and
                then being able to do only one thing with them is why deleting
                more than one meant swiping each row in turn — and why the
                swipe had to carry the whole job. Icon-only, so both actions
                fit beside "Select all" on the width of a phone.
              */}
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={selected.length === 0}
                aria-label={
                  selected.length === 1 ? "Delete 1 place" : `Delete ${selected.length} places`
                }
                className={cn(
                  "pressable inline-flex size-11 shrink-0 items-center justify-center rounded-pill",
                  "transition-colors",
                  selected.length === 0 ? "text-ink-3" : "bg-danger-soft text-danger",
                )}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => setTagIds(selected.map((place) => place.id))}
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

      <ConfirmDialog
        open={confirmingDelete && selected.length > 0}
        title={
          selected.length === 1
            ? `Delete “${selected[0]?.name}”?`
            : `Delete ${selected.length} places?`
        }
        message={
          selected.length === 1
            ? "It will be removed from your travel history."
            : "They will be removed from your travel history."
        }
        confirmLabel="Delete"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          onDeletePlaces(selected.map((place) => place.id));
          setSelectionMode(false);
        }}
      />

      <TripTagSheet
        open={tagTargets.length > 0}
        selected={tagTargets}
        trips={trips}
        places={places}
        saving={tagging}
        onClose={() => setTagIds(null)}
        onChoose={(trip) => void applyTag(trip)}
        onCreateTrip={() => {
          onCreateTripFor(tagTargets.map((place) => place.id));
          setTagIds(null);
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
