"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Images,
  KeyRound,
  Luggage,
  MapPin,
  Play,
} from "lucide-react";

import { TravelPhotoGallery } from "@/components/photos/TravelPhotoGallery";
import { EmptyState } from "@/components/ui/EmptyState";
import { useNearViewport } from "@/lib/hooks/useNearViewport";
import { formatMediaCounts, type MediaCounts } from "@/lib/photos/mediaPlaylist";
import { PhotoSourceError, loadTravelPhotoBlob } from "@/lib/photos/photoSource";
import {
  buildPlayerLibrary,
  formatLibrarySummary,
} from "@/lib/photos/playerLibrary";
import { isVideoTravelPhoto } from "@/lib/photos/travelPhotos";
import { cn } from "@/lib/utils/cn";
import { formatVisitRange } from "@/lib/utils/date";
import type { PlaceVisit, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";
import type { TravelPhoto } from "@/types/travelPhoto";

/**
 * The Player tab: everything there is to watch, in one list.
 *
 * The galleries and Play buttons already exist on each place's and trip's own
 * card — this tab is the other way in, for the moment when the question is
 * "show me my memories" rather than "show me Kyoto". Only trips and places
 * with something attached appear; each opens in place to offer exactly two
 * things, playing the show and browsing the media, plus the way through to
 * the full card.
 */
export function PlayerView({
  trips,
  places,
  visits,
  travelPhotos,
  loading,
  photosEnabled,
  bottomInset,
  onPlayTrip,
  onPlayPlace,
  onOpenTrip,
  onOpenPlace,
  onBrowsePlaces,
  onNeedMediaCode,
  galleryEpoch,
}: {
  trips: Trip[];
  places: VisitedPlace[];
  /** Every logged stay — visit-level trip membership reads from these. */
  visits: PlaceVisit[];
  travelPhotos: TravelPhoto[];
  loading: boolean;
  /** Whether this deployment stores photos at all. */
  photosEnabled: boolean;
  bottomInset: number;
  /** Opens the memories player on the trip's combined media. */
  onPlayTrip: (trip: Trip) => void;
  /** Opens the memories player on everything attached to the place. */
  onPlayPlace: (place: VisitedPlace) => void;
  onOpenTrip: (id: string) => void;
  onOpenPlace: (id: string) => void;
  /** The empty state's way out: go attach some photos. */
  onBrowsePlaces: () => void;
  /** Called when bytes can’t load because this device has no media code. */
  onNeedMediaCode: () => void;
  /** Bumped when the media code changes, so thumbnails retry cleanly. */
  galleryEpoch: number;
}) {
  const reduceMotion = useReducedMotion();

  const library = useMemo(
    () => buildPlayerLibrary(travelPhotos, trips, places, visits),
    [travelPhotos, trips, places, visits],
  );

  /** The one entry open at a time — `trip:<id>` or `place:<id>`. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [codeMissing, setCodeMissing] = useState(false);

  /* A newly saved code deserves a clean slate: forget the failure and let the
     remounted thumbnails below prove it works. Adjusted during render rather
     than in an effect, the same way PlaceImage resets on a new subject, so
     the stale banner never survives even one frame. */
  const [renderedEpoch, setRenderedEpoch] = useState(galleryEpoch);
  if (renderedEpoch !== galleryEpoch) {
    setRenderedEpoch(galleryEpoch);
    setCodeMissing(false);
  }

  /* Stable, because every thumbnail's load effect lists it as a dependency —
     a fresh closure per render would refetch every cover on every render. */
  const reportCodeMissing = useCallback(() => setCodeMissing(true), []);

  const empty = library.trips.length === 0 && library.places.length === 0;
  const summary = formatLibrarySummary(library);

  return (
    <div className="absolute inset-0 bg-bg">
      <div className="scroll-area absolute inset-0" style={{ paddingBottom: bottomInset }}>
        <div className="mx-auto w-full max-w-[720px] px-4 sm:max-w-[880px]">
          <header
            className="pb-3"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
            <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">
              Player
            </h1>
            {!loading && !empty ? (
              <p className="mt-1 text-[14px] text-ink-2">{summary} with memories</p>
            ) : null}
          </header>

          {loading ? (
            <ul className="space-y-2.5" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <li key={index} className="skeleton h-[78px] rounded-[18px]" />
              ))}
            </ul>
          ) : !photosEnabled ? (
            <EmptyState
              className="pt-8"
              icon={<Images size={28} aria-hidden="true" />}
              title="Photos aren’t set up"
              description="This sheet’s deployment doesn’t store photos or videos yet, so there’s nothing to play."
            />
          ) : empty ? (
            <EmptyState
              className="pt-8"
              icon={<Play size={28} aria-hidden="true" />}
              title="Nothing to play yet"
              description="Attach photos or videos to a place or a trip, and it’ll appear here ready to play."
              action={
                <button
                  type="button"
                  onClick={onBrowsePlaces}
                  className="pressable inline-flex min-h-[50px] items-center gap-2 rounded-md bg-accent px-6 text-[17px] font-semibold text-on-accent"
                >
                  Go to Places
                </button>
              }
            />
          ) : (
            <motion.div
              className="pb-6"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.3, 1] }}
            >
              {codeMissing ? (
                <button
                  type="button"
                  onClick={onNeedMediaCode}
                  className="pressable mb-4 flex w-full items-center gap-3 rounded-[16px] border border-dashed border-separator bg-fill/50 px-4 py-3 text-left"
                >
                  <KeyRound size={18} aria-hidden="true" className="shrink-0 text-ink-2" />
                  <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink-2">
                    Enter your media code to see photos and videos on this device.
                  </span>
                  <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-3" />
                </button>
              ) : null}

              {library.trips.length > 0 ? (
                <MemorySection title="Trips">
                  {library.trips.map((entry) => (
                    <MemoryRow
                      key={`trip:${entry.trip.id}`}
                      title={entry.trip.name}
                      when={formatVisitRange(entry.trip.startDate, entry.trip.endDate)}
                      counts={entry.counts}
                      playlist={entry.playlist}
                      fallbackIcon={<Luggage size={20} aria-hidden="true" />}
                      expanded={expandedId === `trip:${entry.trip.id}`}
                      onToggle={() =>
                        setExpandedId((current) =>
                          current === `trip:${entry.trip.id}` ? null : `trip:${entry.trip.id}`,
                        )
                      }
                      playLabel="Play Trip Memories"
                      onPlay={() => onPlayTrip(entry.trip)}
                      openLabel="Open Trip"
                      onOpen={() => onOpenTrip(entry.trip.id)}
                      onNeedMediaCode={onNeedMediaCode}
                      onCodeMissing={reportCodeMissing}
                      galleryEpoch={galleryEpoch}
                    />
                  ))}
                </MemorySection>
              ) : null}

              {library.places.length > 0 ? (
                <MemorySection title="Places">
                  {library.places.map((entry) => (
                    <MemoryRow
                      key={`place:${entry.place.id}`}
                      title={entry.place.name}
                      when={placeWhere(entry.place)}
                      counts={entry.counts}
                      playlist={entry.playlist}
                      fallbackIcon={<MapPin size={20} aria-hidden="true" />}
                      expanded={expandedId === `place:${entry.place.id}`}
                      onToggle={() =>
                        setExpandedId((current) =>
                          current === `place:${entry.place.id}`
                            ? null
                            : `place:${entry.place.id}`,
                        )
                      }
                      playLabel="Play Memories"
                      onPlay={() => onPlayPlace(entry.place)}
                      openLabel="Open Place"
                      onOpen={() => onOpenPlace(entry.place.id)}
                      onNeedMediaCode={onNeedMediaCode}
                      onCodeMissing={reportCodeMissing}
                      galleryEpoch={galleryEpoch}
                    />
                  ))}
                </MemorySection>
              ) : null}
            </motion.div>
          )}
        </div>
      </div>

      {/* Keeps scrolling content from running into the status bar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-bg/85 backdrop-blur-xl"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />
    </div>
  );
}

/** "Kyoto, Japan" without ever saying "Kyoto, Kyoto". */
function placeWhere(place: VisitedPlace): string | null {
  const city = place.city && place.city !== place.name ? place.city : null;
  return [city, place.country].filter(Boolean).join(", ") || null;
}

function MemorySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pb-4">
      <h2 className="pb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {title}
      </h2>
      <ul className="space-y-2.5">{children}</ul>
    </section>
  );
}

