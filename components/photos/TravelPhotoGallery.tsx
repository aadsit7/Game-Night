"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ImagePlus, KeyRound, Play, RefreshCw, Trash2, X } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PhotoSourceError, loadTravelPhotoBlob } from "@/lib/photos/photoSource";
import { isVideoTravelPhoto } from "@/lib/photos/travelPhotos";
import { cn } from "@/lib/utils/cn";
import type { TravelPhoto, TravelPhotoSize } from "@/types/travelPhoto";

/**
 * The one gallery. Place visits, residence periods and trips all render
 * exactly this — a horizontal strip of thumbnails, a full-screen swipeable
 * viewer, and an optional Add tile — so a photo looks and behaves the same
 * wherever it was attached.
 *
 * Bytes load lazily through the cloud photo cache: a thumb is fetched when
 * its tile scrolls near, the display rendition only when the viewer opens.
 */
export function TravelPhotoGallery({
  photos,
  onAddPhotos,
  addLabel = "Add photos",
  onRemovePhoto,
  onNeedMediaCode,
  size = "md",
  emptyHint,
  bleed = true,
}: {
  photos: TravelPhoto[];
  /** Renders the Add tile — the optional entry point, never a gate. */
  onAddPhotos?: () => void;
  addLabel?: string;
  /** Present when photos may be removed from the viewer. */
  onRemovePhoto?: (photo: TravelPhoto) => Promise<void> | void;
  /** Called when bytes can’t load because this device has no media code. */
  onNeedMediaCode?: () => void;
  /** md for visit rows, lg for trip/all-photos strips. */
  size?: "md" | "lg";
  /** Shown when there are no photos and no Add tile. */
  emptyHint?: string;
  /** Full-bleed scrolling past the sheet's padding. Off inside cards. */
  bleed?: boolean;
}) {
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<TravelPhoto | null>(null);
  const [removing, setRemoving] = useState(false);
  const [codeMissing, setCodeMissing] = useState(false);

  const tile = size === "lg" ? "size-[112px] rounded-[16px]" : "size-[86px] rounded-[14px]";

  const onImageFailure = useCallback(
    (reason: PhotoSourceError["reason"]) => {
      if (reason === "code-missing" || reason === "code-rejected") setCodeMissing(true);
    },
    [],
  );

  if (photos.length === 0 && !onAddPhotos) {
    return emptyHint ? <p className="text-[13.5px] text-ink-3">{emptyHint}</p> : null;
  }

  return (
    <>
      <div
        className={cn(
          "flex gap-2.5 overflow-x-auto scrollbar-none pb-1",
          bleed && "-mx-5 px-5",
        )}
      >
        {codeMissing && photos.length > 0 ? (
          <button
            type="button"
            onClick={onNeedMediaCode}
            className={cn(
              "pressable flex shrink-0 flex-col items-center justify-center gap-1.5 border border-dashed border-separator bg-fill/50 px-3 text-ink-2",
              tile,
            )}
          >
            <KeyRound size={18} aria-hidden="true" />
            <span className="text-center text-[11px] font-medium leading-tight">
              Enter media code to view
            </span>
          </button>
        ) : (
          photos.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setViewerAt(index)}
              aria-label={`View ${isVideoTravelPhoto(photo) ? "video" : "photo"} ${index + 1} of ${photos.length}`}
              className={cn("pressable relative shrink-0 overflow-hidden bg-fill", tile)}
            >
              <CloudImage photo={photo} size="thumb" onFailure={onImageFailure} />
              {isVideoTravelPhoto(photo) ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
                >
                  <Play size={11} fill="currentColor" />
                </span>
              ) : null}
            </button>
          ))
        )}

        {onAddPhotos ? (
          <button
            type="button"
            onClick={onAddPhotos}
            className={cn(
              "pressable flex shrink-0 flex-col items-center justify-center gap-1",
              "border border-dashed border-separator bg-fill/50 text-ink-2",
              tile,
            )}
          >
            <ImagePlus size={18} aria-hidden="true" />
            <span className="text-[11px] font-medium">{photos.length === 0 ? addLabel : "Add"}</span>
          </button>
        ) : null}
      </div>

      <PhotoViewer
        photos={photos}
        at={viewerAt}
        onClose={() => setViewerAt(null)}
        onStep={(next) => setViewerAt(next)}
        onRemove={onRemovePhoto ? (photo) => setConfirmRemove(photo) : undefined}
        onFailure={onImageFailure}
      />

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title="Remove this photo?"
        message="It disappears from every device. The original in Google Photos is untouched."
        confirmLabel={removing ? "Removing…" : "Remove"}
        destructive
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          const photo = confirmRemove;
          if (!photo || !onRemovePhoto) return;
          setRemoving(true);
          void Promise.resolve(onRemovePhoto(photo))
            .then(() => {
              setConfirmRemove(null);
              setViewerAt(null);
            })
            // The caller already toasts the failure; the dialog stays open.
            .catch(() => undefined)
            .finally(() => setRemoving(false));
        }}
      />
    </>
  );
}

/**
 * Full-screen viewer: one photo at a time, swipe (scroll-snap) left and
 * right, close, and remove. Display renditions load only here.
 */
