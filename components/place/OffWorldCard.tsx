"use client";

import { Moon, Navigation2 } from "lucide-react";

import { MOON_WORLD, moonSiteAt } from "@/lib/space/moonPlaces";
import type { VisitedPlace } from "@/types/place";

/**
 * What the mini-map becomes for somewhere that is not on Earth.
 *
 * The little still of the map is the wrong picture entirely here: 0.67°N,
 * 23.47°E on Earth is open water off Somalia, and Google Maps has never heard
 * of Tranquility Base. What a lunar record can say instead is the true thing —
 * which world, which half of it, and the coordinates in that world's own grid,
 * which are the numbers a lunar atlas is indexed by.
 *
 * The picture is a tap away and always was: showing it on the globe takes the
 * camera off the Earth and puts the Moon in front of you, with this spot
 * marked on the surface.
 */
export function OffWorldCard({
  place,
  onShowOnGlobe,
}: {
  place: VisitedPlace;
  onShowOnGlobe?: () => void;
}) {
  const site = moonSiteAt(place.latitude, place.longitude);
  const region = site?.region ?? place.region;

  return (
    <div className="overflow-hidden rounded-[18px] bg-fill/60">
      <div className="flex items-start gap-3 px-3.5 py-3.5">
        <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Moon size={19} aria-hidden="true" fill="currentColor" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-ink">
            {region ? `${region}, the ${MOON_WORLD}` : `The ${MOON_WORLD}`}
          </p>
          {site ? (
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{site.blurb}</p>
          ) : null}
          {/* Selenographic, not terrestrial — said plainly, because the same
              two numbers on Earth point somewhere else entirely. */}
          <p className="mt-1.5 text-[13px] tabular-nums text-ink-3">
            {formatSelenographic(place.latitude, place.longitude)} · selenographic
          </p>
        </div>
      </div>

      {onShowOnGlobe ? (
        <button
          type="button"
          onClick={onShowOnGlobe}
          className="flex min-h-[46px] w-full items-center justify-center gap-1.5 border-t border-separator text-[15px] font-medium text-accent transition-colors active:bg-fill-strong"
        >
          <Navigation2 size={15} aria-hidden="true" />
          Show me on the {MOON_WORLD}
        </button>
      ) : null}
    </div>
  );
}

/** "0.6741° N, 23.4730° E" — the grid the lunar atlases are indexed by. */
export function formatSelenographic(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lng}`;
}
