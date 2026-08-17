"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Globe2, Pencil, Trash2, X } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { PlaceImage } from "@/components/ui/PlaceImage";
import { usePrefersDark } from "@/lib/hooks/useMediaQuery";
import { locatorImageUrl } from "@/lib/maps/mapbox";
import { formatVisitRange } from "@/lib/utils/date";
import { countryFlag, formatCoordinates, placeSubtitle } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

/**
 * The full memory: a hero photograph, when you were there, what you wrote, the
 * rest of the photos, and where on Earth it sits. Coordinates exist here but
 * stay in the small print — they are plumbing, not the story.
 */
export function PlaceDetailSheet({
  place,
  open,
  onClose,
  onEdit,
  onShowOnGlobe,
  onDelete,
  recessed,
}: {
  place: VisitedPlace | null;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onShowOnGlobe: () => void;
  onDelete: () => void;
  recessed?: boolean;
}) {
  const prefersDark = usePrefersDark();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Closing the sheet closes any open photo with it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open && lightbox) setLightbox(null);
  }

  const when = place ? formatVisitRange(place.visitedFrom, place.visitedTo) : null;
  const subtitle = place ? placeSubtitle(place) : "";
  const flag = place ? countryFlag(place.countryCode) : null;
  const extraPhotos = place?.photos ?? [];

  const locator = place
    ? locatorImageUrl({
        latitude: place.latitude,
        longitude: place.longitude,
        width: 640,
        height: 320,
        dark: prefersDark,
      })
    : null;

  return (
    <>
      <BottomSheet
        open={open && Boolean(place)}
        onClose={onClose}
        recessed={recessed}
        label={place ? `${place.name} details` : "Place details"}
        header={
          <div className="flex items-center justify-between gap-3 pb-2 pt-1">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
              Details
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              data-autofocus
              className="pressable -mr-1 grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        }
      >
        {place ? (
          <div className="pb-4">
            <h1 className="wrap-anywhere text-[30px] font-bold leading-[1.12] tracking-[-0.03em] text-ink">
              {place.name}
            </h1>
            {subtitle ? (
              <p className="mt-1 text-[16px] text-ink-2">
                {flag ? <span className="mr-1.5">{flag}</span> : null}
                {subtitle}
              </p>
            ) : null}
            {when ? <p className="mt-0.5 text-[15px] text-ink-3">{when}</p> : null}

            <PlaceImage
              place={place}
              alt={`${place.name}`}
              width={900}
              height={640}
              priority
              className="mt-4 aspect-[4/3] w-full rounded-[22px]"
            />

            {place.notes ? (
              <p className="mt-4 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
                {place.notes}
              </p>
            ) : null}

            {extraPhotos.length > 0 ? (
              <section className="mt-5">
                <h3 className="pb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  Photos
                </h3>
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
                        width={360}
                        height={360}
                        className="size-[132px] rounded-[16px]"
                      />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-5">
              <h3 className="pb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                Location
              </h3>
              <button
                type="button"
                onClick={onShowOnGlobe}
                className="pressable block w-full overflow-hidden rounded-[18px] bg-fill text-left"
              >
                {locator ? (
                  <img
                    src={locator}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[2/1] w-full object-cover"
                  />
                ) : (
                  <div className="grid aspect-[2/1] w-full place-items-center text-ink-3">
                    <Globe2 size={26} aria-hidden="true" />
                  </div>
                )}
                <span className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-ink">
                      Show on Globe
                    </span>
                    <span className="block truncate text-[12.5px] tabular-nums text-ink-3">
                      {formatCoordinates(place.latitude, place.longitude)}
                    </span>
                  </span>
                  <Globe2 size={18} aria-hidden="true" className="shrink-0 text-accent" />
                </span>
              </button>
            </section>

            <div className="mt-5 space-y-2.5">
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
              width={1200}
              height={1200}
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
