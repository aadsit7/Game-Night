"use client";

import { Check } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { cn } from "@/lib/utils/cn";
import { PLACE_SORT_LABELS, type PlaceSort } from "@/types/place";
import { countryFlag } from "@/lib/utils/geo";

export type CountryOption = { key: string; label: string; code?: string; count: number };

/**
 * Sorting and one filter — country — and nothing more. A travel journal does
 * not need a query builder.
 */
export function PlacesFilters({
  open,
  onClose,
  sort,
  onSortChange,
  country,
  onCountryChange,
  countries,
}: {
  open: boolean;
  onClose: () => void;
  sort: PlaceSort;
  onSortChange: (sort: PlaceSort) => void;
  country: string | null;
  onCountryChange: (country: string | null) => void;
  countries: CountryOption[];
}) {
  const sorts = Object.keys(PLACE_SORT_LABELS) as PlaceSort[];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Sort and filter"
      header={
        <div className="flex items-center justify-between pb-2 pt-1">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Sort &amp; Filter</h2>
          <button
            type="button"
            onClick={onClose}
            data-autofocus
            className="pressable min-h-9 rounded-pill px-2 text-[16px] font-medium text-accent"
          >
            Done
          </button>
        </div>
      }
    >
      <section aria-labelledby="sort-heading" className="pb-2">
        <h3
          id="sort-heading"
          className="px-1 pb-1.5 pt-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3"
        >
          Sort by
        </h3>
        <div className="overflow-hidden rounded-md bg-fill">
          {sorts.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => onSortChange(option)}
              aria-pressed={sort === option}
              className={cn(
                "flex min-h-[50px] w-full items-center justify-between px-4 text-left text-[16px]",
                "transition-colors active:bg-fill-strong",
                index > 0 && "border-t border-separator",
                sort === option ? "font-medium text-ink" : "text-ink",
              )}
            >
              <span className="truncate">{PLACE_SORT_LABELS[option]}</span>
              {sort === option ? (
                <Check size={18} aria-hidden="true" className="shrink-0 text-accent" />
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {countries.length > 1 ? (
        <section aria-labelledby="country-heading" className="pb-3 pt-4">
          <h3
            id="country-heading"
            className="px-1 pb-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3"
          >
            Country
          </h3>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={country === null} onClick={() => onCountryChange(null)}>
              All places
            </FilterChip>
            {countries.map((option) => (
              <FilterChip
                key={option.key}
                active={country === option.key}
                onClick={() => onCountryChange(country === option.key ? null : option.key)}
              >
                {option.code ? (
                  <span aria-hidden="true" className="mr-1.5">
                    {countryFlag(option.code)}
                  </span>
                ) : null}
                {option.label}
                <span className="ml-1.5 opacity-60">{option.count}</span>
              </FilterChip>
            ))}
          </div>
        </section>
      ) : null}
    </BottomSheet>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "pressable inline-flex min-h-10 max-w-full items-center rounded-pill px-3.5 text-[15px]",
        "transition-colors",
        active ? "bg-accent text-on-accent font-medium" : "bg-fill text-ink",
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}
