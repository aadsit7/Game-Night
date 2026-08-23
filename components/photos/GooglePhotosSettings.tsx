"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Check, KeyRound, Loader2, Unplug } from "lucide-react";

import { MediaCodeSheet } from "@/components/photos/MediaCodeSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DEFAULT_MEDIA_CODE, storedMediaCode } from "@/lib/photos/mediaCode";
import { openPickerWindow, navigatePickerWindow, closePickerWindow } from "@/lib/photos/pickerWindow";
import type { SheetConnection } from "@/lib/sheets/connection";
import {
  SheetError,
  photosAuthDisconnect,
  photosAuthStart,
  photosAuthStatus,
  type PhotosAuthStatus,
  type SheetCapabilities,
} from "@/lib/sheets/sheetsClient";

/**
 * The Google Photos corner of settings: connected or not, connect once,
 * disconnect cleanly, and the media access code for viewing.
 *
 * Connecting is an import permission; viewing never needs it. That split is
 * the whole design, and the copy here says so.
 */
export function GooglePhotosSettings({
  connection,
  capabilities,
}: {
  connection: SheetConnection | null;
  /** What the deployed script can do — the row asks nothing it can't answer. */
  capabilities: SheetCapabilities;
}) {
  const [status, setStatus] = useState<PhotosAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [codeSheetOpen, setCodeSheetOpen] = useState(false);
  // Lazy initialiser: this section only ever renders client-side, inside an
  // opened settings sheet, so localStorage is readable here.
  const [hasOwnMediaCode, setHasOwnMediaCode] = useState(() => Boolean(storedMediaCode()));

  /**
   * Asking an old deployment about Google Photos gets "Unknown action" back
   * — which used to render here as "you may be offline". The capabilities
   * the script itself advertised decide what to ask: a current script with
   * no OAuth credentials is simply not configured, and an older script is
   * told apart from a network problem instead of blamed on one.
   */
  const scriptCurrent = capabilities.travelPhotos;
  const pickerReady = capabilities.googlePhotosPicker;

  /** The check itself failed — the honest reason, or the row reads "Checking…" forever. */
  const [statusError, setStatusError] = useState<string | null>(null);
  /** Bumped to re-run the status fetch — the one external system here. */
  const [statusEpoch, setStatusEpoch] = useState(0);
  const refresh = useCallback(() => {
    setStatusError(null);
    setStatusEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    if (!connection || !pickerReady) return;
    let disposed = false;
    void photosAuthStatus(connection)
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch((error: unknown) => {
        // Settings still render; the row reports the failed check and the
        // button becomes Retry rather than a Connect that can never enable.
        if (disposed) return;
        if (error instanceof SheetError && error.kind === "network") {
          setStatusError("Google Photos couldn’t be checked — you may be offline");
        } else if (error instanceof SheetError && error.kind === "timeout") {
          setStatusError("The check took too long — the script may be busy");
        } else {
          setStatusError(
            error instanceof Error && error.message
              ? error.message
              : "Google Photos couldn’t be checked",
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [connection, pickerReady, statusEpoch]);

  // Coming back from the consent window is the moment to re-check.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const connect = useCallback(() => {
    if (!connection) return;
    // The blank window opens inside the tap — Safari's rule — and is pointed
    // at Google once the script answers with the consent URL.
    const opened = openPickerWindow();
    setBusy(true);
    setNote(null);
    void photosAuthStart(connection)
      .then(({ authUrl }) => {
        if (!navigatePickerWindow(authUrl)) {
          if (opened) closePickerWindow();
          window.open(authUrl, "_blank");
        }
        setNote("Finish connecting in the Google window, then come back here.");
      })
      .catch((error: unknown) => {
        closePickerWindow();
        setNote(error instanceof Error ? error.message : "The connection couldn’t start.");
      })
      .finally(() => setBusy(false));
  }, [connection]);

  const disconnect = useCallback(() => {
    if (!connection) return;
    setBusy(true);
    void photosAuthDisconnect(connection)
      .then(() => {
        setNote("Google Photos disconnected.");
        // Drop the stale "Connected" while the re-check answers — if that
        // check fails, the row must not keep claiming a revoked connection.
        setStatus(null);
        return refresh();
      })
      .catch((error: unknown) => {
        setNote(error instanceof Error ? error.message : "Disconnecting failed.");
      })
      .finally(() => setBusy(false));
  }, [connection, refresh]);

  if (!connection) return null;

  return (
    <section>
      <h3 className="px-1 pb-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        Google Photos
      </h3>
      <div className="overflow-hidden rounded-md bg-fill/60">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            {busy ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : status?.connected ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Camera size={16} aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-snug text-ink">
              {!scriptCurrent
                ? "The deployed script is older than this app — re-deploy Code.gs to enable Google Photos"
                : !pickerReady
                  ? "Not configured — see the setup guide"
                  : status === null
                    ? (statusError ?? "Checking Google Photos…")
                    : status.connected
                      ? "Connected — photos can be imported from any device"
                      : status.configured
                        ? "Not connected yet"
                        : "Not configured — see the setup guide"}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">
              Connecting is only for importing. Viewing photos already added never asks for this.
            </p>
          </div>
          {!scriptCurrent || !pickerReady ? null : status?.connected ? (
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              disabled={busy}
              className="pressable shrink-0 rounded-pill bg-fill px-3 py-1.5 text-[13.5px] font-medium text-danger disabled:opacity-50"
            >
              <Unplug size={13} aria-hidden="true" className="mr-1 inline-block align-[-2px]" />
              Disconnect
            </button>
          ) : status === null && statusError ? (
            <button
              type="button"
              onClick={refresh}
              className="pressable shrink-0 rounded-pill bg-accent px-3 py-1.5 text-[13.5px] font-semibold text-on-accent"
            >
              Retry
            </button>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={busy || status === null || !status.configured}
              className="pressable shrink-0 rounded-pill bg-accent px-3 py-1.5 text-[13.5px] font-semibold text-on-accent disabled:opacity-50"
            >
              Connect
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCodeSheetOpen(true)}
          className="flex w-full items-center gap-3 border-t border-separator px-4 py-3.5 text-left transition-colors active:bg-fill-strong"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <KeyRound size={15} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-snug text-ink">Media access code</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">
              {hasOwnMediaCode
                ? "Saved on this device — photos can be viewed here"
                : `Using the standard code (${DEFAULT_MEDIA_CODE}) — photos just work. Enter your own if your script has one.`}
            </span>
          </span>
        </button>
      </div>

      {note ? <p className="px-1 pt-2 text-[12.5px] leading-relaxed text-ink-3">{note}</p> : null}
      {status && !status.connected && status.redirectUri ? (
        <p className="wrap-anywhere px-1 pt-2 text-[12px] leading-relaxed text-ink-3">
          OAuth redirect URI for Google Cloud: {status.redirectUri}
        </p>
      ) : null}

      <MediaCodeSheet
        open={codeSheetOpen}
        onClose={() => setCodeSheetOpen(false)}
        onSaved={() => setHasOwnMediaCode(Boolean(storedMediaCode()))}
      />

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Google Photos?"
        message="The stored authorisation is revoked and deleted. Photos already imported stay exactly where they are."
        confirmLabel="Disconnect"
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          setConfirmDisconnect(false);
          disconnect();
        }}
      />
    </section>
  );
}
