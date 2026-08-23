"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { CircleAlert } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import {
  DEVICE_MEDIA_BATCH_LIMIT,
  DeviceMediaError,
  prepareDeviceMedia,
} from "@/lib/photos/deviceMedia";
import { isLocalId } from "@/lib/sheets/queue";
import { usePlaces } from "@/lib/store/PlacesProvider";

/**
 * The "from this device" way into Travel_Photos: one hidden file input that
 * accepts photos and videos alike, and one small progress sheet while each
 * file is rendered down and uploaded. Where the Google Photos flow ends in
 * the same place after a picking session, this starts from a file the
 * person already has — in the photo library, the Files app, a Drive folder.
 *
 * The input is clicked inside the caller's own tap (the browser's rule for
 * opening a picker); everything slow happens after files are in hand.
 */

export type DeviceMediaTarget = {
  /** "Kyoto" or "Japan 2026" — the heading over the progress sheet. */
  title: string;
  /**
   * The association, resolved only once files are actually in hand — for a
   * visit this is the moment the implicit visit is written down for real.
   * Ids may still be local; the intake waits for the sheet to name them.
   */
  resolve: () => Promise<{ placeId?: string; visitId?: string; tripId?: string }>;
};

export type DeviceMediaIntakeHandle = {
  /** Opens the system file picker. Must be called inside a user gesture. */
  open: (target: DeviceMediaTarget) => void;
  /** Runs files picked elsewhere (the place form) through the same intake. */
  addFiles: (target: DeviceMediaTarget, files: File[]) => void;
};

