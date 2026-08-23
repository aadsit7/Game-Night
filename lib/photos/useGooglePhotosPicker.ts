"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  closePickerWindow,
  isPickerWindowOpen,
  navigatePickerWindow,
  pickerNavigationUrl,
} from "@/lib/photos/pickerWindow";
import {
  SheetError,
  createPickerSession,
  deletePickerSession,
  getPickerSession,
  listPickedPhotos,
  photosAuthStart,
  photosAuthStatus,
} from "@/lib/sheets/sheetsClient";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import type { ImportItemResult } from "@/lib/sheets/sheetsClient";
import type { GooglePickedMedia, PhotoContext } from "@/types/travelPhoto";

/**
 * The Google Photos picking flow, held as one explicit state machine.
 *
 * Every phase a person can be in — connecting, waiting for the picker,
 * reviewing, importing, staring at a partial failure — is a named state
 * here, so the sheet that renders it never has to reconstruct what is going
 * on from scattered booleans.
 */

/** One association's worth of items to import. */
export type ImportGroup = {
  items: GooglePickedMedia[];
  placeId?: string;
  visitId?: string;
  tripId?: string;
};

export type ImportTally = {
  total: number;
  done: number;
  imported: number;
  duplicates: number;
  videos: number;
  /** The items whose import failed, kept whole so retry can resend exactly these. */
  failed: GooglePickedMedia[];
  failureMessage: string | null;
};

export type PickerFlowState =
  /** Nothing running. */
  | { step: "idle" }
  /** Google Photos has never been connected (or the connection lapsed). */
  | { step: "connect"; busy: boolean; message: string | null }
  /** Creating the session with the script. */
  | { step: "starting" }
  /** The picker is open (or openable) in another window. */
  | { step: "picking"; pickerUri: string; windowOpen: boolean }
  /** Reading back what was picked. */
  | { step: "loading" }
  /** The person reviews dates and confirms. */
  | { step: "review"; items: GooglePickedMedia[] }
  | { step: "importing"; tally: ImportTally }
  /** Import finished — possibly with failures worth retrying. */
  | { step: "done"; tally: ImportTally }
  | { step: "error"; message: string };

const IMPORT_BATCH_SIZE = 8;
const DEFAULT_POLL_MS = 3000;
const MAX_POLL_MS = 15 * 60 * 1000;

