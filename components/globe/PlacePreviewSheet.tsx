"use client";

import { ChevronRight, Pencil } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { flagVariant } from "@/lib/ui/flags";
import { formatVisitShort } from "@/lib/utils/date";
import { countryFlag, placeSubtitle } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

/**
 * The card that rises when a pin is tapped.
 *
 * Deliberately compact and non-modal: the globe stays visible and interactive
 * behind it, so you never lose your place on Earth just to read about one.
 */
export function PlacePreviewSheet({
  place,
  open,
  onClose,
  onViewDetails,
  onEdit,
  bottomOffset,
}: {
  place: VisitedPlace | null;
  open: boolean;
  onClose: () => void;
  onViewDetails: () => void;
  onEdit: () => void;
  bottomOffset: number;
}) {
  const hasPhoto = Boolean(place?.coverImage);
  const hasFlag = Boolean(place && countryFlag(place.countryCode));
  const detail = place
    ? [
        placeSubtitle(place),
        place.wantToGo ? "Want to go" : formatVisitShort(place.visitedFrom, place.visitedTo),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <BottomSheet
      open={open && Boolean(place)}
      onClose={onClose}
      variant="compact"
      label={place ? `${place.name} preview` : "Place preview"}
      bottomOffset={bottomOffset}
    >
      {place ? (
        <div className="pb-1">
          <div className="flex items-center gap-3.5 pt-1">
            {/* The photograph, or the country — never a tinted rectangle
                standing in for a photograph that does not exist. */}
            {place.coverImage ? (
              <PlaceImage place={place} alt="" className="size-[64px] shrink-0 rounded-[18px]" />
            ) : (
              <FlagChip
                countryCode={place.countryCode}
                variant={flagVariant(place)}
                size="lg"
              />
            )}

            <div className="min-w-0 flex-1">
              {/* No heart before the name: the chip to its left is already
                  wearing one, and the same fact twice in two centimetres is
                  not emphasis. */}
              <h2 className="wrap-anywhere clamp-2 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                {place.name}
              </h2>
              {/* Where and when on one line, the same caption the lists use.
                  The chip beside it is repeated only when a photograph has
                  taken the leading chip's place. */}
              {detail ? (
                <p className="mt-0.5 truncate text-[13.5px] text-ink-2">
                  {hasPhoto && hasFlag ? (
                    <FlagChip countryCode={place.countryCode} className="mr-1.5" />
                  ) : null}
                  {detail}
                </p>
              ) : null}
            </div>
          </div>

          {place.notes ? (
            <p className="clamp-2 mt-3 text-[14px] leading-relaxed text-ink-2">{place.notes}</p>
          ) : null}

          <div className="mt-3.5 flex gap-2">
            <button
              type="button"
              onClick={onViewDetails}
              data-autofocus
              className="pressable flex min-h-11 flex-1 items-center justify-center gap-1 rounded-sm bg-accent px-4 text-[15px] font-semibold text-on-accent"
            >
              View Details
              <ChevronRight size={16} aria-hidden="true" className="-mr-1" />
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="pressable flex min-h-11 items-center justify-center gap-1.5 rounded-sm bg-fill px-4 text-[15px] font-medium text-ink"
            >
              <Pencil size={15} aria-hidden="true" />
              Edit
            </button>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}
