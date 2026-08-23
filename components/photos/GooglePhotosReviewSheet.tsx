"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  ExternalLink,
  ImageDown,
  Images,
  Loader2,
  RefreshCw,
  Video,
} from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import {
  reviewCounts,
  reviewSelection,
  suggestVisitForPhoto,
  takenOnDate,
  type ReviewedMedia,
} from "@/lib/photos/travelPhotos";
import {
  useGooglePhotosPicker,
  type ImportGroup,
  type ImportTally,
} from "@/lib/photos/useGooglePhotosPicker";
import { getPickedPhotoPreview } from "@/lib/sheets/sheetsClient";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import { usePlaces } from "@/lib/store/PlacesProvider";
import { formatVisitRange } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { GooglePickedMedia, PhotoContext } from "@/types/travelPhoto";

/**
 * The whole Add Photos journey, in one sheet: connect if needed, wait while
 * the picker is open, review what came back against the visit's dates, then
 * import in small batches with honest progress and honest partial failure.
 *
 * The context — which visit, which trip, which dates — rides through every
 * step, which is what guarantees a selection can never land on the wrong
 * stay.
 */
export function GooglePhotosFlowSheet({
  open,
  depth,
  context,
  onClose,
  onToast,
}: {
  open: boolean;
  depth?: number;
  context: PhotoContext | null;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const { visits, getPlace } = usePlaces();
  const flow = useGooglePhotosPicker();
  const { state, start, cancel } = flow;

  // Start once per opening; cancel (session, window, timers) on close.
  const startedRef = useRef(false);
  useEffect(() => {
    if (open && context && !startedRef.current) {
      startedRef.current = true;
      void start(context);
    }
    if (!open && startedRef.current) {
      startedRef.current = false;
      cancel();
    }
  }, [open, context, start, cancel]);

  const finish = useCallback(() => {
    if (state.step === "done" && state.tally.imported > 0) {
      onToast(
        state.tally.imported === 1 ? "1 photo added" : `${state.tally.imported} photos added`,
      );
    }
    onClose();
  }, [state, onToast, onClose]);

  /** Trip imports file each photo under the visit its date pins down. */
  const buildGroups = useCallback(
    (selected: GooglePickedMedia[]): ImportGroup[] => {
      if (!context) return [];
      if (context.kind === "visit" || !context.tripId) {
        return [
          {
            items: selected,
            placeId: context.placeId,
            visitId: context.visitId,
            tripId: context.tripId,
          },
        ];
      }

      const tripVisits = visits.filter(
        (visit) => visit.tripId === context.tripId && !visit.deletedAt,
      );
      const groups = new Map<string, ImportGroup>();
      for (const item of selected) {
        const match = suggestVisitForPhoto(item, tripVisits);
        const key = match?.id ?? "";
        const group =
          groups.get(key) ??
          (match
            ? { items: [], placeId: match.placeId, visitId: match.id, tripId: context.tripId }
            : { items: [], tripId: context.tripId });
        group.items.push(item);
        groups.set(key, group);
      }
      return [...groups.values()];
    },
    [context, visits],
  );

  const title = context?.title ?? "Add photos";
  const subtitle = context?.subtitle ?? formatVisitRange(context?.startDate, context?.endDate);

  return (
    <BottomSheet
      open={open && Boolean(context)}
      onClose={finish}
      depth={depth}
      label={`Add photos — ${title}`}
      header={
        <div className="flex items-center justify-between gap-3 pb-2 pt-1">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
              Add photos — {title}
            </h2>
            {subtitle ? (
              <p className="truncate text-[13.5px] tabular-nums text-ink-2">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={finish}
            data-autofocus
            className="pressable -mr-1 shrink-0 rounded-pill px-2 py-1 text-[16px] font-medium text-accent"
          >
            {state.step === "done" ? "Done" : "Cancel"}
          </button>
        </div>
      }
    >
      {context ? <FlowBody flow={flow} context={context} buildGroups={buildGroups} getPlaceName={(id) => getPlace(id)?.name} onFinish={finish} /> : null}
    </BottomSheet>
  );
}

function FlowBody({
  flow,
  context,
  buildGroups,
  getPlaceName,
  onFinish,
}: {
  flow: ReturnType<typeof useGooglePhotosPicker>;
  context: PhotoContext;
  buildGroups: (selected: GooglePickedMedia[]) => ImportGroup[];
  getPlaceName: (id: string | undefined) => string | undefined;
  onFinish: () => void;
}) {
  const { state } = flow;

  switch (state.step) {
    case "idle":
    case "starting":
      return <Waiting text="Opening Google Photos…" />;

    case "connect":
      return (
        <div className="space-y-4 pb-4">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Connect Google Photos once, and the app can open the picker from any of your devices
            without asking again. Viewing photos you’ve already imported never needs this.
          </p>
          {state.message ? (
            <p className="rounded-sm bg-fill px-3.5 py-2.5 text-[14px] text-ink-2">{state.message}</p>
          ) : null}
          <Button block size="lg" loading={state.busy} onClick={() => void flow.connect()}>
            Connect Google Photos
          </Button>
          <Button
            block
            variant="secondary"
            onClick={() => void flow.continueAfterConnect()}
          >
            I’ve connected — continue
          </Button>
        </div>
      );

    case "picking":
      return (
        <div className="space-y-4 pb-4">
          <p className="text-[15px] leading-relaxed text-ink-2">
            {state.windowOpen
              ? "Choose photos in the Google Photos window, tap Done there, then come back here."
              : "Open Google Photos below, choose your photos, tap Done there, then come back here."}
          </p>
          {!state.windowOpen ? (
            <a
              href={state.pickerUri}
              target="_blank"
              rel="noreferrer"
              onClick={flow.markWindowOpened}
              className="pressable flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-accent text-[17px] font-semibold text-on-accent"
            >
              <ExternalLink size={18} aria-hidden="true" />
              Choose photos in Google Photos
            </a>
          ) : (
            <Waiting text="Waiting for your selection…" />
          )}
          <Button block variant="secondary" onClick={() => void flow.finishedSelecting()}>
            I’ve finished selecting
          </Button>
        </div>
      );

    case "loading":
      return <Waiting text="Reading your selection…" />;

    case "review":
      return (
        <ReviewStep
          items={state.items}
          context={context}
          sessionId={flow.sessionId}
          getPlaceName={getPlaceName}
          onImport={(selected) => flow.confirmImport(buildGroups(selected))}
        />
      );

    case "importing":
      return <ImportingStep tally={state.tally} />;

    case "done":
      return <DoneStep tally={state.tally} onRetry={flow.retryFailed} onFinish={onFinish} />;

    case "error":
      return (
        <div className="space-y-4 pb-4">
          <p className="flex items-start gap-2 rounded-sm bg-danger-soft px-3.5 py-2.5 text-[15px] text-danger">
            <CircleAlert size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
            {state.message}
          </p>
          <Button block variant="secondary" onClick={onFinish}>
            Close
          </Button>
        </div>
      );
  }
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-ink-2">
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      <span className="text-[15px]">{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Review — the date-aware confirmation
 * ------------------------------------------------------------------ */

function ReviewStep({
  items,
  context,
  sessionId,
  getPlaceName,
  onImport,
}: {
  items: GooglePickedMedia[];
  context: PhotoContext;
  sessionId: string | null;
  getPlaceName: (id: string | undefined) => string | undefined;
  onImport: (selected: GooglePickedMedia[]) => void;
}) {
  const { visits, travelPhotos } = usePlaces();

  const reviewed = useMemo(
    () => reviewSelection(items, context, travelPhotos),
    [items, context, travelPhotos],
  );
  const counts = useMemo(() => reviewCounts(reviewed), [reviewed]);

  const tripVisits = useMemo(
    () =>
      context.kind === "trip" && context.tripId
        ? visits.filter((visit) => visit.tripId === context.tripId && !visit.deletedAt)
        : [],
    [context, visits],
  );

  // Everything importable starts selected — including outside-date photos,
  // which are flagged, never discarded, and videos, which import with their
  // poster frames. Only a same-context duplicate cannot be selected; the
  // import would just skip it again.
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
  const selectable = useCallback(
    (entry: ReviewedMedia) => entry.duplicate !== "sameContext",
    [],
  );
  const selected = reviewed.filter(
    (entry) => selectable(entry) && !deselected.has(entry.media.id),
  );

  const toggle = useCallback((id: string) => {
    setDeselected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rangeLabel = formatVisitRange(context.startDate, context.endDate);

  return (
    <div className="pb-4">
      <p className="text-[15px] text-ink">
        {items.length === 1 ? "1 photo selected" : `${items.length} photos selected`}
      </p>
      {rangeLabel ? (
        <p className="mt-0.5 text-[13.5px] text-ink-2">
          {counts.within} within {rangeLabel}
          {counts.outside > 0 ? ` · ${counts.outside} outside` : ""}
          {counts.duplicates > 0 ? ` · ${counts.duplicates} already added` : ""}
          {counts.videos > 0 ? ` · ${counts.videos} video${counts.videos === 1 ? "" : "s"}` : ""}
        </p>
      ) : null}

      <ul className="mt-4 space-y-1.5">
        {reviewed.map((entry) => (
          <ReviewRow
            key={entry.media.id}
            entry={entry}
            sessionId={sessionId}
            checked={selectable(entry) && !deselected.has(entry.media.id)}
            disabled={!selectable(entry)}
            onToggle={() => toggle(entry.media.id)}
            suggestion={
              context.kind === "trip"
                ? (() => {
                    const match = suggestVisitForPhoto(entry.media, tripVisits);
                    if (!match) return undefined;
                    const name = getPlaceName(match.placeId);
                    const range = formatVisitRange(match.startDate, match.endDate);
                    return name ? `${name}${range ? ` — ${range}` : ""}` : undefined;
                  })()
                : undefined
            }
          />
        ))}
      </ul>

      <div className="sticky bottom-0 -mx-5 mt-4 bg-bg/92 px-5 pb-1 pt-3 backdrop-blur-xl">
        <Button
          block
          size="lg"
          disabled={selected.length === 0}
          onClick={() => onImport(selected.map((entry) => entry.media))}
          icon={<ImageDown size={18} aria-hidden="true" />}
        >
          {selected.length === 0
            ? "Nothing selected"
            : selected.length === 1
              ? "Import 1 photo"
              : `Import ${selected.length} photos`}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({
  entry,
  sessionId,
  checked,
  disabled,
  onToggle,
  suggestion,
}: {
  entry: ReviewedMedia;
  sessionId: string | null;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** "Salt Lake City — Feb 7–10, 2024", when a trip photo pins its visit. */
  suggestion?: string;
}) {
  const taken = takenOnDate(entry.media.createTime);
  const flag =
    entry.duplicate === "sameContext"
      ? { label: "Already added", tone: "muted" as const }
      : !entry.withinDates
        ? { label: "Outside trip dates", tone: "warn" as const }
        : entry.duplicate === "elsewhere"
          ? { label: "Also in another gallery", tone: "muted" as const }
          : entry.isVideo
            ? { label: "Video", tone: "muted" as const }
            : null;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={checked}
        className={cn(
          "flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors",
          checked ? "bg-fill/60" : "bg-transparent",
          disabled ? "opacity-55" : "active:bg-fill-strong",
        )}
      >
        <span className="relative size-[56px] shrink-0 overflow-hidden rounded-[12px] bg-fill">
          <PreviewThumb itemId={entry.media.id} sessionId={sessionId} isVideo={entry.isVideo} />
          {!disabled ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute right-1 top-1 grid size-[18px] place-items-center rounded-full border",
                checked
                  ? "border-accent bg-accent text-on-accent"
                  : "border-white/80 bg-black/25 text-transparent",
              )}
            >
              <Check size={12} strokeWidth={3} />
            </span>
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] tabular-nums text-ink">
            {taken ? formatVisitRange(taken) : (entry.media.filename ?? "No date")}
          </span>
          {flag ? (
            <span
              className={cn(
                "mt-0.5 inline-flex items-center gap-1 rounded-pill px-2 py-[2px] text-[12px] font-medium",
                flag.tone === "warn" ? "bg-danger-soft text-danger" : "bg-fill text-ink-3",
              )}
            >
              {entry.isVideo ? <Video size={11} aria-hidden="true" /> : null}
              {flag.label}
            </span>
          ) : suggestion ? (
            <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{suggestion}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Review previews — proxied bytes, bounded concurrency, session-scoped
 * ------------------------------------------------------------------ */

const previewCache = new Map<string, string>();
let previewActive = 0;
const previewQueue: Array<() => void> = [];

async function previewSlot<T>(work: () => Promise<T>): Promise<T> {
  if (previewActive >= 4) await new Promise<void>((resolve) => previewQueue.push(resolve));
  previewActive += 1;
  try {
    return await work();
  } finally {
    previewActive -= 1;
    previewQueue.shift()?.();
  }
}

function PreviewThumb({
  itemId,
  sessionId,
  isVideo,
}: {
  itemId: string;
  sessionId: string | null;
  isVideo: boolean;
}) {
  const [url, setUrl] = useState<string | null>(previewCache.get(itemId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url || failed || !sessionId) return;
    let disposed = false;

    void previewSlot(async () => {
      const connection = sheetPlaceRepository.getConnection();
      if (!connection) throw new Error("no connection");
      const preview = await getPickedPhotoPreview(connection, { sessionId, itemId });
      if (!preview.data) throw new Error("empty");
      const binary = atob(preview.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: preview.mimeType }));
      previewCache.set(itemId, objectUrl);
      if (!disposed) setUrl(objectUrl);
    }).catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
    };
  }, [url, failed, sessionId, itemId]);

  if (url) {
    return <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />;
  }
  return (
    <span className="absolute inset-0 grid place-items-center text-ink-3">
      {failed ? (
        isVideo ? <Video size={18} aria-hidden="true" /> : <Images size={18} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="skeleton absolute inset-0" />
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Importing + results
 * ------------------------------------------------------------------ */

function ImportingStep({ tally }: { tally: ImportTally }) {
  const percent = tally.total > 0 ? Math.round((tally.done / tally.total) * 100) : 0;
  return (
    <div className="space-y-4 pb-6 pt-2">
      <p className="text-center text-[15px] tabular-nums text-ink">
        Importing {Math.min(tally.done + 1, tally.total)} of {tally.total}…
      </p>
      <div className="h-2 overflow-hidden rounded-pill bg-fill">
        <div
          className="h-full rounded-pill bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-center text-[13px] text-ink-3">
        Photos are being copied into your own Google Drive — they’ll be on every device.
      </p>
    </div>
  );
}

function DoneStep({
  tally,
  onRetry,
  onFinish,
}: {
  tally: ImportTally;
  onRetry: () => void;
  onFinish: () => void;
}) {
  const lines: string[] = [];
  if (tally.imported > 0) lines.push(tally.imported === 1 ? "1 photo added" : `${tally.imported} photos added`);
  if (tally.duplicates > 0) lines.push(`${tally.duplicates} already added before`);
  if (tally.videos > 0) lines.push(`${tally.videos} video${tally.videos === 1 ? "" : "s"} skipped`);
  if (tally.failed.length > 0) lines.push(`${tally.failed.length} could not be imported`);
  if (lines.length === 0) lines.push("Nothing was imported");

  return (
    <div className="space-y-4 pb-4 pt-2">
      <div className="rounded-[16px] bg-fill/60 px-4 py-3.5">
        {lines.map((line) => (
          <p key={line} className="py-0.5 text-[15px] text-ink">
            {line}
          </p>
        ))}
        {tally.failureMessage && tally.failed.length > 0 ? (
          <p className="mt-1 text-[13px] leading-snug text-ink-3">{tally.failureMessage}</p>
        ) : null}
      </div>

      {tally.failed.length > 0 ? (
        <Button block variant="secondary" onClick={onRetry} icon={<RefreshCw size={16} aria-hidden="true" />}>
          Retry {tally.failed.length === 1 ? "1 photo" : `${tally.failed.length} photos`}
        </Button>
      ) : null}
      <Button block size="lg" onClick={onFinish}>
        Done
      </Button>
    </div>
  );
}
