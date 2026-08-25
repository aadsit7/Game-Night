"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  KeyRound,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";

import { Portal } from "@/components/ui/Portal";
import { useHistorySentinel } from "@/lib/hooks/useHistorySentinel";
import { playbackKind } from "@/lib/photos/mediaPlaylist";
import {
  createPlayerState,
  isTimedItem,
  playerPosition,
  playlistProgress,
  reducePlayer,
} from "@/lib/photos/playerCore";
import { PhotoSourceError, loadTravelPhotoBlob } from "@/lib/photos/photoSource";
import { PLAYER_LAYER } from "@/lib/ui/sheetStack";
import type { TravelPhoto } from "@/types/travelPhoto";

/**
 * The one media player. A place's memories and a whole trip's play through
 * exactly this component — the only difference between them is the array
 * they hand over. Photos hold the screen for a few seconds and dissolve into
 * each other; videos play with their own sound and yield the screen when
 * their `ended` event says so; pause holds both kinds exactly where they
 * are. Everything it shows is the app's own stored copy, loaded through the
 * same cache the galleries use — playback never touches a Google Photos
 * original, and never could: nothing here can name one.
 *
 * iPhone Safari is the design target. Videos are `playsInline`, playback
 * starts from the explicit tap that opened the player, and when Safari
 * refuses to continue a later video's audio without a fresh gesture, the
 * player says so with one "Tap to continue" instead of freezing.
 */