function PhotoViewer({
  photos,
  at,
  onClose,
  onStep,
  onRemove,
  onFailure,
}: {
  photos: TravelPhoto[];
  at: number | null;
  onClose: () => void;
  onStep: (index: number) => void;
  onRemove?: (photo: TravelPhoto) => void;
  onFailure: (reason: PhotoSourceError["reason"]) => void;
}) {
  const reduceMotion = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const open = at !== null && at >= 0 && at < photos.length;

  // Snap to the tapped photo the moment the strip exists.
  useEffect(() => {
    if (!open || at === null) return;
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTo({ left: at * scroller.clientWidth, behavior: "auto" });
    // Only on open: while swiping, the scroll position is the truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientWidth === 0) return;
    const index = Math.round(scroller.scrollLeft / scroller.clientWidth);
    if (at !== null && index !== at && index >= 0 && index < photos.length) onStep(index);
  }, [at, photos.length, onStep]);

  const current = at !== null ? photos[at] : undefined;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[95] bg-black/95"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          role="dialog"
          aria-label="Photo viewer"
        >
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            className="flex h-full snap-x snap-mandatory overflow-x-auto scrollbar-none"
          >
            {photos.map((photo, index) => (
              <div
                key={photo.id}
                className="grid h-full w-screen shrink-0 snap-center place-items-center p-4"
              >
                <div className="relative max-h-[82dvh] w-full max-w-[720px]">
                  {isVideoTravelPhoto(photo) ? (
                    // Only the slide on screen mounts its <video>: a strip of
                    // players would fetch every clip at once.
                    at === index ? (
                      <CloudVideo photo={photo} onFailure={onFailure} />
                    ) : (
                      <CloudImage photo={photo} size="display" contain onFailure={onFailure} />
                    )
                  ) : (
                    <CloudImage photo={photo} size="display" contain onFailure={onFailure} />
                  )}
                </div>
              </div>
            ))}
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 flex items-center justify-between px-4"
            style={{ top: "max(env(safe-area-inset-top, 0px), 16px)" }}
          >
            <span className="rounded-pill bg-white/12 px-3 py-1 text-[13px] font-medium tabular-nums text-white backdrop-blur-md">
              {(at ?? 0) + 1} of {photos.length}
            </span>
            <div className="pointer-events-auto flex items-center gap-2">
              {onRemove && current ? (
                <button
                  type="button"
                  onClick={() => onRemove(current)}
                  aria-label="Remove photo"
                  className="pressable grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md"
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close photos"
                className="pressable grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * A stored video, played in place. The poster shows immediately from the
 * display rendition; the clip's own bytes stream in behind it. A video whose
 * full clip could not be stored (too large for the script to move) keeps its
 * poster and says so instead of pretending.
 */
function CloudVideo({
  photo,
  onFailure,
}: {
  photo: TravelPhoto;
  onFailure: (reason: PhotoSourceError["reason"]) => void;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Derived, not effect-set: a clip that was never stored is knowable from
  // the metadata alone.
  const missingClip = !photo.videoDriveFileId;

  useEffect(() => {
    if (missingClip) return;
    let disposed = false;
    let objectUrl: string | null = null;

    void loadTravelPhotoBlob(photo, "video")
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setVideoUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const reason = error instanceof PhotoSourceError ? error.reason : "failed";
        setNote(
          error instanceof PhotoSourceError && reason !== "failed"
            ? error.message
            : "The video couldn’t be loaded — showing its preview frame.",
        );
        onFailure(reason);
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, onFailure, missingClip]);

  if (videoUrl) {
    return (
      <video
        src={videoUrl}
        controls
        playsInline
        autoPlay
        className="max-h-[82dvh] w-full rounded-[8px] object-contain"
      />
    );
  }

  return (
    <div className="relative">
      <CloudImage photo={photo} size="display" contain onFailure={onFailure} />
      <span className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[90%] rounded-pill bg-black/60 px-3 py-1.5 text-center text-[12.5px] text-white backdrop-blur-sm">
        {note ??
          (missingClip
            ? "The full video was too large to store — this is its preview frame."
            : "Loading video…")}
      </span>
    </div>
  );
}

/**
 * One cloud image: cache → script → object URL, with a skeleton while it
 * loads and an honest retry tile when it cannot.
 */
function CloudImage({
  photo,
  size,
  contain,
  onFailure,
}: {
  photo: TravelPhoto;
  size: TravelPhotoSize;
  /** Viewer images letterbox; strip thumbs fill their square. */
  contain?: boolean;
  onFailure?: (reason: PhotoSourceError["reason"]) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<PhotoSourceError["reason"] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

    void loadTravelPhotoBlob(photo, size)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setFailed(null);
        setUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const reason = error instanceof PhotoSourceError ? error.reason : "failed";
        setFailed(reason);
        onFailure?.(reason);
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `attempt` re-runs the load on retry; the photo's version covers edits.
  }, [photo.id, photo.updatedAt, size, attempt, onFailure, photo]);

  if (failed) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setUrl(null);
          setFailed(null);
          setAttempt((n) => n + 1);
        }}
        aria-label="Photo failed to load — retry"
        className="absolute inset-0 grid place-items-center bg-fill text-ink-3"
      >
        <RefreshCw size={16} aria-hidden="true" />
      </button>
    );
  }

  if (!url) {
    return <span aria-hidden="true" className="skeleton absolute inset-0" />;
  }

  return contain ? (
    <img src={url} alt="" draggable={false} className="max-h-[82dvh] w-full object-contain" />
  ) : (
    <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
  );
}
