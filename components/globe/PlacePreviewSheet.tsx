"use client";

import { ChevronRight, Heart, MapPin, Pencil } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { PlaceImage } from "@/components/ui/PlaceImage";
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
  const subtitle = place ? placeSubtitle(place) : "";
  const when = place ? formatVisitShort(place.visitedFrom, place.visitedTo) : null;
  const flag = place ? countryFlag(place.countryCode) : null;

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
            <PlaceImage
              place={place}
              alt=""
              className="size-[72px] shrink-0 rounded-[18px]"
            />

            <div className="min-w-0 flex-1">
              <h2 className="wrap-anywhere clamp-2 text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                {place.favorite ? (
                  <Heart
                    size={15}
                    aria-label="Favorite"
                    fill="currentColor"
                    className="mr-1.5 inline-block shrink-0 align-baseline text-danger"
                  />
                ) : null}
                {place.name}
              </h2>
              {subtitle ? (
                <p className="mt-0.5 truncate text-[14px] text-ink-2">
                  {flag ? <span className="mr-1.5">{flag}</span> : null}
                  {subtitle}
                </p>
              ) : null}
              {place.wantToGo ? (
                <p className="mt-1 inline-flex max-w-full items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 text-[12.5px] font-medium text-accent">
                  <MapPin size={12} aria-hidden="true" className="shrink-0" />
                  Want to go
                </p>
              ) : when ? (
                <p className="mt-0.5 truncate text-[13px] text-ink-3">{when}</p>
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
