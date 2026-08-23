import type { PlaybackKind } from "@/lib/photos/mediaPlaylist";

/**
 * The media player's brain, as a pure reducer.
 *
 * Everything time- and browser-shaped stays in the component: it owns the
 * interval that produces ticks, the <video> element that produces `ended`,
 * `error` and rejected `play()` promises, and nothing else. Every decision —
 * when a photo advances, why a video never advances on the clock, what pause
 * holds and what resume continues — lives here, where a test can drive a
 * whole playlist through in microseconds without a DOM.
 */

export type PlayerStatus =
  | "playing"
  | "paused"
  /**
   * A video's `play()` was rejected — iOS Safari declining to continue with
   * audio outside a user gesture. The player shows "Tap to continue" and the
   * tap dispatches `play`; the playlist never freezes silently.
   */
  | "blocked"
  /** Past the last item: the completion screen, with Play Again and Close. */
  | "done";

export type PlayerState = {
  /** One entry per playlist item, fixed for the player's lifetime. */
  kinds: readonly PlaybackKind[];
  index: number;
  status: PlayerStatus;
  /** How long the current timed item has already shown, across pauses. */
  photoElapsedMs: number;
  photoDurationMs: number;
  /**
   * Videos whose clip could not be played this run (load or decode failure).
   * A failed video becomes a timed item — its poster shows and the clock
   * advances past it — so one broken clip never strands the playlist.
   */
  failed: readonly boolean[];
};

export type PlayerEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "next" }
  | { type: "previous" }
  /** The component's clock, only ever additive; the reducer decides its worth. */
  | { type: "tick"; deltaMs: number }
  | { type: "videoEnded" }
  | { type: "videoBlocked" }
  | { type: "videoFailed" }
  | { type: "replay" };

/** Photos hold the screen for four seconds unless the caller says otherwise. */
export const DEFAULT_PHOTO_DURATION_MS = 4000;

export function createPlayerState(
  kinds: readonly PlaybackKind[],
  options: { photoDurationMs?: number; startAt?: number } = {},
): PlayerState {
  const startAt = Math.min(Math.max(options.startAt ?? 0, 0), Math.max(kinds.length - 1, 0));
  return {
    kinds,
    index: startAt,
    // Opening the player IS the explicit tap that starts playback; nothing
    // autoplays before that tap because the player does not exist before it.
    status: kinds.length === 0 ? "done" : "playing",
    photoElapsedMs: 0,
    photoDurationMs: Math.max(options.photoDurationMs ?? DEFAULT_PHOTO_DURATION_MS, 250),
    failed: kinds.map(() => false),
  };
}

/**
 * Whether the current item advances on the clock. Photos and poster-only
 * videos do; a real video advances only on its own `ended` event — unless
 * its clip failed, at which point the clock takes over so playback flows on.
 */
export function isTimedItem(state: PlayerState): boolean {
  const kind = state.kinds[state.index];
  if (kind === undefined) return false;
  return kind !== "video" || state.failed[state.index] === true;
}

/** `{ current: 12, total: 47 }` — the position readout, 1-based. */
export function playerPosition(state: PlayerState): { current: number; total: number } {
  if (state.kinds.length === 0) return { current: 0, total: 0 };
  return { current: state.index + 1, total: state.kinds.length };
}

/** 0..1 through the whole playlist, counting the current photo's own clock. */
export function playlistProgress(state: PlayerState, currentItemFraction?: number): number {
  const total = state.kinds.length;
  if (total === 0) return 0;
  if (state.status === "done") return 1;
  const fraction =
    currentItemFraction ??
    (isTimedItem(state)
      ? Math.min(state.photoElapsedMs / state.photoDurationMs, 1)
      : 0);
  return Math.min((state.index + Math.min(Math.max(fraction, 0), 1)) / total, 1);
}

/** One step forward: the next item, or the completion screen after the last. */
function advance(state: PlayerState): PlayerState {
  if (state.index >= state.kinds.length - 1) {
    return { ...state, status: "done", photoElapsedMs: 0 };
  }
  return {
    ...state,
    index: state.index + 1,
    photoElapsedMs: 0,
    // Moving on from a blocked video is movement; stay in motion.
    status: state.status === "blocked" ? "playing" : state.status,
  };
}

export function reducePlayer(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case "play": {
      if (state.status === "done" || state.status === "playing") return state;
      return { ...state, status: "playing" };
    }

    case "pause": {
      if (state.status !== "playing" && state.status !== "blocked") return state;
      return { ...state, status: "paused" };
    }

    case "toggle": {
      if (state.status === "done") return state;
      return { ...state, status: state.status === "playing" ? "paused" : "playing" };
    }

    case "next": {
      if (state.status === "done") return state;
      return advance(state);
    }

    case "previous": {
      // From the completion screen, back onto the last item.
      if (state.status === "done") {
        return {
          ...state,
          index: Math.max(state.kinds.length - 1, 0),
          status: "playing",
          photoElapsedMs: 0,
        };
      }
      return {
        ...state,
        index: Math.max(state.index - 1, 0),
        photoElapsedMs: 0,
        status: state.status === "blocked" ? "playing" : state.status,
      };
    }

    case "tick": {
      // The clock only moves a playing, timed item. Paused holds the elapsed
      // time exactly where it was — that is what "resume continues from the
      // current position" means — and a real video ignores the clock outright:
      // it advances on `ended` and on nothing else.
      if (state.status !== "playing" || !isTimedItem(state)) return state;
      const elapsed = state.photoElapsedMs + Math.max(event.deltaMs, 0);
      if (elapsed < state.photoDurationMs) return { ...state, photoElapsedMs: elapsed };
      return advance(state);
    }

    case "videoEnded": {
      // Only the current, still-playable video may advance the playlist; a
      // stray `ended` from a photo slide or an already-failed clip is noise.
      if (state.status === "done") return state;
      if (state.kinds[state.index] !== "video" || state.failed[state.index]) return state;
      return advance(state);
    }

    case "videoBlocked": {
      if (state.status !== "playing" || state.kinds[state.index] !== "video") return state;
      return { ...state, status: "blocked" };
    }

    case "videoFailed": {
      if (state.kinds[state.index] !== "video" || state.failed[state.index]) return state;
      const failed = state.failed.map((flag, at) => (at === state.index ? true : flag));
      return {
        ...state,
        failed,
        photoElapsedMs: 0,
        // A clip that cannot play cannot stay "blocked" — the poster shows
        // and the clock carries the playlist forward instead.
        status: state.status === "blocked" ? "playing" : state.status,
      };
    }

    case "replay": {
      return {
        ...state,
        index: 0,
        status: state.kinds.length === 0 ? "done" : "playing",
        photoElapsedMs: 0,
        failed: state.kinds.map(() => false),
      };
    }
  }
}
