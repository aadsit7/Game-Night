"use client";

import { useEffect, useMemo, useState } from "react";

import { staticImageUrl } from "@/lib/maps/mapbox";
import { isLocalPhotoRef, resolvePhotoUrl } from "@/lib/storage/photoStore";
import { cn } from "@/lib/utils/cn";
import { hasValidCoordinates } from "@/lib/utils/geo";

/**
 * Imagery for a place, with a graceful ladder of fallbacks:
 *
 *   1. the photograph the traveller attached;
 *   2. failing that, satellite imagery of the exact coordinates — a small
 *      postcard of the spot rather than an empty grey rectangle;
 *   3. failing that (no token, offline), a calm tinted gradient derived from
 *      the place name, so no card ever shows a broken-image icon.
 */

type Source = "photo" | "satellite" | "gradient";

export type PlaceImageSubject = {
  name: string;
  latitude: number;
  longitude: number;
  coverImage?: string;
};

function hue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

export function PlaceImage({
  place,
  className,
  width = 800,
  height = 500,
  zoom,
  priority = false,
  alt,
}: {
  place: PlaceImageSubject;
  className?: string;
  width?: number;
  height?: number;
  zoom?: number;
  priority?: boolean;
  alt?: string;
}) {
  const [source, setSource] = useState<Source>(place.coverImage ? "photo" : "satellite");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const coverRef = place.coverImage;
  const subjectKey = `${coverRef ?? ""}|${place.latitude}|${place.longitude}`;
  const [renderedKey, setRenderedKey] = useState(subjectKey);

  // A new subject resets the ladder during render rather than in an effect, so
  // the old image never flashes for a frame before being replaced.
  if (renderedKey !== subjectKey) {
    setRenderedKey(subjectKey);
    setSource(coverRef ? "photo" : "satellite");
    setObjectUrl(null);
    setLoaded(false);
  }

  const satelliteUrl = useMemo(
    () =>
      hasValidCoordinates(place)
        ? staticImageUrl({
            latitude: place.latitude,
            longitude: place.longitude,
            width,
            height,
            zoom,
          })
        : null,
    [place, width, height, zoom],
  );

  // Local photos are blobs in IndexedDB; turn them into object URLs on demand.
  useEffect(() => {
    if (!coverRef || !isLocalPhotoRef(coverRef)) return;

    let cancelled = false;
    let created: string | null = null;

    void resolvePhotoUrl(coverRef).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (url) {
        created = url;
        setObjectUrl(url);
      } else {
        setSource("satellite");
      }
    });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [coverRef]);

  const photoUrl = coverRef && !isLocalPhotoRef(coverRef) ? coverRef : objectUrl;
  const src = source === "photo" ? photoUrl : source === "satellite" ? satelliteUrl : null;
  const showGradient = source === "gradient" || !src;
  // A narrow band of cool, dusk-like hues keyed off the name: distinct enough
  // to tell two cards apart, quiet enough never to shout.
  const tint = 190 + (hue(place.name || "place") % 90);

  return (
    <div
      className={cn("relative isolate overflow-hidden bg-fill", className)}
      // The gradient sits underneath at all times, so a slow or failed image
      // reveals something intentional rather than a hole in the layout.
      style={{
        backgroundImage: `linear-gradient(155deg, oklch(0.62 0.055 ${tint}) 0%, oklch(0.4 0.06 ${
          (tint + 34) % 360
        }) 100%)`,
      }}
    >
      {!showGradient && (
        <img
          src={src ?? undefined}
          alt={alt ?? ""}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setSource((current) => (current === "photo" ? "satellite" : "gradient"));
          }}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      {showGradient && (
        <span aria-hidden="true" className="absolute inset-0">
          {/* A soft horizon and a small pin — a place, not a missing file. */}
          <span
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(120% 90% at 50% 118%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 62%)",
            }}
          />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="absolute left-1/2 top-1/2 size-[22%] max-h-14 min-h-6 -translate-x-1/2 -translate-y-1/2 text-white/55"
          >
            <path
              d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="10" r="2.4" fill="currentColor" />
          </svg>
        </span>
      )}
    </div>
  );
}
