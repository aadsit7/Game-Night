"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";

import { ActionSheet } from "@/components/ui/ActionSheet";
import { classifyPickedFile } from "@/lib/photos/deviceMedia";
import {
  PhotoStoreError,
  isLocalPhotoRef,
  resolvePhotoUrl,
  savePhoto,
} from "@/lib/storage/photoStore";
import { cn } from "@/lib/utils/cn";

/**
 * Optional photography for a place. The first photo is the cover; the rest sit
 * behind it on the detail screen. Files are downscaled and stored as blobs in
 * IndexedDB rather than inflating the place record.
 *
 * With `onVideos` present the same picker takes videos too — the system
 * dialog stops greying them out — and hands them up whole: a video is not a
 * cover image, it is a memory, and the caller files it into the place's own
 * gallery where the player can reach it.
 */
export function PhotoPicker({
  photos,
  onChange,
  onError,
  onVideos,
  pendingVideoCount = 0,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  onError: (message: string) => void;
  /** Present when the deployment can store device videos in Travel_Photos. */
  onVideos?: (files: File[]) => void;
  /** Videos waiting for this place to be saved, shown as a note. */
  pendingVideoCount?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const images: File[] = [];
      const videos: File[] = [];
      let unsupported = 0;
      for (const file of Array.from(files)) {
        const kind = classifyPickedFile(file.name, file.type);
        if (kind === "video" && onVideos) videos.push(file);
        else if (kind === "photo" || kind === "video") images.push(file);
        else unsupported += 1;
      }
      if (unsupported > 0) {
        onError(
          unsupported === 1
            ? "One file wasn’t a photo or a video, so it was left out."
            : `${unsupported} files weren’t photos or videos, so they were left out.`,
        );
      }

      const saved: string[] = [];
      for (const file of images.slice(0, 8)) {
        try {
          saved.push(await savePhoto(file));
        } catch (error) {
          onError(
            error instanceof PhotoStoreError
              ? error.message
              : "That photo couldn’t be added.",
          );
        }
      }
      if (saved.length > 0) onChange([...photos, ...saved]);
      if (videos.length > 0) onVideos?.(videos);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1">
        {photos.map((photo, index) => (
          <button
            key={`${photo}-${index}`}
            type="button"
            onClick={() => setMenuFor(index)}
            aria-label={
              index === 0 ? "Cover photo options" : `Photo ${index + 1} options`
            }
            className="pressable relative size-[86px] shrink-0 overflow-hidden rounded-[16px] bg-fill"
          >
            <Thumb key={photo} photoRef={photo} />
            {index === 0 ? (
              <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/55 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
                Cover
              </span>
            ) : null}
          </button>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={cn(
            "pressable grid size-[86px] shrink-0 place-items-center gap-1 rounded-[16px]",
            "border border-dashed border-separator bg-fill/50 text-ink-2",
            "disabled:opacity-60",
          )}
        >
          {busy ? (
            <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus size={20} aria-hidden="true" />
          )}
          <span className="text-[11px] font-medium">
            {busy ? "Adding" : photos.length === 0 ? "Add photo" : "Add"}
          </span>
        </button>
      </div>

      {pendingVideoCount > 0 ? (
        <p className="mt-2 text-[12.5px] leading-snug text-ink-3">
          {pendingVideoCount === 1
            ? "1 video will join this place’s memories when you save."
            : `${pendingVideoCount} videos will join this place’s memories when you save.`}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        // Videos are only offered when someone is there to catch them —
        // otherwise the system picker greys them out, honestly.
        accept={onVideos ? "image/*,video/*" : "image/*"}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <ActionSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor === 0 ? "Cover photo" : "Photo"}
        actions={[
          ...(menuFor !== null && menuFor > 0
            ? [
                {
                  label: "Make cover photo",
                  onSelect: () => {
                    if (menuFor === null) return;
                    const next = [...photos];
                    const [moved] = next.splice(menuFor, 1);
                    onChange([moved, ...next]);
                  },
                },
              ]
            : []),
          {
            label: "Remove photo",
            destructive: true,
            onSelect: () => {
              if (menuFor === null) return;
              onChange(photos.filter((_, index) => index !== menuFor));
            },
          },
        ]}
      />
    </div>
  );
}

/** Mounted with `key={photoRef}`, so a changed reference remounts it clean. */
function Thumb({ photoRef }: { photoRef: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const url = isLocalPhotoRef(photoRef) ? resolved : photoRef;

  useEffect(() => {
    if (!isLocalPhotoRef(photoRef)) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    void resolvePhotoUrl(photoRef).then((next) => {
      if (cancelled) {
        if (next) URL.revokeObjectURL(next);
        return;
      }
      if (next) {
        objectUrl = next;
        setResolved(next);
      } else {
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoRef]);

  if (failed || !url) {
    return <span aria-hidden="true" className="skeleton absolute inset-0" />;
  }

  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
