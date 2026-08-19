"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MapPin, Search, Settings2, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { countryFlag, placeSubtitle } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

/**
 * Search sitting over the map, the way every map app puts it.
 *
 * It searches places already saved — the fastest route from "where was that
 * town in Portugal" to looking at it — rather than the whole world, which is
 * what the add flow is for.
 */
export function GlobeSearch({
  places,
  visible,
  onSelect,
  onOpenSettings,
}: {
  places: VisitedPlace[];
  visible: boolean;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
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
      .slice(0, 8);
  }, [places, query]);

  const open = focused && query.trim().length > 0;

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
                  onFocus={() => setFocused(true)}
                  // Delayed so a tap on a result registers before the list closes.
                  onBlur={() => window.setTimeout(() => setFocused(false), 140)}
                  placeholder={
                    places.length > 0
                      ? `Search ${places.length} ${places.length === 1 ? "place" : "places"}`
                      : "Search your places"
                  }
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
                  {results.length === 0 ? (
                    <p className="px-4 py-4 text-[15px] text-ink-2">
                      Nothing saved matches that yet.
                    </p>
                  ) : (
                    <ul>
                      {results.map((place, index) => {
                        const subtitle = placeSubtitle(place);
                        const flag = countryFlag(place.countryCode);
                        return (
                          <li key={place.id}>
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setQuery("");
                                setFocused(false);
                                inputRef.current?.blur();
                                onSelect(place.id);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-fill",
                                index > 0 && "border-t border-separator",
                              )}
                            >
                              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                                <MapPin size={15} aria-hidden="true" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[16px] font-medium text-ink">
                                  {place.name}
                                </span>
                                {subtitle ? (
                                  <span className="block truncate text-[13px] text-ink-2">
                                    {flag ? <span className="mr-1">{flag}</span> : null}
                                    {subtitle}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
