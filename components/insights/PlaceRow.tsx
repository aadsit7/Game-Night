"use client";

import { ChevronRight } from "lucide-react";

import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";

/**
 * One place on a leaderboard: its rank when it has one, its photograph or
 * its country's chip, and the numbers that put it here. Shared between the
 * regulars list and the drill sheet so the same place reads the same way
 * at every depth.
 */
export function PlaceRow({
  place,
  rank,
  stays,
  days,
  lastLabel,
  lead = "stays",
  onPress,
}: {
  place: VisitedPlace;
  /** Present on the regulars board; the drill sheet ranks by order alone. */
  rank?: number;
  stays: number;
  days: number;
  lastLabel?: string | null;
  /** Which number the caption leads with — the one the ranking used. */
  lead?: "stays" | "days";
  onPress: () => void;
}) {
  const visitsPart = stays === 1 ? "1 visit" : `${stays} visits`;
  const daysPart = days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : null;
  const caption = [
    ...(lead === "days" ? [daysPart, visitsPart] : [visitsPart, daysPart]),
    lastLabel ? `last ${lastLabel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onPress}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-fill-strong"
    >
      {rank !== undefined ? (
        <span
          aria-label={`Rank ${rank}`}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums",
            // The podium is filled in; everyone else is on their way up.
            rank <= 3 ? "bg-accent text-on-accent" : "bg-accent-soft text-accent",
          )}
        >
          {rank}
        </span>
      ) : null}

      {place.coverImage ? (
        <PlaceImage place={place} alt="" className="size-10 shrink-0 rounded-[12px]" />
      ) : (
        <FlagChip countryCode={place.countryCode} />
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {place.name}
        </span>
        <span className="mt-[3px] block truncate text-[13px] leading-tight text-ink-3">
          {caption}
        </span>
      </span>

      <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-ink-3" />
    </button>
  );
}
