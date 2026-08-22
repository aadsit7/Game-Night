"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bookmark,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Heart,
  Luggage,
  MapPin,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { formatDays } from "@/lib/timeline/buildTimeline";
import { formatVisitRange, inclusiveDayCount } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { countryFlag, formatCoordinates, placeSubtitle } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";

/**
 * The full memory: the name, the photograph if there is one, when you were
 * there, what you wrote, and where on Earth it sits.
 *
 * A place with no photograph gets no hero. A tall tinted rectangle with a pin
 * in it is not a picture of anywhere — it filled half an iPhone screen and
 * pushed the writing and the dates below the fold to say nothing at all. The
 * facts move into a grouped card instead, so an entry with no photo opens
 * complete on one screen rather than opening on a placeholder.
 */
export function PlaceDetailSheet({
  place,
  open,
  onClose,
  onEdit,
  onShowOnGlobe,
  onDelete,
  depth,
  backTo,
  trip,
  onOpenTrip,
  onToggleFavorite,
}: {
  place: VisitedPlace | null;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onShowOnGlobe: () => void;
  onDelete: () => void;
  /** Position in the sheet stack; see BottomSheet. */
  depth?: number;
  /**
   * Name of whatever this sheet was opened from, when it was opened from
   * something. Closing already returns there; saying so turns a dead-end "X"
   * into the back button the gesture actually performs.
   */
  backTo?: string;
  /** The trip this visit belongs to, when it belongs to one. */
  trip?: Trip | null;
  onOpenTrip?: () => void;
  /** Saving a favourite is one tap from here, not a trip through the form. */
  onToggleFavorite?: () => void;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Closing the sheet closes any open photo with it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open && lightbox) setLightbox(null);
  }

  const when = place ? formatVisitRange(place.visitedFrom, place.visitedTo) : null;
  const days = place ? inclusiveDayCount(place.visitedFrom, place.visitedTo) : null;
  const subtitle = place ? placeSubtitle(place) : "";
  const hasFlag = Boolean(place && countryFlag(place.countryCode));
  const extraPhotos = place?.photos ?? [];
  const hasCover = Boolean(place?.coverImage);

  return (
    <>
      <BottomSheet
        open={open && Boolean(place)}
        onClose={onClose}
        depth={depth}
        label={place ? `${place.name} details` : "Place details"}
        header={
          <div className="flex items-center justify-between gap-3 pb-2 pt-1">
            {backTo ? (
              <button
                type="button"
                onClick={onClose}
                data-autofocus
                className="pressable -ml-1.5 flex min-w-0 items-center gap-0.5 rounded-pill py-1 pr-2 text-accent"
              >
                <ChevronLeft size={20} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
                <span className="truncate text-[16px] font-medium">{backTo}</span>
              </button>
            ) : (
              <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
                Details
              </h2>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {onToggleFavorite ? (
                <button
                  type="button"
                  onClick={onToggleFavorite}
                  aria-pressed={Boolean(place?.favorite)}
                  aria-label={place?.favorite ? "Remove from favorites" : "Add to favorites"}
                  className={cn(
                    "pressable grid size-9 place-items-center rounded-full",
                    place?.favorite ? "bg-danger-soft text-danger" : "bg-fill text-ink-2",
                  )}
                >
                  <Heart
                    size={17}
                    aria-hidden="true"
                    fill={place?.favorite ? "currentColor" : "none"}
                  />
                </button>
              ) : null}
              {backTo ? null : (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close details"
                  data-autofocus
                  className="pressable -mr-1 grid size-9 place-items-center rounded-full bg-fill text-ink-2"
                >
                  <X size={17} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        }
      >
        {place ? (
          <div className="pb-4">
            {/* The photograph leads when there is one — it is the memory. */}
            {hasCover ? (
              <PlaceImage
                place={place}
                alt={place.name}
                priority
                className="mb-4 aspect-[16/10] w-full rounded-[22px]"
              />
            ) : null}

            <h1 className="wrap-anywhere text-[30px] font-bold leading-[1.12] tracking-[-0.03em] text-ink">
              {place.name}
            </h1>
            {subtitle ? (
              <p className="mt-1 text-[16px] text-ink-2">
                {hasFlag ? <FlagChip countryCode={place?.countryCode} className="mr-1.5" /> : null}
                {subtitle}
              </p>
            ) : null}

            {/*
              State reads as a badge, not as a row of facts. "Want to go" and
              "Favorite" are what this place *is* to you, and belong beside the
              name — a grouped row headed ON YOUR LIST spent four lines saying
              what a two-word pill says at a glance.
            */}
            {place.wantToGo || place.favorite ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {place.wantToGo ? (
                  <Badge icon={<Bookmark size={13} aria-hidden="true" />} tone="accent">
                    Want to go
                  </Badge>
                ) : null}
                {place.favorite ? (
                  <Badge
                    icon={<Heart size={13} aria-hidden="true" fill="currentColor" />}
                    tone="danger"
                  >
                    Favorite
                  </Badge>
                ) : null}
              </div>
            ) : null}

            {/* The facts, grouped — the dates, the trip, the coordinates. */}
            <div className="mt-4 divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
              {when ? (
                <Fact
                  icon={<CalendarRange size={16} aria-hidden="true" />}
                  label="Visited"
                  value={days && days > 1 ? `${when} · ${formatDays(days)}` : when}
                />
              ) : null}

              {trip && onOpenTrip ? (
                <Fact
                  icon={<Luggage size={16} aria-hidden="true" />}
                  label="Trip"
                  value={trip.name}
                  onPress={onOpenTrip}
                />
              ) : null}

              <Fact
                icon={<MapPin size={16} aria-hidden="true" />}
                label="Coordinates"
                value={formatCoordinates(place.latitude, place.longitude)}
                tabular
              />
            </div>

            {place.notes ? (
              <Section title="Notes">
                <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
                  {place.notes}
                </p>
              </Section>
            ) : null}

            {extraPhotos.length > 0 ? (
              <Section title="Photos">
                <div className="-mx-5 flex gap-2.5 overflow-x-auto scrollbar-none px-5 pb-1">
                  {extraPhotos.map((photo, index) => (
                    <button
                      key={`${photo}-${index}`}
                      type="button"
                      onClick={() => setLightbox(photo)}
                      aria-label={`View photo ${index + 2} of ${place.name}`}
                      className="pressable shrink-0"
                    >
                      <PlaceImage
                        place={{ ...place, coverImage: photo }}
                        alt=""
                        className="size-[132px] rounded-[16px]"
                      />
                    </button>
                  ))}
                </div>
              </Section>
            ) : null}

            {/* One way to do each thing, in the order they are wanted. */}
            <div className="mt-6 space-y-2.5">
              <button
                type="button"
                onClick={onShowOnGlobe}
                className="pressable flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-accent text-[17px] font-semibold text-on-accent"
              >
                <Globe2 size={18} aria-hidden="true" />
                Show on Globe
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="pressable flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-fill text-[17px] font-medium text-ink"
              >
                <Pencil size={17} aria-hidden="true" />
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="pressable flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md text-[17px] font-medium text-danger"
              >
                <Trash2 size={17} aria-hidden="true" />
                Delete Place
              </button>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      {/* Tap a photo to see it properly. */}
      <AnimatePresence>
        {lightbox && place ? (
          <motion.div
            className="fixed inset-0 z-[95] grid place-items-center bg-black/92 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close photo"
              className="absolute inset-0 cursor-default"
            />
            <PlaceImage
              place={{ ...place, coverImage: lightbox }}
              alt={`Photo of ${place.name}`}
              priority
              className="pointer-events-none relative max-h-[80dvh] w-full max-w-[560px] rounded-[20px] [&>img]:object-contain"
            />
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close photo"
              className="pressable absolute right-4 grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md"
              style={{ top: "max(env(safe-area-inset-top, 0px), 16px)" }}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

/**
 * One line of the grouped card: a quiet label above the thing itself.
 *
 * A row with somewhere to go is a button and says so with a chevron; a row
 * that is only information is not, so nothing invites a tap that does nothing.
 */
function Fact({
  icon,
  label,
  value,
  onPress,
  tabular,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
  tabular?: boolean;
}) {
  const body = (
    <>
      <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] leading-tight text-ink-3">{label}</span>
        <span
          className={`mt-[3px] block truncate text-[16px] leading-tight text-ink${tabular ? " tabular-nums" : ""}`}
        >
          {value}
        </span>
      </span>
      {onPress ? (
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
      ) : null}
    </>
  );

  const shell = "flex w-full items-center gap-3 px-3.5 py-3 text-left";

  return onPress ? (
    <button
      type="button"
      onClick={onPress}
      className={`${shell} transition-colors active:bg-fill-strong`}
    >
      {body}
    </button>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** A two-word statement of what this place is to you. */
function Badge({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone: "accent" | "danger";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[5px] text-[13px] font-semibold",
        tone === "accent" ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="pb-2 text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
      {children}
    </section>
  );
}
