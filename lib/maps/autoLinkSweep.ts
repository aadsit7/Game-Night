import { autoLinkGooglePlace, hasGoogleDetails } from "@/lib/maps/placeDetails";
import { isOffWorldPlace } from "@/lib/space/moonPlaces";
import type { VisitedPlace } from "@/types/place";

/**
 * Lighting up the back catalogue.
 *
 * Places saved before the Google integration have no listing id, so their
 * cards, previews and map buttons stay dark until each is opened by hand —
 * with a couple of hundred places, effectively forever. This sweep works
 * through them in the background instead: one place every few seconds while
 * the app is open and visible, using the same biased, confident-match-only
 * search a card open would run, persisting each find through the same path.
 *
 * It is built to be invisible: network only, never a render; paused while
 * the tab is hidden; a place with no confident match is noted on the device
 * and not asked about again for a week, so the sweep converges to nothing
 * instead of asking the same unanswerable questions on every visit.
 */

/**
 * The version is part of the key on purpose.
 *
 * These notes say "Google had no confident answer for this place", and that
 * is only ever true of the matcher that asked. Widening the tolerances — a
 * city's listing sits at its centroid, not on your street corner — makes a
 * great many of the old notes wrong, and a note that is wrong for a month is
 * a place whose card stays dark for a month. Bumping the version retires the
 * whole set, so the back catalogue is asked again with the question that can
 * now answer it.
 */
const TRIED_KEY = "travel-globe.autolink-tried.v2";
/** An unmatched place is worth asking about again — but not before this. */
const TRIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** One place every four seconds — 200 of them clear inside a quarter hour. */
const STEP_MS = 4_000;
/** The first step waits out the app's own startup work. */
const FIRST_STEP_MS = 1_500;
/** With nothing left to link, look again only occasionally. */
const IDLE_MS = 60_000;

type TriedMap = Record<string, number>;

/** Forget attempts old enough to be worth repeating. Pure, for testing. */
export function pruneTried(tried: TriedMap, now: number): TriedMap {
  const kept: TriedMap = {};
  for (const [id, at] of Object.entries(tried)) {
    if (now - at < TRIED_TTL_MS) kept[id] = at;
  }
  return kept;
}

/** The next place worth asking about: unlinked, alive, not asked lately. */
export function nextSweepCandidate(
  places: VisitedPlace[],
  tried: TriedMap,
  now = Date.now(),
): VisitedPlace | null {
  for (const place of places) {
    if (place.googlePlaceId || place.deletedAt) continue;
    // Google Maps does not list the Sea of Tranquility. Asking anyway would
    // spend a call to be told so, once a week, for as long as the app exists.
    if (isOffWorldPlace(place)) continue;
    const at = tried[place.id];
    if (at && now - at < TRIED_TTL_MS) continue;
    return place;
  }
  return null;
}

function readTried(): TriedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TRIED_KEY);
    return raw ? ((JSON.parse(raw) as TriedMap) ?? {}) : {};
  } catch {
    return {};
  }
}

function writeTried(tried: TriedMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TRIED_KEY, JSON.stringify(pruneTried(tried, Date.now())));
  } catch {
    // Forgetting the note only means asking again sooner. Harmless.
  }
}

/** One sweep per page, however many times React mounts the shell. */
let running = false;

export function startAutoLinkSweep({
  getPlaces,
  onLinked,
}: {
  /** Read fresh each step, so new saves join the queue without a restart. */
  getPlaces: () => VisitedPlace[];
  /** A confident match was found; persist it (the card-open path's twin). */
  onLinked: (placeId: string, googlePlaceId: string) => void;
}): () => void {
  if (typeof window === "undefined" || running) return () => undefined;
  running = true;

  let stopped = false;
  let timer: number | null = null;

  const schedule = (delay: number) => {
    timer = window.setTimeout(() => void step(), delay);
  };

  const step = async () => {
    timer = null;
    if (stopped) return;

    // Only while someone is looking, and only when Google can answer.
    if (document.visibilityState !== "visible" || !hasGoogleDetails()) {
      schedule(STEP_MS);
      return;
    }

    const tried = readTried();
    const candidate = nextSweepCandidate(getPlaces(), tried);
    if (!candidate) {
      schedule(IDLE_MS);
      return;
    }

    try {
      const linked = await autoLinkGooglePlace(candidate);
      if (linked) {
        onLinked(candidate.id, linked);
      } else {
        tried[candidate.id] = Date.now();
        writeTried(tried);
      }
    } catch {
      // A failed search is a note, not a problem — the week passes.
      tried[candidate.id] = Date.now();
      writeTried(tried);
    }

    if (!stopped) schedule(STEP_MS);
  };

  schedule(FIRST_STEP_MS);
  return () => {
    stopped = true;
    running = false;
    if (timer !== null) window.clearTimeout(timer);
  };
}
