"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Heart,
  Home,
  Luggage,
  MapPin,
  Pencil,
  Plane,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { TravelPhotoGallery } from "@/components/photos/TravelPhotoGallery";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { formatDays } from "@/lib/timeline/buildTimeline";
import { isResidenceVisit, isUpcomingVisit, visitStats } from "@/lib/places/visits";
import { formatMediaCounts, mediaCounts } from "@/lib/photos/mediaPlaylist";
import { photosForPlace, sortTravelPhotos } from "@/lib/photos/travelPhotos";
import { formatVisitRange, inclusiveDayCount } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { countryFlag, formatCoordinates, placeSubtitle } from "@/lib/utils/geo";
import type { PlaceVisit, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";
import type { TravelPhoto } from "@/types/travelPhoto";

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

/** One stable empty list, so a photo-less gallery's props never churn. */
const NO_PHOTOS: TravelPhoto[] = [];

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
  visits,
  onAddVisit,
  onEditVisit,
  tripNameFor,
  travelPhotos,
  photosEnabled,
  onAddPhotosToVisit,
  onRemovePhoto,
  onNeedMediaCode,
  onPlayMemories,
  galleryEpoch,
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
  /**
   * Every stay at this place, newest first — real Dates_Visits rows, or the
   * one implied by the dates recorded before visits existed.
   */
  visits: PlaceVisit[];
  onAddVisit: () => void;
  onEditVisit: (visit: PlaceVisit) => void;
  /** The name a visit's trip chip should carry, when it belongs to one. */
  tripNameFor: (tripId: string | undefined) => string | undefined;
  /** Every cloud photo, all contexts; this sheet slices per visit itself. */
  travelPhotos: TravelPhoto[];
  /** Whether the deployed script supports cloud photos at all. */
  photosEnabled: boolean;
  /** Launches Google Photos in the context of exactly this visit. */
  onAddPhotosToVisit: (visit: PlaceVisit) => void;
  onRemovePhoto: (photo: TravelPhoto) => Promise<void>;
  onNeedMediaCode: () => void;
  /** Opens the memories player on everything attached to this place. */
  onPlayMemories: () => void;
  /** Bumped when the media code changes, so galleries retry cleanly. */
  galleryEpoch: number;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Closing the sheet closes any open photo with it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open && lightbox) setLightbox(null);
  }

  const subtitle = place ? placeSubtitle(place) : "";
  const hasFlag = Boolean(place && countryFlag(place.countryCode));
  const extraPhotos = place?.photos ?? [];
  const hasCover = Boolean(place?.coverImage);

  const been = Boolean(place && !place.wantToGo);
  const stats = visitStats(visits);
  // The pill claims you've BEEN — a stay still ahead on the calendar hasn't
  // happened yet, however firmly it is planned.
  const beenCount = visits.filter(
    (visit) => !isUpcomingVisit(visit) && !isResidenceVisit(visit),
  ).length;
  const photoCount = extraPhotos.length + (hasCover ? 1 : 0);
  /* Sliced once per photo-library change, not once per render: this sheet
     re-renders with every toast and overlay above it, and a place with many
     visits was filtering and sorting the whole library once per visit each
     time. The map answers every visit row from one pass. */
  const placeId = place?.id;
  const placePhotos = useMemo(
    () => (placeId ? photosForPlace(travelPhotos, placeId) : NO_PHOTOS),
    [travelPhotos, placeId],
  );
  const photosByVisit = useMemo(() => {
    const map = new Map<string, TravelPhoto[]>();
    for (const photo of travelPhotos) {
      if (photo.deletedAt || !photo.visitId) continue;
      const list = map.get(photo.visitId);
      if (list) list.push(photo);
      else map.set(photo.visitId, [photo]);
    }
    for (const [visitId, list] of map) map.set(visitId, sortTravelPhotos(list));
    return map;
  }, [travelPhotos]);
  /** More than one gallery worth combining — the "All photos" strip. */
  const galleriesWithPhotos = new Set(
    placePhotos.map((photo) => photo.visitId ?? "").filter(Boolean),
  ).size;

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
              State reads as a badge, not as a row of facts — but only where
              nothing else is already saying it. The favourite control in the
              header is a filled red heart when it is on, three centimetres
              above where a pill reading "Favorite" used to repeat it; a wish,
              which has no control of its own here, still needs saying. A place
              that has been visited says how many times, in one warm line.
            */}
            {place.wantToGo ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Badge icon={<Bookmark size={13} aria-hidden="true" />} tone="accent">
                  Want to go
                </Badge>
              </div>
            ) : stats.hasResidence || beenCount > 0 ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {stats.hasResidence ? (
                  <Badge icon={<Home size={13} aria-hidden="true" />} tone="accent">
                    Lived here
                  </Badge>
                ) : null}
                {beenCount > 0 ? (
                  <Badge icon={<Plane size={13} aria-hidden="true" />} tone="accent">
                    {beenCount === 1
                      ? "You’ve been here once"
                      : `You’ve been here ${beenCount} times`}
                  </Badge>
                ) : null}
              </div>
            ) : null}

            {/* The numbers at a glance: how often, how long, when it started. */}
            {been && (stats.count > 0 || stats.hasResidence) ? (
              <div className="mt-4 grid grid-cols-4 divide-x divide-separator rounded-[18px] bg-fill/60 py-3.5">
                <Stat value={String(stats.count)} label={stats.count === 1 ? "visit" : "visits"} />
                <Stat
                  value={stats.daysTotal > 0 ? String(stats.daysTotal) : "—"}
                  label="days total"
                />
                <Stat value={stats.firstYear ?? "—"} label="first here" />
                <Stat value={stats.lastLabel ?? "—"} label="last visit" />
              </div>
            ) : null}

            {/* Every stay, newest first — the heart of the card. Each visit
                carries its own gallery: photos belong to the February trip,
                not to the city in the abstract. */}
            {been ? (
              <Section title="Your visits">
                <div className="overflow-hidden rounded-[18px] bg-fill/60">
                  <div className="divide-y divide-separator">
                    {visits.map((visit, index) => {
                      const visitPhotos = photosByVisit.get(visit.id) ?? NO_PHOTOS;
                      return (
                        <div key={visit.id}>
                          <VisitRow
                            visit={visit}
                            index={index}
                            tripName={visit.tripType ?? tripNameFor(visit.tripId)}
                            photoCount={visitPhotos.length}
                            onPress={() => onEditVisit(visit)}
                          />
                          {photosEnabled || visitPhotos.length > 0 ? (
                            <div className="px-3.5 pb-3">
                              <TravelPhotoGallery
                                key={galleryEpoch}
                                photos={visitPhotos}
                                bleed={false}
                                onAddPhotos={
                                  photosEnabled ? () => onAddPhotosToVisit(visit) : undefined
                                }
                                onRemovePhoto={onRemovePhoto}
                                onNeedMediaCode={onNeedMediaCode}
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={onAddVisit}
                    className={cn(
                      "pressable flex min-h-[48px] w-full items-center justify-center gap-1.5 text-[16px] font-medium text-accent",
                      visits.length > 0 && "border-t border-separator",
                    )}
                  >
                    <Plus size={17} aria-hidden="true" />
                    Add visit
                  </button>
                </div>
              </Section>
            ) : null}

            {/* Everything attached to this place, playable as one show. The
                combined strip only earns its space once two visit galleries
                exist — with one, it would repeat the strip just above. */}
            {placePhotos.length > 0 ? (
              <Section
                title="Memories"
                aside={
                  <span className="text-[14px] text-ink-3">
                    {formatMediaCounts(mediaCounts(placePhotos))}
                  </span>
                }
              >
                <button
                  type="button"
                  onClick={onPlayMemories}
                  className="pressable flex min-h-[50px] w-full items-center justify-center gap-2 rounded-md bg-accent text-[16px] font-semibold text-on-accent"
                >
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                  Play Memories
                </button>
                {galleriesWithPhotos > 1 ? (
                  <div className="mt-3">
                    <TravelPhotoGallery
                      key={galleryEpoch}
                      photos={placePhotos}
                      size="lg"
                      onRemovePhoto={onRemovePhoto}
                      onNeedMediaCode={onNeedMediaCode}
                    />
                  </div>
                ) : null}
              </Section>
            ) : null}

            {/* The facts, grouped — the trip, the coordinates. */}
            <div className="mt-6 divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
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
                label="Location details"
                value={formatCoordinates(place.latitude, place.longitude)}
                tabular
              />
            </div>

            {place.notes ? (
              <Section
                title="Notes"
                aside={
                  <button
                    type="button"
                    onClick={onEdit}
                    className="pressable rounded-pill text-[15px] font-medium text-accent"
                  >
                    Edit
                  </button>
                }
              >
                <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
                  {place.notes}
                </p>
              </Section>
            ) : null}

            {extraPhotos.length > 0 ? (
              <Section
                title="More photos"
                aside={
                  <span className="text-[14px] text-ink-3">
                    {photoCount === 1 ? "1 photo" : `${photoCount} photos`}
                  </span>
                }
              >
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

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  /** A quiet fact or a small action, right-aligned against the heading. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One cell of the stats row: the number, then what it counts. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center">
      <span className="w-full truncate text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-ink">
        {value}
      </span>
      <span className="w-full truncate text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">
        {label}
      </span>
    </div>
  );
}

/**
 * The visit dots cycle through a small fixed palette, so four stays read as
 * four distinct entries the way a metro map reads as lines — colour as
 * identity, not as meaning.
 */
const VISIT_DOT_COLORS = ["#8b7cf0", "#0fa89a", "#ef9440", "#4b96f0"];

function VisitRow({
  visit,
  index,
  tripName,
  photoCount,
  onPress,
}: {
  visit: PlaceVisit;
  index: number;
  /** The chip text: the visit's own type, or the trip it belonged to. */
  tripName?: string;
  photoCount: number;
  onPress: () => void;
}) {
  const range = formatVisitRange(visit.startDate, visit.endDate);
  const days = inclusiveDayCount(visit.startDate, visit.endDate);
  const upcoming = isUpcomingVisit(visit);
  const residence = isResidenceVisit(visit);

  const detail = [
    days ? formatDays(days) : null,
    upcoming ? "upcoming" : null,
    photoCount > 0 ? (photoCount === 1 ? "1 photo" : `${photoCount} photos`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onPress}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-fill-strong"
    >
      {/* A residence gets home's own mark, not another trip dot. */}
      {residence ? (
        <Home size={13} aria-hidden="true" className="shrink-0 text-accent" />
      ) : (
        <span
          aria-hidden="true"
          className="size-[9px] shrink-0 rounded-full"
          style={{ background: VISIT_DOT_COLORS[index % VISIT_DOT_COLORS.length] }}
        />
      )}
      <span className="min-w-0 flex-1">
        {residence ? (
          <span className="block text-[13px] font-semibold uppercase tracking-[0.04em] leading-tight text-accent">
            Lived here
          </span>
        ) : null}
        <span className="block truncate text-[16px] leading-tight text-ink">
          {range ?? "No date"}
        </span>
        {detail ? (
          <span className="mt-[3px] block text-[13px] leading-tight text-ink-3">{detail}</span>
        ) : null}
      </span>
      {tripName && !residence ? (
        <span className="max-w-[38%] truncate rounded-pill bg-accent-soft px-2.5 py-[4px] text-[13px] font-medium text-accent">
          {tripName}
        </span>
      ) : null}
      <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-ink-3" />
    </button>
  );
}