/** "5s" | "5.000s" | "3600.5s" → milliseconds, with a sane fallback. */
function parseDuration(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = /^([\d.]+)s$/.exec(value.trim());
  if (!match) return fallback;
  const ms = Math.round(Number(match[1]) * 1000);
  return Number.isFinite(ms) && ms > 250 ? ms : fallback;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof SheetError || error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

export function useGooglePhotosPicker({ onImported }: { onImported?: () => void } = {}) {
  const [state, setState] = useState<PickerFlowState>({ step: "idle" });

  const sessionRef = useRef<string | null>(null);
  /** The same id, mirrored for rendering (review previews are fetched with it). */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDeadline = useRef(0);
  const cancelled = useRef(false);
  const contextRef = useRef<PhotoContext | null>(null);
  /** What retry re-sends, association intact. */
  const failedGroupsRef = useRef<ImportGroup[]>([]);
  /** The poll schedules itself through this ref, so the callback chain has
   * no forward reference for the timer to close over. */
  const pollAgain = useRef<() => void>(() => {});

  const clearPollTimer = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  /** Ends the Google session quietly; it is never durable application data. */
  const discardSession = useCallback(() => {
    const connection = sheetPlaceRepository.getConnection();
    const current = sessionRef.current;
    sessionRef.current = null;
    if (connection && current) {
      void deletePickerSession(connection, current).catch(() => undefined);
    }
  }, []);

  const collectItems = useCallback(async () => {
    const connection = sheetPlaceRepository.getConnection();
    const current = sessionRef.current;
    if (!connection || !current) return;

    clearPollTimer();
    closePickerWindow();
    setState({ step: "loading" });

    try {
      const items = await listPickedPhotos(connection, current);
      if (cancelled.current) return;
      if (items.length === 0) {
        setState({
          step: "error",
          message: "No photos came back from Google Photos. If you picked some, tap Done in the picker first, then try again.",
        });
        return;
      }
      setState({ step: "review", items });
    } catch (error) {
      if (cancelled.current) return;
      setState({ step: "error", message: messageOf(error, "The selection couldn’t be read back.") });
    }
  }, [clearPollTimer]);

  const pollSession = useCallback(async () => {
    const connection = sheetPlaceRepository.getConnection();
    const current = sessionRef.current;
    if (!connection || !current || cancelled.current) return;

    const schedule = (delay: number) => {
      pollTimer.current = setTimeout(() => pollAgain.current(), delay);
    };

    try {
      const session = await getPickerSession(connection, current);
      if (cancelled.current || sessionRef.current !== current) return;

      if (session.mediaItemsSet) {
        await collectItems();
        return;
      }
      if (Date.now() > pollDeadline.current) {
        setState({
          step: "error",
          message: "Google Photos didn’t report a selection in time. Open the picker again to continue.",
        });
        discardSession();
        return;
      }
      schedule(parseDuration(session.pollingConfig.pollInterval, DEFAULT_POLL_MS));
    } catch {
      if (cancelled.current) return;
      // A single failed poll is a hiccup, not a verdict; try again slower.
      schedule(DEFAULT_POLL_MS * 2);
    }
  }, [collectItems, discardSession]);

  useEffect(() => {
    pollAgain.current = () => void pollSession();
  }, [pollSession]);

  /**
   * Starts the flow. The blank popup — when one could be opened — was
   * already created inside the tap by `openPickerWindow`; this fills it in.
   */
  const start = useCallback(
    async (context: PhotoContext) => {
      cancelled.current = false;
      contextRef.current = context;
      const connection = sheetPlaceRepository.getConnection();
      if (!connection) {
        closePickerWindow();
        setState({ step: "error", message: "Connect the app to your sheet before adding photos." });
        return;
      }

      setState({ step: "starting" });
      try {
        const status = await photosAuthStatus(connection);
        if (cancelled.current) return;
        if (!status.connected) {
          closePickerWindow();
          setState({
            step: "connect",
            busy: false,
            message: status.configured
              ? null
              : "The Apps Script has no Google Photos credentials yet — see the setup guide.",
          });
          return;
        }

        const session = await createPickerSession(connection, { maxItems: 50 });
        if (cancelled.current) {
          sessionRef.current = session.sessionId;
          discardSession();
          return;
        }
        sessionRef.current = session.sessionId;
        setSessionId(session.sessionId);
        pollDeadline.current =
          Date.now() + Math.min(parseDuration(session.pollingConfig.timeoutIn, MAX_POLL_MS), MAX_POLL_MS);

        const windowOpen = navigatePickerWindow(pickerNavigationUrl(session.pickerUri));
        setState({ step: "picking", pickerUri: session.pickerUri, windowOpen });

        const delay = parseDuration(session.pollingConfig.pollInterval, DEFAULT_POLL_MS);
        pollTimer.current = setTimeout(() => pollAgain.current(), delay);
      } catch (error) {
        if (cancelled.current) return;
        closePickerWindow();
        setState({ step: "error", message: messageOf(error, "Google Photos couldn’t be opened.") });
      }
    },
    [discardSession],
  );

  /** The person opened the picker through the fallback link themselves. */
  const markWindowOpened = useCallback(() => {
    setState((current) =>
      current.step === "picking" ? { ...current, windowOpen: true } : current,
    );
  }, []);

  /**
   * "I've finished selecting" — read the session now rather than waiting for
   * a poll. Listing answers honestly with "no photos" when the picker was
   * abandoned, so there is nothing to branch on first.
   */
  const finishedSelecting = useCallback(async () => {
    clearPollTimer();
    if (!sheetPlaceRepository.getConnection() || !sessionRef.current) return;
    await collectItems();
  }, [clearPollTimer, collectItems]);

  /**
   * Runs the confirmed selection through the importer in small batches.
   * Groups exist because a trip-level import can file each photo under the
   * visit its date unambiguously matches — every group is one association,
   * and every batch inside it succeeds or fails per item.
   */
  const runImport = useCallback(
    async (groups: ImportGroup[], base?: Partial<ImportTally>) => {
      const total = groups.reduce((sum, group) => sum + group.items.length, 0);
      if (total === 0) return;

      const tally: ImportTally = {
        total,
        done: 0,
        imported: base?.imported ?? 0,
        duplicates: base?.duplicates ?? 0,
        videos: base?.videos ?? 0,
        failed: [],
        failureMessage: null,
      };
      const failedGroups: ImportGroup[] = [];
      setState({ step: "importing", tally: { ...tally } });

      for (const group of groups) {
        const byId = new Map(group.items.map((item) => [item.id, item]));
        const failedHere: GooglePickedMedia[] = [];

        for (let at = 0; at < group.items.length; at += IMPORT_BATCH_SIZE) {
          if (cancelled.current) return;
          const batch = group.items.slice(at, at + IMPORT_BATCH_SIZE);
          try {
            const results: ImportItemResult[] = await sheetPlaceRepository.importGooglePhotos({
              items: batch,
              placeId: group.placeId,
              visitId: group.visitId,
              tripId: group.tripId,
            });
            for (const result of results) {
              tally.done += 1;
              if (result.status === "imported") tally.imported += 1;
              else if (result.status === "duplicate") tally.duplicates += 1;
              else if (result.status === "video") tally.videos += 1;
              else {
                const item = byId.get(result.id);
                if (item) {
                  tally.failed.push(item);
                  failedHere.push(item);
                }
                tally.failureMessage = result.error ?? tally.failureMessage;
              }
            }
          } catch (error) {
            // The whole batch failed — every item in it is retryable, and
            // the batches that already landed stay landed.
            tally.done += batch.length;
            tally.failed.push(...batch);
            failedHere.push(...batch);
            tally.failureMessage = messageOf(error, "Some photos couldn’t be imported.");
          }
          setState({ step: "importing", tally: { ...tally, failed: [...tally.failed] } });
        }

        if (failedHere.length > 0) failedGroups.push({ ...group, items: failedHere });
      }

      if (cancelled.current) return;
      failedGroupsRef.current = failedGroups;
      if (tally.imported > 0) onImported?.();
      if (failedGroups.length === 0) discardSession();
      setState({ step: "done", tally: { ...tally, failed: [...tally.failed] } });
    },
    [discardSession, onImported],
  );

  const confirmImport = useCallback(
    (groups: ImportGroup[]) => {
      void runImport(groups);
    },
    [runImport],
  );

  /** Sends only what failed, keeping everything already imported counted. */
  const retryFailed = useCallback(() => {
    setState((current) => {
      if (current.step !== "done" || current.tally.failed.length === 0) return current;
      const { imported, duplicates, videos } = current.tally;
      void runImport(failedGroupsRef.current, { imported, duplicates, videos });
      return current;
    });
  }, [runImport]);

  /** Connect Google Photos: hand the consent URL to the (blank) popup. */
  const connect = useCallback(async () => {
    const connection = sheetPlaceRepository.getConnection();
    if (!connection) return;
    setState({ step: "connect", busy: true, message: null });
    try {
      const { authUrl } = await photosAuthStart(connection);
      if (!navigatePickerWindow(authUrl)) {
        window.open(authUrl, "_blank");
      }
      setState({
        step: "connect",
        busy: false,
        message: "Finish connecting in the Google window, then come back and continue.",
      });
    } catch (error) {
      closePickerWindow();
      setState({ step: "connect", busy: false, message: messageOf(error, "The connection couldn’t start.") });
    }
  }, []);

  /** After the consent window: check status and roll straight into picking. */
  const continueAfterConnect = useCallback(async () => {
    const context = contextRef.current;
    if (context) await start(context);
  }, [start]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    clearPollTimer();
    discardSession();
    closePickerWindow();
    setSessionId(null);
    setState({ step: "idle" });
  }, [clearPollTimer, discardSession]);

  // Coming back to this tab mid-pick is the moment to check the session —
  // iOS throttles timers in background tabs, so this is often the real poll.
  useEffect(() => {
    if (state.step !== "picking") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollSession();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state.step, pollSession]);

  useEffect(() => () => {
    cancelled.current = true;
    clearPollTimer();
  }, [clearPollTimer]);

  return {
    state,
    /** The live Google session id — what review previews are fetched with. */
    sessionId,
    start,
    connect,
    continueAfterConnect,
    markWindowOpened,
    finishedSelecting,
    confirmImport,
    retryFailed,
    cancel,
    isWindowOpen: isPickerWindowOpen,
  };
}
