"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Search across everything a memory might be filed under — name, city,
 * country, notes — plus one button for sorting and filtering. Two controls,
 * no toolbar.
 */
export function PlacesSearch({
  value,
  onChange,
  onOpenFilters,
  filtersActive,
  resultCount,
}: {
  value: string;
  onChange: (value: string) => void;
  onOpenFilters: () => void;
  filtersActive: boolean;
  resultCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          size={17}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search your places"
          aria-label="Search your places"
          className={cn(
            "min-h-11 w-full rounded-sm bg-fill py-2.5 pl-10 pr-10",
            "text-[16px] text-ink placeholder:text-ink-3",
            "outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent/50",
            // Safari draws its own clear button on search inputs.
            "[&::-webkit-search-cancel-button]:hidden",
          )}
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition-colors hover:bg-fill-strong"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenFilters}
        aria-label="Sort and filter"
        className={cn(
          "pressable relative grid size-11 shrink-0 place-items-center rounded-sm transition-colors",
          filtersActive ? "bg-accent-soft text-accent" : "bg-fill text-ink-2",
        )}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
        {filtersActive ? (
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" />
        ) : null}
      </button>

      <p className="sr-only" role="status" aria-live="polite">
        {resultCount} {resultCount === 1 ? "place" : "places"} shown
      </p>
    </div>
  );
}
