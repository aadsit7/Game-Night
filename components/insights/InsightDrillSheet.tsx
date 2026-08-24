"use client";

import { useMemo } from "react";
import { X } from "lucide-react";

import { PlaceRow } from "@/components/insights/PlaceRow";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { scopeMembers, type InsightScope } from "@/lib/insights/insights";
import type { PlaceVisit, VisitedPlace } from "@/types/place";

/**
 * The places behind a leaderboard row or a matrix cell.
 *
 * "Japan", "Europe" or "Japan · 2024" opens here as a short list of the
 * places that earned the number, each one a tap from its own card — the
 * drill the board exists for. Members are recomputed from live data on
 * every render, so a sync landing mid-browse can never leave a stale row.
 */
export function InsightDrillSheet({
  scope,
  label,
  open,
  onClose,
  depth,
  places,
  visits,
  onOpenPlace,
}: {
  scope: InsightScope | null;
  label: string;
  open: boolean;
  onClose: () => void;
  /** Position in the sheet stack; see BottomSheet. */
  depth?: number;
  places: VisitedPlace[];
  visits: PlaceVisit[];
  onOpenPlace: (id: string) => void;
}) {
  const members = useMemo(
    () => (scope ? scopeMembers(scope, places, visits) : []),
    [scope, places, visits],
  );

  const stays = members.reduce((sum, tally) => sum + tally.stays, 0);
  const summary = [
    members.length === 1 ? "1 place" : `${members.length} places`,
    stays === 1 ? "1 visit" : `${stays} visits`,
  ].join(" · ");

  return (
    <BottomSheet
      open={open && Boolean(scope)}
      onClose={onClose}
      depth={depth}
      label={`${label} places`}
      header={
        <div className="flex items-center justify-between gap-3 pb-2 pt-1">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
              {label}
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-autofocus
            className="pressable -mr-1 grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className="pb-4">
        <div className="divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
          {members.map((tally) => (
            <PlaceRow
              key={tally.place.id}
              place={tally.place}
              stays={tally.stays}
              days={tally.days}
              lastLabel={scope?.year === undefined ? tally.lastLabel : undefined}
              lead={scope?.metric ?? "stays"}
              onPress={() => onOpenPlace(tally.place.id)}
            />
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
