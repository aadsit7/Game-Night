"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { placeRepository } from "@/lib/storage/placeRepository";
import {
  SyncError,
  readRemote,
  writeRemote,
  type GithubConfig,
} from "@/lib/sync/githubStore";
import { mergePlaces, pruneTombstones, sameCollection } from "@/lib/sync/mergePlaces";
import {
  canWrite as settingsCanWrite,
  loadSettings,
  saveSettings as persistSettings,
  toConfig,
  type SyncSettings,
} from "@/lib/sync/syncSettings";
import type { VisitedPlace } from "@/types/place";

/**
 * Keeps this device's copy of the collection in step with the one in the
 * repository.
 *
 * Pulls happen on load, when the tab regains focus, and on a slow timer while
 * visible. Pushes are debounced, so a burst of edits becomes one commit rather
 * than one per keystroke. A push that loses a race is not dropped: the file is
 * re-read, merged, and written again.
 */

export type SyncPhase = "disabled" | "idle" | "pulling" | "pushing" | "error";

export type SyncState = {
  phase: SyncPhase;
  lastSyncedAt: string | null;
  error: string | null;
  /** Whether this device is allowed to write, i.e. has a token. */
  canWrite: boolean;
  /** Edits made locally that haven't reached the repository yet. */
  pendingWrite: boolean;
};

const PUSH_DEBOUNCE_MS = 1800;
const POLL_INTERVAL_MS = 90_000;

export function useGithubSync({
  ready,
  onMerged,
}: {
  /** Wait until the local collection has loaded before touching the network. */
  ready: boolean;
  onMerged: (places: VisitedPlace[]) => void;
}) {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [state, setState] = useState<SyncState>({
    phase: "idle",
    lastSyncedAt: null,
    error: null,
    canWrite: false,
    pendingWrite: false,
  });

  const shaRef = useRef<string | null>(null);
  const pushTimer = useRef<number | null>(null);
  const busy = useRef(false);
  const onMergedRef = useRef(onMerged);
  const settingsRef = useRef<SyncSettings | null>(null);

  useEffect(() => {
    onMergedRef.current = onMerged;
    settingsRef.current = settings;
  });

  // Settings live in localStorage, which isn't readable during a server render.
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    if (!settings) return;
    setState((current) => ({ ...current, canWrite: settingsCanWrite(settings) }));
  }, [settings]);

  const config = useCallback((): GithubConfig | null => {
    const current = settingsRef.current;
    if (!current || !current.enabled) return null;
    return toConfig(current);
  }, []);

  const describe = (error: unknown): string => {
    if (error instanceof SyncError) return error.message;
    return "Syncing didn’t work. Your places are still saved on this device.";
  };

  /** Applies a merged collection locally and tells the store about it. */
  const applyMerged = useCallback(async (merged: VisitedPlace[]) => {
    const visible = await placeRepository.replaceAll(merged);
    onMergedRef.current(visible);
  }, []);

  const push = useCallback(async () => {
    const current = config();
    if (!current?.token || busy.current) return;

    busy.current = true;
    setState((s) => ({ ...s, phase: "pushing", error: null }));

    try {
      const local = pruneTombstones(await placeRepository.getAllIncludingDeleted());
      const message = `Update travel places (${local.filter((p) => !p.deletedAt).length} saved)`;

      try {
        shaRef.current = await writeRemote(current, local, shaRef.current, message);
      } catch (error) {
        // Someone else wrote first: take their version, fold ours in, try again.
        if (error instanceof SyncError && error.kind === "conflict") {
          const snapshot = await readRemote(current);
          const merged = pruneTombstones(mergePlaces(local, snapshot.places));
          await applyMerged(merged);
          shaRef.current = await writeRemote(current, merged, snapshot.sha, message);
        } else {
          throw error;
        }
      }

      setState((s) => ({
        ...s,
        phase: "idle",
        error: null,
        pendingWrite: false,
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch (error) {
      setState((s) => ({ ...s, phase: "error", error: describe(error) }));
    } finally {
      busy.current = false;
    }
  }, [config, applyMerged]);

  const schedulePush = useCallback(() => {
    const current = config();
    if (!current?.token) return;

    setState((s) => ({ ...s, pendingWrite: true }));
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      void push();
    }, PUSH_DEBOUNCE_MS);
  }, [config, push]);

  const pull = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      const current = config();
      if (!current || busy.current) return;

      busy.current = true;
      if (!quiet) setState((s) => ({ ...s, phase: "pulling", error: null }));

      try {
        const snapshot = await readRemote(current);
        shaRef.current = snapshot.sha;

        const local = await placeRepository.getAllIncludingDeleted();
        const merged = pruneTombstones(mergePlaces(local, snapshot.places));

        if (!sameCollection(merged, local)) await applyMerged(merged);

        setState((s) => ({
          ...s,
          phase: "idle",
          error: null,
          lastSyncedAt: new Date().toISOString(),
        }));

        // This device knows something the repository doesn't — send it up.
        if (current.token && !sameCollection(merged, snapshot.places)) {
          busy.current = false;
          await push();
          return;
        }
      } catch (error) {
        setState((s) => ({ ...s, phase: "error", error: describe(error) }));
      } finally {
        busy.current = false;
      }
    },
    [config, applyMerged, push],
  );

  // First pull, once the local collection is in hand.
  const pulledOnce = useRef(false);
  useEffect(() => {
    if (!ready || !settings || pulledOnce.current) return;
    pulledOnce.current = true;
    void pull();
  }, [ready, settings, pull]);

  // Coming back to the tab is the moment another device's change matters most.
  useEffect(() => {
    if (!ready) return;

    const onFocus = () => {
      if (document.visibilityState === "visible") void pull({ quiet: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void pull({ quiet: true });
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
    };
  }, [ready, pull]);

  // Never leave a debounced push unsent because the tab went away.
  useEffect(() => {
    const flush = () => {
      if (pushTimer.current) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
        void push();
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
    };
  }, [push]);

  const updateSettings = useCallback(
    (next: SyncSettings) => {
      persistSettings(next);
      setSettings(next);
      settingsRef.current = next;
      shaRef.current = null;
      pulledOnce.current = true;
      void pull();
    },
    [pull],
  );

  return {
    settings,
    updateSettings,
    syncState: state,
    schedulePush,
    syncNow: () => void pull(),
  };
}