export function TravelMediaPlayer({
  open,
  title,
  subtitle,
  photos,
  startAt = 0,
  photoDurationMs,
  completionLabel = "Memories complete",
  onClose,
  onNeedMediaCode,
}: {
  open: boolean;
  /** "Kyoto" or "Japan Trip" — the heading over the show. */
  title: string;
  /** "12 photos · 3 videos" — quiet context under the title. */
  subtitle?: string;
  /** The playlist, already selected and ordered by `mediaPlaylist`. */
  photos: TravelPhoto[];
  startAt?: number;
  /** How long each photo holds the screen. The seam for a future setting. */
  photoDurationMs?: number;
  /** "Memories complete" for a place, "Trip complete" for a trip. */
  completionLabel?: string;
  onClose: () => void;
  /** Called when bytes can’t load because this device has no media code. */
  onNeedMediaCode?: () => void;
}) {
  const reduceMotion = useReducedMotion();

  // Back closes the show, the way it closes every full-screen thing here.
  useHistorySentinel(open && photos.length > 0, onClose);

  return (
    <Portal>
      <AnimatePresence>
        {open && photos.length > 0 ? (
          <motion.div
            className="fixed inset-0 bg-black"
            style={{ zIndex: PLAYER_LAYER }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
          >
            <PlayerSurface
              title={title}
              subtitle={subtitle}
              photos={photos}
              startAt={startAt}
              photoDurationMs={photoDurationMs}
              completionLabel={completionLabel}
              onClose={onClose}
              onNeedMediaCode={onNeedMediaCode}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Portal>
  );
}

/**
 * Everything inside the black rectangle. Mounted fresh each time the player
 * opens, so a session's state machine, timers and loaded bytes never leak
 * into the next — and unmounting is the cleanup: every interval, listener
 * and object URL below is released by its own effect's teardown.
 */
function PlayerSurface({
  title,
  subtitle,
  photos,
  startAt,
  photoDurationMs,
  completionLabel,
  onClose,
  onNeedMediaCode,
}: {
  title: string;
  subtitle?: string;
  photos: TravelPhoto[];
  startAt: number;
  photoDurationMs?: number;
  completionLabel: string;
  onClose: () => void;
  onNeedMediaCode?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  /** The mounted <video>, for play()/pause() inside the user's own gesture. */
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);

  const kinds = useMemo(() => photos.map((photo) => playbackKind(photo)), [photos]);
  const [state, dispatch] = useReducer(reducePlayer, undefined, () =>
    createPlayerState(kinds, { photoDurationMs, startAt }),
  );

  const current = photos[Math.min(state.index, photos.length - 1)];
  const currentKind = state.kinds[state.index] ?? "photo";
  const currentFailed = state.failed[state.index] === true;
  const showVideo = currentKind === "video" && !currentFailed;
  const timed = isTimedItem(state);
  const playing = state.status === "playing";
  const position = playerPosition(state);

  /* ---------------------------------------------------------------- *
   * Per-item presentation state, reset the moment the item changes
   * ---------------------------------------------------------------- */
  const [videoFraction, setVideoFraction] = useState(0);
  /** The clock waits for pixels: a slow photo loads, then gets its 4 seconds. */
  const [stageReady, setStageReady] = useState(false);
  const [shownIndex, setShownIndex] = useState(state.index);
  if (shownIndex !== state.index) {
    setShownIndex(state.index);
    setVideoFraction(0);
    setStageReady(false);
  }

  const [codeNeeded, setCodeNeeded] = useState(false);
  const onMediaFailure = useCallback((reason: PhotoSourceError["reason"]) => {
    if (reason === "code-missing" || reason === "code-rejected") setCodeNeeded(true);
  }, []);
  useEffect(() => {
    if (codeNeeded) dispatch({ type: "pause" });
  }, [codeNeeded]);

  /* Stable identities for the stage's callbacks: the parent re-renders on
     every clock tick, and a fresh function per render would re-run the
     children's load effects — refetching the photo it was busy showing. */
  const markStageReady = useCallback(() => setStageReady(true), []);
  const handleVideoEnded = useCallback(() => dispatch({ type: "videoEnded" }), []);
  const handleVideoBlocked = useCallback(() => dispatch({ type: "videoBlocked" }), []);
  const handleVideoFailed = useCallback(() => dispatch({ type: "videoFailed" }), []);

  /* ---------------------------------------------------------------- *
   * The photo clock — the only source of ticks
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!playing || !timed || !stageReady || codeNeeded) return;
    let last = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      // A backgrounded tab throttles intervals; a clamped delta means coming
      // back shows the photo you left, not the far end of the playlist.
      const delta = Math.min(now - last, 1000);
      last = now;
      dispatch({ type: "tick", deltaMs: delta });
    }, 100);
    return () => window.clearInterval(interval);
  }, [playing, timed, stageReady, codeNeeded, state.index]);

  /* Warm the next item's display rendition while this one holds the screen —
     never the whole playlist, and never a clip's full bytes. */
  useEffect(() => {
    const next = photos[state.index + 1];
    if (!next) return;
    void loadTravelPhotoBlob(next, "display").catch(() => undefined);
  }, [state.index, photos]);

  /* ---------------------------------------------------------------- *
   * Controls. Video play()/pause() happens inside the gesture itself —
   * that is what iOS accepts — with the status effect as the backstop.
   * ---------------------------------------------------------------- */
  const handleToggle = useCallback(() => {
    if (state.status === "done") return;
    if (state.status === "playing") {
      activeVideoRef.current?.pause();
      dispatch({ type: "pause" });
    } else {
      const video = activeVideoRef.current;
      if (video) void video.play().catch(() => undefined);
      dispatch({ type: "play" });
    }
  }, [state.status]);

  const handleContinueTap = useCallback(() => {
    const video = activeVideoRef.current;
    if (video) void video.play().catch(() => undefined);
    dispatch({ type: "play" });
  }, []);

  const handleNext = useCallback(() => dispatch({ type: "next" }), []);
  const handlePrevious = useCallback(() => {
    // Stepping back within a video restarts it, the way Previous behaves in
    // every player; a second press moves to the item before.
    const video = activeVideoRef.current;
    if (video && video.currentTime > 2) {
      video.currentTime = 0;
      setVideoFraction(0);
      return;
    }
    dispatch({ type: "previous" });
  }, []);

  /* Keyboard, for the desktop third of the audience. Capture phase, so the
     sheet underneath never sees the Escape that was meant for the player. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        handleToggle();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlePrevious();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, handleToggle, handleNext, handlePrevious]);

  /* ---------------------------------------------------------------- *
   * Full screen, where the platform has it. iPhone Safari doesn't for
   * arbitrary elements — there the player is already edge to edge.
   * ---------------------------------------------------------------- */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSupported =
    typeof document !== "undefined" && document.fullscreenEnabled === true;

  useEffect(() => {
    if (!fullscreenSupported) return;
    const root = rootRef.current;
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      // Closing the player hands the screen back.
      if (document.fullscreenElement && document.fullscreenElement === root) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [fullscreenSupported]);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void root.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const itemFraction = showVideo
    ? videoFraction
    : Math.min(state.photoElapsedMs / state.photoDurationMs, 1);
  const progress = playlistProgress(state, itemFraction);

  const posterNote =
    currentKind === "poster"
      ? "The full video was too large to store — showing its preview."
      : currentFailed
        ? "The video couldn’t be played — showing its preview."
        : null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${title} — memories player`}
      className="absolute inset-0 flex flex-col bg-black"
    >
      {/* The stage. Photos and posters letterbox rather than crop. */}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          <motion.div
            key={`${state.index}-${current?.id ?? "empty"}`}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Photos dissolve into each other; a video cuts, because a clip
            // lingering through a crossfade would keep its audio playing.
            transition={{ duration: reduceMotion || showVideo ? 0 : 0.5 }}
          >
            {current ? (
              showVideo ? (
                <PlayerVideo
                  key={current.id}
                  photo={current}
                  playing={playing && !codeNeeded}
                  videoRef={activeVideoRef}
                  onReady={markStageReady}
                  onEnded={handleVideoEnded}
                  onBlocked={handleVideoBlocked}
                  onFailed={handleVideoFailed}
                  onProgress={setVideoFraction}
                  onSourceFailure={onMediaFailure}
                />
              ) : (
                <PlayerPhoto
                  key={current.id}
                  photo={current}
                  note={posterNote}
                  onReady={markStageReady}
                  onSourceFailure={onMediaFailure}
                />
              )
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* Safari declined to carry on with sound — one honest tap resumes. */}
        {state.status === "blocked" ? (
          <button
            type="button"
            onClick={handleContinueTap}
            className="absolute inset-0 z-10 grid place-items-center bg-black/55"
          >
            <span className="flex items-center gap-2.5 rounded-pill bg-white px-6 py-3.5 text-[17px] font-semibold text-black shadow-float">
              <Play size={18} fill="currentColor" aria-hidden="true" />
              Tap to continue
            </span>
          </button>
        ) : null}

        {/* No media code on this device: playback needs it, so say so. */}
        {codeNeeded && state.status !== "done" ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/70 p-6">
            <div className="flex max-w-[320px] flex-col items-center gap-3 text-center">
              <KeyRound size={26} aria-hidden="true" className="text-white/80" />
              <p className="text-[15px] leading-relaxed text-white/90">
                Enter your media access code once to play photos and videos on
                this device.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNeedMediaCode?.();
                }}
                className="pressable mt-1 min-h-[46px] rounded-pill bg-white px-6 text-[16px] font-semibold text-black"
              >
                Enter media code
              </button>
            </div>
          </div>
        ) : null}

        {/* The end of the show. */}
        {state.status === "done" ? (
          <motion.div
            className="absolute inset-0 z-10 grid place-items-center bg-black/85 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.3 }}
          >
            <div className="flex w-full max-w-[300px] flex-col items-center gap-2 text-center">
              <p className="text-[22px] font-bold tracking-[-0.02em] text-white">
                {completionLabel}
              </p>
              {subtitle ? <p className="text-[14px] text-white/65">{subtitle}</p> : null}
              <div className="mt-5 w-full space-y-2.5">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "replay" })}
                  className="pressable flex min-h-[50px] w-full items-center justify-center gap-2 rounded-md bg-white text-[16px] font-semibold text-black"
                >
                  <RotateCcw size={17} aria-hidden="true" />
                  Play Again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="pressable flex min-h-[50px] w-full items-center justify-center rounded-md bg-white/15 text-[16px] font-medium text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </div>

      {/* Top chrome: what is playing, and the ways out. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 via-black/35 to-transparent px-4 pb-10"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 14px)" }}
      >
        <div className="min-w-0 pt-1">
          <p className="truncate text-[16px] font-semibold text-white">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[12.5px] text-white/70">{subtitle}</p>
          ) : null}
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {fullscreenSupported ? (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
              className="pressable grid size-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md"
            >
              {isFullscreen ? (
                <Minimize size={18} aria-hidden="true" />
              ) : (
                <Maximize size={18} aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className="pressable grid size-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Bottom chrome: where you are, and the three controls. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-6 pt-12"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 18px)" }}
      >
        <div
          className="h-[3px] w-full overflow-hidden rounded-pill bg-white/20"
          role="progressbar"
          aria-label="Playlist progress"
          aria-valuemin={0}
          aria-valuemax={position.total}
          aria-valuenow={position.current}
        >
          <div
            className="h-full rounded-pill bg-white"
            style={{ width: `${Math.round(progress * 1000) / 10}%` }}
          />
        </div>

        <p className="mt-2.5 text-center text-[13px] font-medium tabular-nums text-white/85">
          {position.current} / {position.total}
        </p>

        <div className="pointer-events-auto mt-1 flex items-center justify-center gap-7">
          <button
            type="button"
            onClick={handlePrevious}
            aria-label="Previous"
            className="pressable grid size-12 place-items-center rounded-full text-white"
          >
            <SkipBack size={26} fill="currentColor" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleToggle}
            aria-label={playing ? "Pause" : "Play"}
            disabled={state.status === "done"}
            className="pressable grid size-[64px] place-items-center rounded-full bg-white text-black shadow-float disabled:opacity-40"
          >
            {playing ? (
              <Pause size={28} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={28} fill="currentColor" aria-hidden="true" className="ml-1" />
            )}
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next"
            className="pressable grid size-12 place-items-center rounded-full text-white"
          >
            <SkipForward size={26} fill="currentColor" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One photo (or a video's poster) on the stage: display rendition through
 * the cloud cache, letterboxed, with a skeleton while it loads and a retry
 * tile when it cannot. Calls `onReady` either way — a photo that failed
 * still gets its turn and then yields, so the playlist never freezes.
 */
function PlayerPhoto({
  photo,
  note,
  onReady,
  onSourceFailure,
}: {
  photo: TravelPhoto;
  /** "Too large to store" and friends — honest words over a poster. */
  note?: string | null;
  onReady: () => void;
  onSourceFailure: (reason: PhotoSourceError["reason"]) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

    void loadTravelPhotoBlob(photo, "display")
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setFailed(false);
        setUrl(objectUrl);
        onReady();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setFailed(true);
        onSourceFailure(error instanceof PhotoSourceError ? error.reason : "failed");
        onReady();
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `attempt` re-runs the load on retry.
  }, [photo, attempt, onReady, onSourceFailure]);

  if (failed) {
    return (
      <div className="grid size-full place-items-center">
        <button
          type="button"
          onClick={() => {
            setUrl(null);
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
          aria-label="This one couldn’t load — retry"
          className="pressable flex flex-col items-center gap-2 rounded-md p-6 text-white/70"
        >
          <RefreshCw size={22} aria-hidden="true" />
          <span className="text-[13px]">Couldn’t load — tap to retry</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative size-full">
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          className="size-full object-contain"
        />
      ) : (
        <span aria-hidden="true" className="skeleton absolute inset-0 opacity-40" />
      )}
      {note && url ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-32 mx-auto w-fit max-w-[86%] rounded-pill bg-black/60 px-3.5 py-1.5 text-center text-[12.5px] text-white backdrop-blur-sm">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One stored clip on the stage. The poster frame shows immediately from the
 * display rendition; the clip's own bytes come through the same cache every
 * photo uses, and only for the item on screen — never for the playlist. The
 * element is native <video>, inline for iPhone, with its audio as shot.
 */
function PlayerVideo({
  photo,
  playing,
  videoRef,
  onReady,
  onEnded,
  onBlocked,
  onFailed,
  onProgress,
  onSourceFailure,
}: {
  photo: TravelPhoto;
  playing: boolean;
  videoRef: { current: HTMLVideoElement | null };
  onReady: () => void;
  onEnded: () => void;
  onBlocked: () => void;
  onFailed: () => void;
  /** 0..1 through the clip, for the playlist progress bar. */
  onProgress: (fraction: number) => void;
  onSourceFailure: (reason: PhotoSourceError["reason"]) => void;
}) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);

  // The poster: the same display rendition the gallery viewer shows.
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    void loadTravelPhotoBlob(photo, "display")
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setPosterUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo]);

  // The clip itself. A failure here — offline, missing, over the script's
  // limits after all — downgrades this item to a timed poster, not a wall.
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    void loadTravelPhotoBlob(photo, "video")
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setClipUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        onSourceFailure(error instanceof PhotoSourceError ? error.reason : "failed");
        onFailed();
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, onFailed, onSourceFailure]);

  // Keep the element in step with the state machine, and hand the parent the
  // element itself so taps can call play() inside their own gesture. The
  // detach branch is the audio's off switch: a media element removed from
  // the DOM otherwise plays on until it is collected.
  const elementRef = useRef<HTMLVideoElement | null>(null);
  /** What the state machine currently believes, readable from a ref
   * callback — which runs outside any render that could hand it props. */
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const attemptPlay = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    const attempt = element.play();
    if (attempt) {
      attempt.catch((error: unknown) => {
        const name = error instanceof Error ? error.name : "";
        if (name === "AbortError") return;
        if (name === "NotAllowedError") onBlocked();
        else onFailed();
      });
    }
  }, [onBlocked, onFailed]);

  const setElement = useCallback(
    (element: HTMLVideoElement | null) => {
      if (element === null) elementRef.current?.pause();
      elementRef.current = element;
      videoRef.current = element;
      // React's dev-mode ref cycle detaches and immediately re-attaches the
      // same element — and the pause above has then just aborted the play()
      // the effect already issued, with nothing left to retry it. Treat
      // every attach as that retry: a clip the show believes is playing but
      // that sits paused is asked again, and a refusal still lands in the
      // usual Tap-to-continue path rather than a silent freeze.
      if (element && playingRef.current && element.paused && !element.ended) {
        attemptPlay();
      }
    },
    [videoRef, attemptPlay],
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !clipUrl) return;
    if (playing) attemptPlay();
    else element.pause();
  }, [playing, clipUrl, attemptPlay]);

  // Backgrounding the tab makes the browser pause the element on its own,
  // which the state machine cannot see. Coming back, a clip that should be
  // playing is nudged awake — and if Safari wants a fresh gesture for the
  // audio, that becomes the Tap to continue rather than a silent freeze.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const element = elementRef.current;
      if (playing && clipUrl && element && element.paused && !element.ended) {
        attemptPlay();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [playing, clipUrl, attemptPlay]);

  return (
    <div className="relative size-full">
      {posterUrl && !clipUrl ? (
        <img src={posterUrl} alt="" draggable={false} className="size-full object-contain" />
      ) : null}
      {clipUrl ? (
        <video
          ref={setElement}
          src={clipUrl}
          poster={posterUrl ?? undefined}
          playsInline
          preload="metadata"
          className="size-full object-contain"
          onLoadedMetadata={onReady}
          onEnded={onEnded}
          onError={onFailed}
          onTimeUpdate={(event) => {
            const element = event.currentTarget;
            if (Number.isFinite(element.duration) && element.duration > 0) {
              onProgress(element.currentTime / element.duration);
            }
          }}
        />
      ) : null}
      {!clipUrl ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-32 mx-auto w-fit rounded-pill bg-black/60 px-3.5 py-1.5 text-[12.5px] text-white backdrop-blur-sm">
          Loading video…
        </span>
      ) : null}
    </div>
  );
}