type Job = {
  title: string;
  total: number;
  done: number;
  added: number;
  duplicates: number;
  /** Videos whose clip was too large — stored as their poster frame. */
  posterOnly: number;
  failures: string[];
  finished: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the toast says when everything (or everything but a note) went in. */
function summarize(job: Job): string {
  const parts: string[] = [];
  if (job.added > 0) parts.push(job.added === 1 ? "1 item added" : `${job.added} items added`);
  if (job.duplicates > 0) parts.push(`${job.duplicates} already added`);
  if (job.posterOnly > 0) {
    parts.push(
      job.posterOnly === 1
        ? "1 video was too large to store whole — added as its preview frame"
        : `${job.posterOnly} videos were too large to store whole — added as preview frames`,
    );
  }
  return parts.join(" · ") || "Nothing was added";
}

export function DeviceMediaIntake({
  handleRef,
  onToast,
}: {
  handleRef: MutableRefObject<DeviceMediaIntakeHandle | null>;
  onToast: (message: string, options?: { tone?: "neutral" | "error" }) => void;
}) {
  const { addDeviceMedia, resolveTripId } = usePlaces();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<DeviceMediaTarget | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const runningRef = useRef(false);

  /**
   * A create still travelling to the sheet holds a local id; the script
   * cannot attach media to an id it has never heard of. Waiting a few
   * seconds covers the ordinary case — the row's write is already in the
   * queue — and the timeout keeps a dead network from waiting forever.
   */
  const settled = useCallback(
    async (id: string | undefined, what: string): Promise<string | undefined> => {
      if (!id) return undefined;
      const deadline = Date.now() + 45_000;
      let current = resolveTripId(id);
      while (isLocalId(current) && Date.now() < deadline) {
        await sleep(1500);
        current = resolveTripId(id);
      }
      if (isLocalId(current)) {
        throw new DeviceMediaError(
          `That ${what} hasn’t reached the sheet yet. Give it a moment to sync, then try again.`,
        );
      }
      return current;
    },
    [resolveTripId],
  );

  const runJob = useCallback(
    async (target: DeviceMediaTarget, files: File[]) => {
      if (runningRef.current) {
        onToast("Media is still being added — give it a moment to finish.", { tone: "error" });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        onToast("Adding photos and videos needs a connection. Try again when you’re back online.", {
          tone: "error",
        });
        return;
      }

      const batch = files.slice(0, DEVICE_MEDIA_BATCH_LIMIT);
      const overflow = files.length - batch.length;

      runningRef.current = true;
      const state: Job = {
        title: target.title,
        total: batch.length,
        done: 0,
        added: 0,
        duplicates: 0,
        posterOnly: 0,
        failures:
          overflow > 0
            ? [`Only ${DEVICE_MEDIA_BATCH_LIMIT} files go in at once — ${overflow} left for a second round.`]
            : [],
        finished: false,
      };
      setJob({ ...state });

      try {
        const raw = await target.resolve();
        const association = {
          placeId: await settled(raw.placeId, "place"),
          visitId: await settled(raw.visitId, "visit"),
          tripId: await settled(raw.tripId, "trip"),
        };

        for (const file of batch) {
          try {
            const media = await prepareDeviceMedia(file);
            const result = await addDeviceMedia({ ...association, media });
            if (result.status === "duplicate") state.duplicates += 1;
            else state.added += 1;
            if (media.kind === "video" && media.clipTooLarge && result.status === "imported") {
              state.posterOnly += 1;
            }
          } catch (error) {
            state.failures.push(
              error instanceof Error && error.message ? error.message : `“${file.name}” couldn’t be added.`,
            );
          }
          state.done += 1;
          setJob({ ...state });
        }
      } catch (error) {
        // The association itself failed — nothing was uploaded.
        state.failures.push(
          error instanceof Error && error.message
            ? error.message
            : "Those files couldn’t be attached.",
        );
      } finally {
        runningRef.current = false;
        state.finished = true;
        if (state.failures.length === 0) {
          // A clean finish needs no second screen; the toast is the receipt.
          setJob(null);
          onToast(summarize(state));
        } else {
          setJob({ ...state });
        }
      }
    },
    [addDeviceMedia, onToast, settled],
  );

  const open = useCallback((target: DeviceMediaTarget) => {
    targetRef.current = target;
    inputRef.current?.click();
  }, []);

  const addFiles = useCallback(
    (target: DeviceMediaTarget, files: File[]) => {
      if (files.length === 0) return;
      void runJob(target, files);
    },
    [runJob],
  );

  useEffect(() => {
    handleRef.current = { open, addFiles };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, open, addFiles]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          const target = targetRef.current;
          targetRef.current = null;
          if (target && files.length > 0) void runJob(target, files);
        }}
      />

      <BottomSheet
        open={Boolean(job)}
        onClose={() => setJob(null)}
        // Mid-upload there is nothing sensible "close" could mean — the
        // request in flight would finish anyway, half-reported.
        onRequestClose={() => job?.finished === true}
        label={`Adding media — ${job?.title ?? ""}`}
        header={
          <div className="pb-2 pt-1">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
              Adding to {job?.title ?? "…"}
            </h2>
          </div>
        }
      >
        {job ? (
          <div className="space-y-4 pb-6 pt-1">
            {!job.finished ? (
              <>
                <p className="text-center text-[15px] tabular-nums text-ink">
                  Adding {Math.min(job.done + 1, job.total)} of {job.total}…
                </p>
                <div className="h-2 overflow-hidden rounded-pill bg-fill">
                  <div
                    className="h-full rounded-pill bg-accent transition-[width] duration-300"
                    style={{
                      width: `${job.total > 0 ? Math.round((job.done / job.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p className="text-center text-[13px] text-ink-3">
                  Videos travel whole, so this can take a moment on a slow connection.
                </p>
              </>
            ) : (
              <>
                <p className="text-[15px] text-ink">{summarize(job)}.</p>
                <ul className="space-y-2">
                  {job.failures.map((failure, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-2 rounded-sm bg-danger-soft px-3.5 py-2.5 text-[14px] leading-snug text-danger"
                    >
                      <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                      {failure}
                    </li>
                  ))}
                </ul>
                <Button block variant="secondary" onClick={() => setJob(null)}>
                  Close
                </Button>
              </>
            )}
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
