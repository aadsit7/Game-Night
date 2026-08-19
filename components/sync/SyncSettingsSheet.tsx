"use client";

import { useState } from "react";
import { Check, CloudOff, Loader2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";

import { SheetConnectionForm } from "@/components/sync/SheetConnectionForm";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { SheetConnection } from "@/lib/sheets/connection";
import { hasDefaultConnection } from "@/lib/sheets/defaultConnection";
import type { SheetStatus } from "@/lib/storage/sheetPlaceRepository";
import { cn } from "@/lib/utils/cn";

/**
 * Where the sheet connection is checked, changed or cleared.
 *
 * The address and the code live in this browser and nowhere else. The site is
 * published from a public repository, so a code committed alongside it would
 * be a code anyone could read.
 */
export function SyncSettingsSheet({
  open,
  onClose,
  connection,
  state,
  onConnect,
  onDisconnect,
  onSyncNow,
}: {
  open: boolean;
  onClose: () => void;
  connection: SheetConnection | null;
  state: SheetStatus;
  onConnect: (connection: SheetConnection) => void;
  onDisconnect: () => void;
  onSyncNow: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        label="Sheet connection"
        header={
          <div className="flex items-center justify-between gap-3 pb-3 pt-1">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Sync</h2>
            <button
              type="button"
              onClick={onClose}
              data-autofocus
              className="pressable min-h-9 rounded-pill px-2 text-[16px] font-medium text-accent"
            >
              Done
            </button>
          </div>
        }
      >
        <div className="space-y-5 pb-3">
          <StatusRow state={state} onSyncNow={onSyncNow} />

          <p className="text-[14px] leading-relaxed text-ink-2">
            Every place you save is written straight to your Google Sheet, so opening the
            site in another browser shows the same data. There is no Save button — changes
            go up as you make them.
          </p>

          <section>
            <h3 className="px-1 pb-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              Connection
            </h3>
            <div className="overflow-hidden rounded-md bg-fill/60 px-4 py-3.5">
              <SheetConnectionForm
                initial={connection}
                submitLabel={connection ? "Update connection" : "Connect"}
                onConnected={(next) => {
                  onConnect(next);
                  onClose();
                }}
              />
            </div>

            <p className="flex items-start gap-1.5 px-1 pt-2 text-[12.5px] leading-relaxed text-ink-3">
              <ShieldCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              {hasDefaultConnection()
                ? "This app ships with a connection built in, so every device works with nothing to type. Anything you enter here overrides it on this device only."
                : "Stored in this browser only. Neither value is bundled into the published site, because anything shipped to a browser can be read back out of it."}
            </p>
          </section>

          {connection ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="pressable flex min-h-[50px] w-full items-center justify-center gap-2 rounded-md bg-danger-soft text-[16px] font-semibold text-danger"
            >
              <Unplug size={17} aria-hidden="true" />
              Reset connection
            </button>
          ) : null}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirmReset}
        title="Reset connection?"
        message={
          hasDefaultConnection()
            ? "This browser will go back to the connection built into the app. Your sheet and everything in it is untouched."
            : "This browser will forget the address and access code, and you'll set it up again next time. Your sheet and everything in it is untouched."
        }
        confirmLabel="Reset"
        destructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          onDisconnect();
          onClose();
        }}
      />
    </>
  );
}

/**
 * Where the data stands, in as many words: connected and quiet, mid-save,
 * holding changes it couldn't send, or not set up at all.
 */
function StatusRow({ state, onSyncNow }: { state: SheetStatus; onSyncNow: () => void }) {
  const busy = state.phase === "loading" || state.phase === "saving";
  const bad = state.phase === "error";
  const waiting = state.phase === "offline";

  const label =
    state.phase === "loading"
      ? "Loading your data…"
      : state.phase === "saving"
        ? "Saving to the sheet…"
        : state.phase === "offline"
          ? state.pending > 0
            ? `Offline — ${state.pending} change${state.pending === 1 ? "" : "s"} waiting`
            : "Offline — showing the last copy loaded"
          : state.phase === "error"
            ? (state.error ?? "Something went wrong")
            : state.phase === "unconfigured"
              ? "Not connected to a sheet yet"
              : "Saved to your sheet";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-4 py-3",
        bad ? "bg-danger-soft" : "bg-fill/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          bad ? "bg-danger/15 text-danger" : "bg-accent-soft text-accent",
        )}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : bad || waiting ? (
          <CloudOff size={16} />
        ) : (
          <Check size={16} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-[15px] leading-snug", bad ? "text-danger" : "text-ink")}>{label}</p>
        {state.lastSyncedAt && !bad ? (
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
            Last loaded {new Date(state.lastSyncedAt).toLocaleTimeString()}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onSyncNow}
        disabled={busy}
        aria-label="Sync now"
        className="pressable grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-2 disabled:opacity-50"
      >
        <RefreshCw size={16} aria-hidden="true" className={busy ? "animate-spin" : undefined} />
      </button>
    </div>
  );
}
