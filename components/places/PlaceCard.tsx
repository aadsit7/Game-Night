"use client";

import { Check, Heart, MapPin, MoreHorizontal } from "lucide-react";

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
 *
 * In selection mode the whole card becomes the checkbox and `•••` goes away.
 * A card that both opens a place and ticks it would be a coin toss every tap.
 */
export function PlaceCard({
  place,
  onOpen,
  onActions,
  priority,
  selecting = false,
  selected = false,
  onToggleSelect,
}: {
  place: VisitedPlace;
  onOpen: () => void;
  onActions: () => void;
  priority?: boolean;
  /** Tapping the card ticks it instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const when = formatVisitShort(place.visitedFrom, place.visitedTo);
  const flag = countryFlag(place.countryCode);
  const location = [place.city, place.country]
    .filter((part): part is string => Boolean(part && part !== place.name))
    .join(", ");
  const hasPhoto = Boolean(place.coverImage);
  // A wishlist entry has no date to show, so it says what it is instead.
  const meta = place.wantToGo ? "Want to go" : when;

  const press = selecting ? onToggleSelect : onOpen;
  // The tick is a state of the card, so the card carries the pressed state
  // rather than a separate control the thumb has to find.
  const selectProps = selecting
    ? ({ "aria-pressed": selected, "aria-label": place.name } as const)
    : {};

  return (
    <li className={cn("relative", selecting && "select-none")}>
      {hasPhoto ? (
        <button
          type="button"
          onClick={press}
          {...selectProps}
          className={cn(
            "pressable block w-full rounded-[20px] text-left transition-shadow",
            selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
          )}
        >
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
            {meta ? <Meta text={meta} wantToGo={place.wantToGo} /> : null}
            {place.notes ? (
              <p className="clamp-2 mt-1.5 text-[14px] leading-relaxed text-ink-2">{place.notes}</p>
            ) : null}
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={press}
          {...selectProps}
          className={cn(
            "pressable flex w-full items-start gap-3.5 rounded-[20px] bg-fill/60 p-3 text-left transition-shadow",
            selecting ? "pr-3" : "pr-12",
            selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
          )}
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
            {meta ? <Meta text={meta} wantToGo={place.wantToGo} /> : null}
            {place.notes ? (
              <p className="clamp-2 mt-1.5 text-[14px] leading-relaxed text-ink-2">{place.notes}</p>
            ) : null}
          </div>
        </button>
      )}

      {/* A mark, not a control — tapping the card is what opens the place. */}
      {!selecting && place.favorite ? (
        <span
          aria-label="Favorite"
          className={cn(
            "pointer-events-none absolute grid size-9 place-items-center rounded-full",
            hasPhoto
              ? "right-[52px] top-2.5 bg-black/35 text-white backdrop-blur-md"
              : "right-[42px] top-2 text-danger",
          )}
        >
          <Heart size={16} aria-hidden="true" fill="currentColor" />
        </span>
      ) : null}

      {selecting ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full",
            selected
              ? "bg-accent text-on-accent shadow-soft"
              : hasPhoto
                ? "border-[1.5px] border-white/85 bg-black/25 backdrop-blur-md"
                : "border-[1.5px] border-ink-3/60 bg-bg/70",
          )}
        >
          {selected ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : null}
        </span>
      ) : (
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
      )}
    </li>
  );
}

/** The line under the name: when you were there, or that you have not been. */
function Meta({ text, wantToGo }: { text: string; wantToGo?: boolean }) {
  if (!wantToGo) return <p className="mt-0.5 truncate text-[13px] text-ink-3">{text}</p>;
  return (
    <p className="mt-1 inline-flex max-w-full items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 text-[12.5px] font-medium text-accent">
      <MapPin size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{text}</span>
    </p>
  );
}