/**
 * One watchable thing. Collapsed, it is a row — cover, name, what it holds.
 * Open, it is the two promised actions: the big Play, and the same gallery
 * strip the cards use, thumbnails through to the full-screen viewer with
 * videos playing in place. Opening never navigates; the list stays under it.
 */
function MemoryRow({
  title,
  when,
  counts,
  playlist,
  fallbackIcon,
  expanded,
  onToggle,
  playLabel,
  onPlay,
  openLabel,
  onOpen,
  onNeedMediaCode,
  onCodeMissing,
  galleryEpoch,
}: {
  title: string;
  when: string | null;
  counts: MediaCounts;
  playlist: TravelPhoto[];
  fallbackIcon: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  playLabel: string;
  onPlay: () => void;
  openLabel: string;
  onOpen: () => void;
  onNeedMediaCode: () => void;
  /** The cover couldn’t load for want of a media code — the view shows one banner. */
  onCodeMissing: () => void;
  galleryEpoch: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <li className="overflow-hidden rounded-[18px] bg-fill/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="pressable flex w-full items-center gap-3 py-2.5 pl-2.5 pr-3 text-left"
      >
        {/* Keyed on the epoch: a freshly saved media code remounts the cover
            and its load starts over clean. */}
        <MediaThumb
          key={galleryEpoch}
          photo={playlist[0]}
          fallbackIcon={fallbackIcon}
          onCodeMissing={onCodeMissing}
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {title}
          </span>
          {when ? (
            <span className="mt-0.5 block truncate text-[13.5px] leading-snug text-ink-2">
              {when}
            </span>
          ) : null}
          <span className="block truncate text-[13px] leading-snug text-ink-3">
            {formatMediaCounts(counts)}
          </span>
        </span>

        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-ink-3 transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="panel"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.26, ease: [0.2, 0.8, 0.3, 1] }
            }
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={onPlay}
                className="pressable flex min-h-[50px] w-full items-center justify-center gap-2 rounded-md bg-accent text-[16px] font-semibold text-on-accent"
              >
                <Play size={16} fill="currentColor" aria-hidden="true" />
                {playLabel}
              </button>

              {/* The strip is view-only here: adding and removing stay on the
                  card itself, where the visit context lives. */}
              <div className="mt-3">
                <TravelPhotoGallery
                  key={galleryEpoch}
                  photos={playlist}
                  onNeedMediaCode={onNeedMediaCode}
                  bleed={false}
                />
              </div>

              <button
                type="button"
                onClick={onOpen}
                className="pressable mt-2 flex min-h-10 w-full items-center justify-center gap-1 rounded-[14px] bg-fill text-[14px] font-medium text-accent"
              >
                {openLabel}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

