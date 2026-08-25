"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";

import { usePrefersDark } from "@/lib/hooks/useMediaQuery";
import { googleMapsUrl } from "@/lib/maps/googleMapsLinks";
import { miniMapSnapshot } from "@/lib/maps/miniMapSnapshot";
import { cn } from "@/lib/utils/cn";
import { formatCoordinates } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

/**
 * Where the place is, as a picture instead of a pair of numbers.
 *
 * The box is the map's size from the first paint — the snapshot fades in
 * when it is ready, and if it never arrives (offline, WebGL refused) the
 * same box stays as a quiet card with the pin and the coordinates, so the
 * layout never moves either way. The whole thing opens the spot in Google
 * Maps, which is what tapping a little map means everywhere.
 */
export function PlaceMiniMap({ place }: { place: VisitedPlace }) {
  const dark = usePrefersDark();
  const { latitude, longitude } = place;
  const frame = `${latitude},${longitude},${dark ? "dark" : "light"}`;

  const [shot, setShot] = useState<{ frame: string; uri: string | null; failed: boolean }>({
    frame,
    uri: null,
    failed: false,
  });
  // A different place (or theme) resets during render, never mid-effect.
  if (shot.frame !== frame) setShot({ frame, uri: null, failed: false });

  useEffect(() => {
    let alive = true;
    // The sheet's opening animation finishes before any map work starts —
    // a snapshot is never worth a stutter on the way up.
    const timer = window.setTimeout(() => {
      void miniMapSnapshot(latitude, longitude, dark).then((uri) => {
        if (alive) setShot({ frame, uri, failed: uri === null });
      });
    }, 450);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [frame, latitude, longitude, dark]);

  const snapshot = shot.frame === frame ? shot.uri : null;
  const failed = shot.frame === frame && shot.failed;

  return (
    <a
      href={googleMapsUrl(place)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${place.name} in Google Maps`}
      className="pressable relative block overflow-hidden rounded-[18px] bg-fill/60"
    >
      {snapshot ? (
        <img
          src={snapshot}
          alt=""
          draggable={false}
          className="h-[150px] w-full object-cover"
        />
      ) : (
        <div className={cn("h-[150px] w-full", !failed && "skeleton")} aria-hidden="true" />
      )}

      {/* The pin's tip sits exactly on the place. */}
      <MapPin
        size={30}
        aria-hidden="true"
        fill="currentColor"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-accent drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] [&>circle]:fill-white [&>circle]:stroke-white"
      />

      <span className="absolute bottom-2 left-2 rounded-pill bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
        {formatCoordinates(place.latitude, place.longitude)}
      </span>
    </a>
  );
}
