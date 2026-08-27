"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, Search, Settings2, X } from "lucide-react";

import { iconForLocationKind } from "@/components/place/LocationSearchSheet";
import { FlagChip } from "@/components/ui/FlagChip";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import {
  hasPlacesSearch,
  newToJournal,
  searchAttribution,
  searchLocations,
} from "@/lib/maps/placeSearch";
import { flagVariant } from "@/lib/ui/flags";
import { cn } from "@/lib/utils/cn";
import { placeSubtitle } from "@/lib/utils/geo";
import type { LocationResult, VisitedPlace } from "@/types/place";

/**
 * Search sitting over the map, the way every map app puts it.
 *
 * It answers two questions at once. Places already saved come back instantly —
 * the fastest route from "where was that town in Portugal" to looking at it.
 * Underneath them, the same words are put to Google Maps, so typing somewhere
 * new is never a dead end: the world's answer is one tap from becoming a saved
 * place, form already filled in. Before, that tap lived behind a separate plus
 * button that you had to know about; now the search bar simply does what a
 * search bar on a map is expected to do.
 */
export function GlobeSearch({
  places,
  visible,
  onSelect,
  onAddLocation,
  onOpenSettings,
  onSearchFocus,
  proximity,
}: {
  places: VisitedPlace[];
  visible: boolean;
  onSelect: (id: string) => void;
  /** A world result was chosen: open the add flow with it filled in. */
  onAddLocation: (result: LocationResult) => void;
  onOpenSettings: () => void;
  /** Fired when the field focuses, so the shell can note the camera. */
  onSearchFocus?: () => void;
  /** Bias for the world search — wherever the globe is looking. */
  proximity?: [number, number];
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [world, setWorld] = useState<LocationResult[]>([]);
  const [worldStatus, setWorldStatus] = useState<"idle" | "loading" | "ready">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return places
      .filter((place) =>
        [place.name, place.city, place.region, place.country, place.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 6);
  }, [places, query]);

  const debounced = useDebouncedValue(query, 250);

  /* The world half of the answer: debounced, abortable, and stale-friendly —
     the previous answer stays on screen, dimmed, while the next one loads. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const term = debounced.trim();
    if (!visible || term.length < 2) {
      setWorld([]);
      setWorldStatus("idle");
      return;
    }

    const controller = new AbortController();
    setWorldStatus("loading");

    void searchLocations(term, { signal: controller.signal, proximity })
      .then((found) => {
        if (controller.signal.aborted) return;
        setWorld(found);
        setWorldStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // The globe search is an extra; failing quietly leaves the saved
        // results exactly as they were, and the add flow still exists.
        setWorld([]);
        setWorldStatus("ready");
      });

    return () => controller.abort();
  }, [debounced, visible, proximity]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Listings already in the journal are shown as your places, not repeated.
  const worldShown = useMemo(() => newToJournal(world, places).slice(0, 6), [world, places]);

  const term = query.trim();
  const open = focused && term.length > 0;
  const worldPending = term.length >= 2 && worldStatus === "loading" && worldShown.length === 0;
  const nothingAtAll =
    results.length === 0 && worldShown.length === 0 && (term.length < 2 || worldStatus === "ready");

  const done = () => {
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.2, 0.8, 0.3, 1] }}
          className="absolute inset-x-0 top-0 z-30 px-3"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 10px)" }}
        >
          <div className="mx-auto mt-2 w-full max-w-[520px]">
            <div className="glass flex items-center gap-1 rounded-[18px] border border-glass-border p-1 shadow-float">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={17}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                />
                <input
                  ref={inputRef}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => {
                    setFocused(true);
                    onSearchFocus?.();
                  }}
                  // Delayed so a tap on a result registers before the list closes.
                  onBlur={() => window.setTimeout(() => setFocused(false), 140)}
                  placeholder="Search anywhere"
                  aria-label="Search places on the map"
                  className={cn(
                    "min-h-10 w-full rounded-[14px] bg-transparent py-2 pl-9 pr-8",
                    "text-[16px] text-ink placeholder:text-ink-3 outline-none",
                    "[&::-webkit-search-cancel-button]:hidden",
                  )}
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-3"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Sync settings"
                className="pressable grid size-10 shrink-0 place-items-center rounded-[14px] text-ink-2"
              >
                <Settings2 size={18} aria-hidden="true" />
              </button>
            </div>

            <AnimatePresence>
              {open ? (
                <motion.div
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18 }}
                  className="glass mt-2 max-h-[46dvh] overflow-y-auto scrollbar-none rounded-[18px] border border-glass-border shadow-float"
                >
                  {results.length > 0 ? (
                    <ul>
                      {results.map((place, index) => {
                        const subtitle = placeSubtitle(place);
                        return (
                          <li key={place.id}>
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                done();
                                onSelect(place.id);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-fill",
                                index > 0 && "border-t border-separator",
                              )}
                            >
                              <FlagChip
                                countryCode={place.countryCode}
                                variant={flagVariant(place)}
                                size="md"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[16px] font-medium text-ink">
                                  {place.name}
                                </span>
                                {subtitle ? (
                                  <span className="block truncate text-[13px] text-ink-2">
                                    {subtitle}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  {/* The world's half, under yours — every row an add. */}
                  {worldShown.length > 0 || worldPending ? (
                    <div className={cn(results.length > 0 && "border-t border-separator")}>
                      <p className="px-4 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                        Add a new place
                      </p>
                      {worldPending ? (
                        <div className="flex items-center gap-3 px-4 pb-3.5 pt-1.5">
                          <span className="skeleton size-9 shrink-0 rounded-full" />
                          <span className="text-[14px] text-ink-2">
                            {hasPlacesSearch()
                              ? "Searching Google Maps…"
                              : "Searching OpenStreetMap…"}
                          </span>
                        </div>
                      ) : (
                        <ul
                          className={cn(
                            "transition-opacity duration-150",
                            worldStatus === "loading" && "opacity-55",
                          )}
                        >
                          {worldShown.map((result, index) => {
                            const Icon = iconForLocationKind(result.kind, result.source);
                            return (
                              <li key={result.id}>
                                <button
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    done();
                                    onAddLocation(result);
                                  }}
                                  aria-label={`Add ${result.name}`}
                                  className={cn(
                                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-fill",
                                    index > 0 && "border-t border-separator",
                                  )}
                                >
                                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                                    <Icon size={17} aria-hidden="true" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[16px] font-medium text-ink">
                                      {result.name}
                                    </span>
                                    {result.address ?? result.context ? (
                                      <span className="block truncate text-[13px] text-ink-2">
                                        {result.address ?? result.context}
                                      </span>
                                    ) : null}
                                  </span>
                                  <Plus
                                    size={17}
                                    aria-hidden="true"
                                    className="shrink-0 text-accent"
                                  />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {worldShown.length > 0 ? (
                        <p className="px-4 pb-2.5 pt-1 text-[11.5px] text-ink-3">
                          {searchAttribution(worldShown)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {nothingAtAll ? (
                    <p className="px-4 py-4 text-[15px] text-ink-2">
                      {term.length < 2
                        ? "Keep typing to search the map."
                        : "Nothing found — try a different spelling."}
                    </p>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
