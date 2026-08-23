"use client";

import { useMemo } from "react";
import { ImagePlus, MapPin, Pencil, Play, Plus, TriangleAlert, X } from "lucide-react";

import { TravelPhotoGallery } from "@/components/photos/TravelPhotoGallery";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { FlagChip } from "@/components/ui/FlagChip";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { formatMediaCounts, mediaCounts, playlistForTrip } from "@/lib/photos/mediaPlaylist";
import {
  formatPlaceCount,
  formatTripLength,
  groupTripDays,
  tripSummary,
  type TripDay,
} from "@/lib/trips/tripDays";
import { formatVisitRange } from "@/lib/utils/date";
import { flagVariant } from "@/lib/ui/flags";
import { countryFlag, placeSubtitle } from "@/lib/utils/geo";
import type { PlaceVisit, VisitedPlace } from "@/types/place";
import type { Trip } from "@/types/trip";
import type { TravelPhoto } from "@/types/travelPhoto";

/**
 * One trip, day by day.
 *
 * The days are counted from the trip's start date rather than stored, so
 * moving the trip's dates renumbers everything at once and there is no "Day 1"
 * anywhere to fall out of step. Each place is the same row the timeline draws,
 * and tapping one opens the same detail sheet it would open anywhere else — a
 * trip is a way of looking at the history, not a copy of it.
 */
