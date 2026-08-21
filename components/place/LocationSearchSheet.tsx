"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Globe2, Landmark, MapPin, PencilLine, Search, X } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { searchLocations } from "@/lib/maps/placeSearch";
import { cn } from "@/lib/utils/cn";
import type { LocationResult } from "@/types/place";

/**
 * Step one of adding a place: find it in the real world.
 *
 * The search covers cities, countries, neighbourhoods, addresses and points of
 * interest, so "Sagrada Família" and "Florence" both land somewhere sensible —
 * and picking a result fills in the coordinates, city, country and country
 * code without anyone typing a number.
 */

function iconFor(kind?: string) {
  if (kind === "country" || kind === "region") return Globe2;
  if (kind === "poi") return Landmark;
  if (kind === "address" || kind === "street") return Building2;
  return MapPin;
}

export function LocationSearchSheet({
  open,
  onClose,
  onSelect,
  onPickOnGlobe,
  onManualEntry,
  mapAvailable,
  proximity,
  title,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (result: LocationResult) => void;
  onPickOnGlobe: () => void;
  /** Used when there is no map to drop a pin on. */
  onManualEntry: () => void;
  /** False when the map failed to load — offline, or a blocked network. */
  mapAvailable: boolean;
  proximity?: [number, number];
  title: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebouncedValue(query, 260);

  // Reset when the sheet closes, so re-opening never shows a stale search.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setResults([]);
      setStatus("idle");
      setError(null);
    }
  }

  // A debounced, abortable fetch driven by what the user typed: the canonical
  // case for an effect, and the one place the app talks to the geocoder.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    const term = debounced.trim();
    if (term.length < 2) {
      setResults([]);
      setStatus("idle");
      setError(null);
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    void searchLocations(term, { signal: controller.signal, proximity })
      .then((found) => {
        if (controller.signal.aborted) return;
        setResults(found);
        setStatus("ready");
      })
      .catch((cause: Error) => {
        if (controller.signal.aborted || cause.name === "AbortError") return;
        setResults([]);
        setStatus("error");
        setError(cause.message || "Location search isn’t responding right now.");
      });

    return () => controller.abort();
  }, [debounced, open, proximity]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label={title}
      header={
        <div className="pb-3 pt-1">
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pressable grid size-9 place-items-center rounded-full bg-fill text-ink-2"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="relative">
            <Search
              size={17}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              ref={inputRef}
              data-autofocus
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search for a place, address or landmark"
              aria-label="Search for a location"
              className={cn(
                "min-h-[46px] w-full rounded-sm bg-fill py-2.5 pl-10 pr-4 text-[16px]",
                "text-ink placeholder:text-ink-3 outline-none",
                "transition-shadow focus-visible:ring-2 focus-visible:ring-accent/50",
                "[&::-webkit-search-cancel-button]:hidden",
              )}
            />
          </div>
        </div>
      }
    >
      <div className="pb-2">
        {status === "loading" ? (
          <ul className="space-y-2 pt-1" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="flex items-center gap-3 py-2">
                <span className="skeleton size-9 shrink-0 rounded-full" />
                <span className="flex-1">
                  <span className="skeleton block h-4 w-2/3 rounded" />
                  <span className="skeleton mt-1.5 block h-3 w-2/5 rounded" />
                </span>
              </li>
            ))}
          </ul>
        ) : status === "error" ? (
          <div className="rounded-md bg-fill px-4 py-4">
            <p className="text-[15px] leading-relaxed text-ink-2">{error}</p>
          </div>
        ) : results.length > 0 ? (
          <ul className="pt-0.5">
            {results.map((result) => {
              const Icon = iconFor(result.kind);
              return (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(result)}
                    className="flex w-full items-center gap-3 rounded-sm py-2.5 pr-2 text-left transition-colors active:bg-fill"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                      <Icon size={17} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-medium text-ink">
                        {result.name}
                      </span>
                      {/*
                        The address, when there is one, is what tells four
                        branches of the same shop apart. The short context line
                        is the fallback for a city or a country, which has no
                        street to give.
                      */}
                      {result.address ?? result.context ? (
                        <span className="block truncate text-[13.5px] text-ink-2">
                          {result.address ?? result.context}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : query.trim().length >= 2 && status === "ready" ? (
          <div className="px-1 py-6 text-center">
            <p className="text-[16px] font-medium text-ink">No matches</p>
            <p className="mx-auto mt-1 max-w-[30ch] text-[14px] leading-relaxed text-ink-2">
              Try a different spelling, or{" "}
              {mapAvailable ? "drop a pin on the globe" : "enter it by hand"} instead.
            </p>
          </div>
        ) : (
          <div className="px-1 pt-2 pb-1">
            <p className="text-[14px] leading-relaxed text-ink-2">
              Search for anywhere — somewhere you’ve been, or somewhere you want to go. A city like{" "}
              <span className="text-ink">Florence</span>, a country, a neighbourhood, or a
              landmark like <span className="text-ink">Sagrada Família</span>.
            </p>
          </div>
        )}

        {results.length > 0 ? (
          <p className="px-1 pt-2 text-[12px] text-ink-3">
            {results[0].source === "google"
              ? "Results from Google Maps"
              : "Results from OpenStreetMap"}
          </p>
        ) : null}

        {/* Always leave a way forward — including when there is no map at all. */}
        <div className="mt-3 border-t border-separator pt-3">
          <button
            type="button"
            onClick={mapAvailable ? onPickOnGlobe : onManualEntry}
            className="flex w-full items-center gap-3 rounded-sm py-2.5 pr-2 text-left transition-colors active:bg-fill"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2">
              {mapAvailable ? (
                <Globe2 size={17} aria-hidden="true" />
              ) : (
                <PencilLine size={17} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium text-ink">
                {mapAvailable ? "Drop a pin on the globe" : "Enter this place manually"}
              </span>
              <span className="block truncate text-[13.5px] text-ink-2">
                {mapAvailable
                  ? "For anywhere search can’t find"
                  : "Type the name and coordinates yourself"}
              </span>
            </span>
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