/**
 * The row's cover: the playlist's first item, loaded lazily through the same
 * cache as every gallery tile. Failures stay quiet — the tinted tile and its
 * icon are the design, not an apology — except the one failure the person
 * can actually fix, a missing media code, which is reported upward so the
 * view can say so once instead of once per row.
 */
function MediaThumb({
  photo,
  fallbackIcon,
  onCodeMissing,
}: {
  photo: TravelPhoto | undefined;
  fallbackIcon: ReactNode;
  onCodeMissing: () => void;
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(wrapperRef);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The load's identity is the row and its version, never the object — a
  // background sync replaces the array wholesale without the pixels changing.
  const id = photo?.id;
  const updatedAt = photo?.updatedAt;

  useEffect(() => {
    if (!near || !id || !updatedAt) return;
    let disposed = false;
    let objectUrl: string | null = null;

    void loadTravelPhotoBlob({ id, updatedAt }, "thumb")
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setFailed(false);
        setUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setFailed(true);
        const reason = error instanceof PhotoSourceError ? error.reason : "failed";
        if (reason === "code-missing" || reason === "code-rejected") onCodeMissing();
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [near, id, updatedAt, onCodeMissing]);

  return (
    <span
      ref={wrapperRef}
      aria-hidden="true"
      className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-fill text-ink-3"
    >
      {url && !failed ? (
        <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
      ) : photo && !failed ? (
        <span className="skeleton absolute inset-0" />
      ) : (
        fallbackIcon
      )}
      {photo && isVideoTravelPhoto(photo) ? (
        <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          <Play size={11} fill="currentColor" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}
