"use client";

import { MoreHorizontal } from "lucide-react";

import { PlaceImage } from "@/components/ui/PlaceImage";
import { formatVisitShort } from "@/lib/utils/date";
import { countryFlag } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

/**
 * A travel-journal entry, not a table row: a wide photograph, the name in a
 * confident size, and just enough detail underneath.
 *
 * The `•••` button sits over the image rather than inside the card button —
 * interactive elements must not nest, and a fixed corner is easier to hit than
 * something that moves with the text.
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

  return (
    <li className="relative">
      <button type="button" onClick={onOpen} className="pressable block w-full text-left">
        <PlaceImage
          place={place}
          alt=""
          width={860}
          height={560}
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

      <button
        type="button"
        onClick={onActions}
        aria-label={`More actions for ${place.name}`}
        className="pressable absolute right-2.5 top-2.5 grid size-9 place-items-center rounded-full bg-black/35 text-white backdrop-blur-md"
      >
        <MoreHorizontal size={19} aria-hidden="true" />
      </button>
    </li>
  );
}
