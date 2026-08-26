"use client";

import { useSyncExternalStore } from "react";

/**
 * Kilometres or miles, decided by the browser rather than by us.
 *
 * A travel app that tells an American "9,173 km from home" has answered a
 * question nobody asked. The locale is the only honest signal available — the
 * journal holds no preference, and asking for one would be a settings screen
 * for a single word.
 *
 * Read as an external store with a defined server snapshot, the way every
 * other browser fact in this app is read, so the first paint hydrates cleanly
 * and only a miles reader sees the value swap, once.
 */

export type DistanceUnit = "km" | "mi";

/** Nothing to subscribe to: a page's locale cannot change while it is open. */
const noSubscription = () => () => {};

/**
 * The regions that measure a journey in miles. The United Kingdom signs its
 * roads in miles while buying petrol by the litre; Liberia and Myanmar are
 * the other two that never went metric on the road.
 */
const MILE_REGIONS = new Set(["US", "GB", "LR", "MM"]);

/** The region subtag of a BCP 47 language tag — "en-US" → "US". */
function regionOf(tag: string): string | null {
  const match = /^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})\b/i.exec(tag);
  return match ? match[1].toUpperCase() : null;
}

function preferredUnit(): DistanceUnit {
  if (typeof navigator === "undefined") return "km";
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const region = regionOf(tag ?? "");
    // The first tag that names a country decides; a bare "en" says nothing
    // about which side of the Atlantic it is spoken on, so it is skipped.
    if (region) return MILE_REGIONS.has(region) ? "mi" : "km";
  }
  return "km";
}

export function useDistanceUnit(): DistanceUnit {
  return useSyncExternalStore(noSubscription, preferredUnit, () => "km");
}

const KM_PER_MILE = 1.609344;

/**
 * A distance as a person would say it: rounded to something a memory can
 * hold, never to a precision the pin on the map cannot support.
 */
export function formatDistance(km: number, unit: DistanceUnit): string {
  const value = unit === "mi" ? km / KM_PER_MILE : km;
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()} ${unit}`;
}