export function TripDetailSheet({
  trip,
  places,
  visits,
  open,
  depth,
  onClose,
  onEdit,
  onOpenPlace,
  onAddPlace,
  travelPhotos,
  photosEnabled,
  onAddPhotos,
  onRemovePhoto,
  onNeedMediaCode,
  onPlayMemories,
  galleryEpoch,
}: {
  trip: Trip | null;
  places: VisitedPlace[];
  /** Every logged stay — visit-level Trip IDs are what fill this sheet. */
  visits: PlaceVisit[];
  open: boolean;
  /** Position in the sheet stack; see BottomSheet. */
  depth?: number;
  onClose: () => void;
  onEdit: () => void;
  onOpenPlace: (id: string) => void;
  onAddPlace: () => void;
  /** Every cloud photo; this sheet slices out the trip's own. */
  travelPhotos: TravelPhoto[];
  photosEnabled: boolean;
  /** Launches Google Photos with this trip's dates as the context. */
  onAddPhotos: () => void;
  onRemovePhoto: (photo: TravelPhoto) => Promise<void>;
  onNeedMediaCode: () => void;
  /** Opens the memories player on the whole trip's combined media. */
  onPlayMemories: () => void;
  galleryEpoch: number;
}) {
  /* Derived once per data change rather than once per render — this sheet
     re-renders with every state change in the shell above it, and the day
     grouping and playlist both walk the whole collection. */
  const grouping = useMemo(
    () => (trip ? groupTripDays(trip, places, visits) : null),
    [trip, places, visits],
  );
  const summary = useMemo(
    () => (trip ? tripSummary(trip, places, visits) : null),
    [trip, places, visits],
  );
  const when = trip ? formatVisitRange(trip.startDate, trip.endDate) : null;
  /* The trip's whole gallery: its own journey-level media plus every member
     place's, one entry per record however many ways it is reachable. */
  const tripPhotos = useMemo(
    () => (trip ? playlistForTrip(travelPhotos, trip, places, visits) : []),
    [travelPhotos, trip, places, visits],
  );
  const tripCounts = mediaCounts(tripPhotos);
  const isEmpty = Boolean(
    grouping &&
      grouping.days.length === 0 &&
      grouping.outside.length === 0 &&
      grouping.undated.length === 0,
  );

  return (
    <BottomSheet
      open={open && Boolean(trip)}
      onClose={onClose}
      depth={depth}
      label={trip ? `${trip.name} trip` : "Trip"}
      header={
        <div className="flex items-center justify-between gap-3 pb-2 pt-1">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">Trip</h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit trip"
              className="pressable grid size-9 place-items-center rounded-full bg-fill text-ink-2"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close trip"
              data-autofocus
              className="pressable -mr-1 grid size-9 place-items-center rounded-full bg-fill text-ink-2"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      }
    >
      {trip && grouping && summary ? (
        <div className="pb-4">
          <h1 className="wrap-anywhere text-[30px] font-bold leading-[1.12] tracking-[-0.03em] text-ink">
            {trip.name}
          </h1>
          {when ? <p className="mt-1 text-[16px] text-ink-2">{when}</p> : null}
          <p className="mt-0.5 text-[15px] tabular-nums text-ink-2">
            {[formatTripLength(summary.days), formatPlaceCount(summary.places)]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {trip.description ? (
            <p className="mt-3 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
              {trip.description}
            </p>
          ) : null}

          {/* The trip's whole gallery: journey-level media and every member
              place's, chronological. Adding here opens Google Photos with
              the trip's dates as context. */}
          {photosEnabled || tripPhotos.length > 0 ? (
            <section className="mt-5">
              <div className="flex items-baseline justify-between gap-3 pb-2">
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
                  Memories
                </h3>
                {tripPhotos.length > 0 ? (
                  <span className="text-[14px] text-ink-3">
                    {formatMediaCounts(tripCounts)}
                  </span>
                ) : null}
              </div>
              {tripPhotos.length > 0 ? (
                <button
                  type="button"
                  onClick={onPlayMemories}
                  className="pressable mb-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-md bg-accent text-[16px] font-semibold text-on-accent"
                >
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                  Play Trip Memories
                </button>
              ) : null}
              <TravelPhotoGallery
                key={galleryEpoch}
                photos={tripPhotos}
                size="lg"
                onAddPhotos={photosEnabled && tripPhotos.length > 0 ? onAddPhotos : undefined}
                onRemovePhoto={onRemovePhoto}
                onNeedMediaCode={onNeedMediaCode}
              />
              {photosEnabled && tripPhotos.length === 0 ? (
                <button
                  type="button"
                  onClick={onAddPhotos}
                  className="pressable mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-fill text-[15px] font-medium text-accent"
                >
                  <ImagePlus size={16} aria-hidden="true" />
                  Add photos & videos
                </button>
              ) : null}
            </section>
          ) : null}

          {isEmpty ? (
            <EmptyState
              className="pt-4"
              icon={<MapPin size={26} aria-hidden="true" />}
              title="No places added yet"
              description="Add a place and it joins this trip on the day you were there."
              action={
                <button
                  type="button"
                  onClick={onAddPlace}
                  className="pressable inline-flex min-h-[50px] items-center gap-2 rounded-md bg-accent px-6 text-[17px] font-semibold text-on-accent"
                >
                  <Plus size={19} aria-hidden="true" />
                  Add Place
                </button>
              }
            />
          ) : (
            <>
              <ol className="mt-5 space-y-6">
                {grouping.days.map((day) => (
                  <DaySection key={day.date} day={day} onOpenPlace={onOpenPlace} />
                ))}
              </ol>

              {grouping.outside.length > 0 ? (
                <section className="mt-7 border-t border-separator pt-5">
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                    <TriangleAlert size={15} aria-hidden="true" className="shrink-0 text-ink-3" />
                    Outside these dates
                  </h3>
                  <p className="mt-0.5 text-[13.5px] text-ink-2">
                    These are part of {trip.name} but fall outside {when ?? "its dates"}. Nothing
                    has been changed — edit the trip’s dates or the visit’s to line them up.
                  </p>
                  <ol className="mt-4 space-y-6">
                    {grouping.outside.map((day) => (
                      <DaySection key={day.date} day={day} onOpenPlace={onOpenPlace} />
                    ))}
                  </ol>
                </section>
              ) : null}

              {grouping.undated.length > 0 ? (
                <section className="mt-7 border-t border-separator pt-5">
                  <h3 className="text-[15px] font-semibold text-ink">No date yet</h3>
                  <p className="mt-0.5 text-[13.5px] text-ink-2">
                    {grouping.undated.length === 1 ? "1 place is" : `${grouping.undated.length} places are`}{" "}
                    in this trip without a date, so {grouping.undated.length === 1 ? "it has" : "they have"}{" "}
                    no day to sit under.
                  </p>
                  <ul className="mt-3 space-y-1">
                    {grouping.undated.map((place) => (
                      <li key={place.id}>
                        <PlaceRow place={place} onOpen={() => onOpenPlace(place.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <button
                type="button"
                onClick={onAddPlace}
                className="pressable mt-7 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-fill text-[17px] font-medium text-accent"
              >
                <Plus size={18} aria-hidden="true" />
                Add Place
              </button>
            </>
          )}
        </div>
      ) : null}
    </BottomSheet>
  );
}

/** One day of a trip: its number, its date, and what happened on it. */
function DaySection({ day, onOpenPlace }: { day: TripDay; onOpenPlace: (id: string) => void }) {
  return (
    <li>
      <div className="flex items-baseline gap-2.5">
        {day.dayNumber !== null && day.dayNumber > 0 ? (
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">
            Day {day.dayNumber}
          </h3>
        ) : null}
        <p className="truncate text-[13px] text-ink-3">{day.heading}</p>
      </div>

      <ul className="mt-2 space-y-1">
        {day.places.map((place) => (
          <li key={place.id}>
            <PlaceRow place={place} onOpen={() => onOpenPlace(place.id)} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * A place inside a trip, drawn the way the timeline draws one — same photo,
 * same flag, same wording — so a place looks like itself wherever it appears.
 */
function PlaceRow({ place, onOpen }: { place: VisitedPlace; onOpen: () => void }) {
  const hasFlag = Boolean(countryFlag(place.countryCode));
  // The city is the place as often as not: "Sintra, Sintra, Portugal".
  const where = placeSubtitle(place) || place.country;
  const span =
    place.visitedTo && place.visitedTo !== place.visitedFrom
      ? formatVisitRange(place.visitedFrom, place.visitedTo)
      : null;

  const hasPhoto = Boolean(place.coverImage);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1.5 text-left"
    >
      {hasPhoto ? (
        <PlaceImage
          place={place}
          alt=""
          className="size-[42px] shrink-0 overflow-hidden rounded-[13px]"
        />
      ) : (
        <FlagChip countryCode={place.countryCode} variant={flagVariant(place)} size="lg" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium leading-tight text-ink">
          {place.name}
        </span>
        <span className="block truncate text-[13px] leading-snug text-ink-2">
          {hasPhoto && hasFlag ? (
            <FlagChip countryCode={place.countryCode} className="mr-1.5" />
          ) : null}
          {[where, span].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
