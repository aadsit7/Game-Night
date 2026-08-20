"use client";

import { MoreHorizontal } from "lucide-react";

import { PlaceImage } from "@/components/ui/PlaceImage";
import { formatVisitShort } from "@/lib/utils/date";
import { countryFlag } from "@/lib/utils/geo";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";

/**
 * A travel-journal entry, not a table row: a wide photograph, the name in a
 * confident size, and just enough detail underneath.
 *
 * A place with no photograph gets the compact form instead. The tall card is
 * built around a picture, and standing a tinted placeholder in for one costs
 * most of an iPhone screen to say nothing — two photo-less places used to fill
 * the whole list. The same details, laid out around a small mark, put four or
 * five on screen at once and read as deliberate rather than unfinished.
 *
 * The `•••` button sits over the card rather than inside it — interactive
 * elements must not nest, and a fixed corner is easier to hit than something
 * that moves with the text.
 */
export function PlaceCard({
  place,
  onOpen,
  onActions,
  priority,
}: {
  place: VisitedPlace;
  onOpen: () => void;
  onActions: () => void;
  priority?: boolean;
}) {
  const when = formatVisitShort(place.visitedFrom, place.visitedTo);
  const flag = countryFlag(place.countryCode);
  const location = [place.city, place.country]
    .filter((part): part is string => Boolean(part && part !== place.name))
    .join(", ");
  const hasPhoto = Boolean(place.coverImage);

  return (
    <li className="relative">
      {hasPhoto ? (
        <button type="button" onClick={onOpen} className="pressable block w-full text-left">
          <PlaceImage
            place={place}
            alt=""
            priority={priority}
            className="aspect-[16/10] w-full rounded-[20px]"
          />

          <div className="px-0.5 pt-2.5">
            <h3 className="wrap-anywhere clamp-2 text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {place.name}
            </h3>
            {location ? (
              <p className="mt-1 truncate text-[14px] text-ink-2">
                {flag ? <span className="mr-1.5">{flag}</span> : null}
                {location}
              </p>
            ) : null}
            {when ? <p className="mt-0.5 truncate text-[13px] text-ink-3">{when}</p> : null}
            {place.notes ? (
              <p className="clamp-2 mt-1.5 text-[14px] leading-relaxed text-ink-2">{place.notes}</p>
            ) : null}
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="pressable flex w-full items-start gap-3.5 rounded-[20px] bg-fill/60 p-3 pr-12 text-left"
        >
          <PlaceImage
            place={place}
            alt=""
            priority={priority}
            className="size-[68px] shrink-0 rounded-[16px]"
          />

          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="wrap-anywhere clamp-2 text-[17px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {place.name}
            </h3>
            {location ? (
              <p className="mt-1 truncate text-[14px] text-ink-2">
                {flag ? <span className="mr-1.5">{flag}</span> : null}
                {location}
              </p>
            ) : null}
            {when ? <p className="mt-0.5 truncate text-[13px] text-ink-3">{when}</p> : null}
            {place.notes ? (
              <p className="clamp-2 mt-1.5 text-[14px] leading-relaxed text-ink-2">{place.notes}</p>
            ) : null}
          </div>
        </button>
      )}

      <button
        type="button"
        onClick={onActions}
        aria-label={`More actions for ${place.name}`}
        className={cn(
          "pressable absolute grid size-9 place-items-center rounded-full",
          hasPhoto
            ? "right-2.5 top-2.5 bg-black/35 text-white backdrop-blur-md"
            : "right-2 top-2 text-ink-3",
        )}
      >
        <MoreHorizontal size={19} aria-hidden="true" />
      </button>
    </li>
  );
}
