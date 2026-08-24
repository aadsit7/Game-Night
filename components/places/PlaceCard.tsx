"use client";

import { Check, Heart, MoreHorizontal } from "lucide-react";

import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { googleSummaryFor } from "@/lib/maps/placeDetails";
import { formatVisitShort } from "@/lib/utils/date";
import { flagVariant } from "@/lib/ui/flags";
import { countryFlag } from "@/lib/utils/geo";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";

/**
 * A travel-journal entry, not a table row.
 *
 * Two forms, decided by one thing: whether there is a photograph. With one,
 * the card is built around it — a wide picture and the details underneath,
 * which is what a journal looks like. Without one, the card is a row: the
 * country's chip, the name, and a line of detail.
 *
 * The card is the *contents* of a list row rather than the row itself: the
 * `<li>` and the swipe that goes with it belong to `SwipeRow`, which has to
 * own both to slide one over the other.
 *
 * The row used to stand a tinted gradient in for the missing photograph, at
 * the same size as a real one. Twelve of those down a page is most of a phone
 * screen spent saying "no picture here" twelve times, in a mark that carries
 * no information at all. The chip in its place is both smaller and true: it
 * says which country you are looking at.
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
  const hasFlag = Boolean(countryFlag(place.countryCode));
  const hasPhoto = Boolean(place.coverImage);
  /*
   * Where and when, on one line.
   *
   * They were two lines and a pill: the city, then the dates, then — for
   * somewhere still to go — an accent chip saying so. Three rows of type for
   * six words. The chip beside the name carries the wishlist mark now, which
   * leaves this free to be what it always was: a caption.
   */
  const detail = [
    [place.city, place.country]
      .filter((part): part is string => Boolean(part && part !== place.name))
      .join(", "),
    place.wantToGo ? "Want to go" : formatVisitShort(place.visitedFrom, place.visitedTo),
  ]
    .filter(Boolean)
    .join(" · ");

  /*
   * What Google Maps knows, borrowed rather than fetched: the list reads
   * only the cache that opened cards fill, so two hundred rows cost zero
   * calls. A rating appears once its card has been opened; a place that has
   * closed for good says so, which in a list of memories is the one fact
   * worth interrupting for.
   */
  const google = googleSummaryFor(place.googlePlaceId);
  const googleChip = google?.permanentlyClosed ? (
    <span className="mr-1.5 font-medium text-danger">Permanently closed</span>
  ) : google?.rating !== undefined ? (
    <span className="mr-1.5 whitespace-nowrap text-accent">
      <span aria-hidden="true">★ </span>
      <span aria-label={`Rated ${google.rating.toFixed(1)} on Google Maps`} className="tabular-nums">
        {google.rating.toFixed(1)}
      </span>
    </span>
  ) : null;

  const press = selecting ? onToggleSelect : onOpen;
  // The tick is a state of the card, so the card carries the pressed state
  // rather than a separate control the thumb has to find.
  const selectProps = selecting
    ? ({ "aria-pressed": selected, "aria-label": place.name } as const)
    : {};

  return (
    <div className={cn("relative", selecting && "select-none")}>
      {hasPhoto ? (
        <button
          type="button"
          onClick={press}
          {...selectProps}
          className={cn(
            /* A card, like the row beside it. The photograph used to sit on
               the page with its caption underneath and nothing holding the two
               together, which was fine until the cell could slide: pulled
               aside, the caption's half read as a gap in the list rather than
               as part of the thing being moved. */
            "pressable block w-full rounded-[20px] bg-fill/50 p-2 text-left transition-shadow",
            selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
          )}
        >
          <PlaceImage
            place={place}
            alt=""
            priority={priority}
            className="aspect-[16/10] w-full rounded-[14px]"
          />

          <div className="px-1 pb-0.5 pt-2">
            <h3 className="wrap-anywhere clamp-2 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {place.name}
            </h3>
            <p className="mt-1 truncate text-[13.5px] text-ink-2">
              {hasFlag ? <FlagChip countryCode={place.countryCode} className="mr-1.5" /> : null}
              {googleChip}
              {detail}
            </p>
            {place.notes ? (
              <p className="clamp-1 mt-1 text-[13.5px] leading-snug text-ink-3">{place.notes}</p>
            ) : null}
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={press}
          {...selectProps}
          className={cn(
            "pressable flex w-full items-center gap-3 rounded-[18px] bg-fill/50 py-2.5 pl-3 text-left transition-shadow",
            selecting ? "pr-3" : "pr-11",
            selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
          )}
        >
          <FlagChip
            countryCode={place.countryCode}
            variant={flagVariant(place)}
            size="lg"
          />

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[16.5px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {place.name}
            </h3>
            {detail || googleChip ? (
              <p className="mt-0.5 truncate text-[13.5px] leading-snug text-ink-2">
                {googleChip}
                {detail}
              </p>
            ) : null}
            {place.notes ? (
              <p className="truncate text-[13px] leading-snug text-ink-3">{place.notes}</p>
            ) : null}
          </div>
        </button>
      )}

      {/* A mark, not a control — tapping the card is what opens the place. On a
          row the chip already carries it, so this belongs to photo cards only. */}
      {!selecting && hasPhoto && place.favorite ? (
        <span
          aria-label="Favorite"
          className="pointer-events-none absolute right-[54px] top-4 grid size-9 place-items-center rounded-full bg-black/35 text-white backdrop-blur-md"
        >
          <Heart size={16} aria-hidden="true" fill="currentColor" />
        </span>
      ) : null}

      {selecting ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-4 top-4 grid size-7 place-items-center rounded-full",
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
            "pressable absolute grid place-items-center rounded-full",
            hasPhoto
              ? "right-4 top-4 size-9 bg-black/35 text-white backdrop-blur-md"
              : "right-1 top-1/2 size-9 -translate-y-1/2 text-ink-3",
          )}
        >
          <MoreHorizontal size={19} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
