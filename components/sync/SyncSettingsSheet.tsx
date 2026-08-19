"use client";

import { useState } from "react";
import { Check, CloudOff, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SyncError, verifyAccess } from "@/lib/sync/githubStore";
import { defaultSettings, toConfig, type SyncSettings } from "@/lib/sync/syncSettings";
import type { SyncState } from "@/lib/sync/useGithubSync";
import { cn } from "@/lib/utils/cn";

/**
 * Where the repository is pointed at and the write token is pasted.
 *
 * Reading is deliberately free: the repository is public, so every device that
 * opens the site already sees the same history with nothing to set up. Only
 * saving needs a token, and it is stored in this browser alone — never in the
 * published bundle, where anyone loading the page could read it back out.
 */
export function SyncSettingsSheet({
  open,
  onClose,
  settings,
  state,
  onSave,
  onSyncNow,
}: {
  open: boolean;
  onClose: () => void;
  settings: SyncSettings | null;
  state: SyncState;
  onSave: (settings: SyncSettings) => void;
  onSyncNow: () => void;
}) {
  const [draft, setDraft] = useState<SyncSettings>(settings ?? defaultSettings());
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Re-seed the form each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDraft(settings ?? defaultSettings());
      setResult(null);
    }
  }

  const set = <K extends keyof SyncSettings>(key: K, value: SyncSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const { canWrite } = await verifyAccess(toConfig({ ...draft, enabled: true }));
      if (canWrite === false) {
        setResult({
          ok: false,
          message:
            "That token can read the repository but not write to it. It needs Contents: read and write.",
        });
      } else if (canWrite === null) {
        // GitHub didn't say either way, which is normal for fine-grained
        // tokens. Claiming success or failure here would both be guesses.
        setResult({
          ok: true,
          message:
            "Reached the repository. GitHub doesn’t report write access for this kind of token — your first save will confirm it.",
        });
      } else {
        setResult({ ok: true, message: "Connected. This device can save to the repository." });
      }
    } catch (error) {
      setResult({
        ok: false,
        message:
          error instanceof SyncError
            ? error.message
            : "Couldn’t reach GitHub. Check the connection and try again.",
      });
    } finally {
      setChecking(false);
    }
  };

  const save = () => {
    onSave({ ...draft, token: draft.token.trim(), enabled: true });
    onClose();
  };

  // Forgetting the token stops this device saving; it keeps reading.
  const disconnect = () => {
    onSave({ ...draft, token: "", enabled: true });
    setDraft((current) => ({ ...current, token: "", enabled: true }));
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Sync settings"
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
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" size="lg" onClick={check} loading={checking} className="flex-1">
            Test
          </Button>
          <Button size="lg" onClick={save} className="flex-[1.4]">
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-3">
        <StatusRow state={state} onSyncNow={onSyncNow} />

        <p className="text-[14px] leading-relaxed text-ink-2">
          Your places live in a JSON file in this repository, so any device that opens
          the site sees the same history — no sign-in, nothing to set up. Adding or
          editing from a device needs a token, which stays in that browser only.
        </p>

        <section>
          <h3 className="px-1 pb-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Access token
          </h3>
          <div className="overflow-hidden rounded-md bg-fill/60 px-4 py-3.5">
            <label htmlFor="sync-token" className="mb-1 block text-[13px] font-medium text-ink-2">
              Fine-grained token with Contents: read and write
            </label>
            <input
              id="sync-token"
              type="password"
              value={draft.token}
              onChange={(event) => set("token", event.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(
                "block w-full rounded-sm bg-fill px-3.5 py-2.5 font-mono text-[15px] text-ink",
                "placeholder:font-sans placeholder:text-ink-3 outline-none",
                "transition-shadow focus-visible:ring-2 focus-visible:ring-accent/50",
              )}
            />

            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2.5 inline-flex min-h-9 items-center gap-1.5 text-[14px] font-medium text-accent"
            >
              Create one on GitHub
              <ExternalLink size={14} aria-hidden="true" />
            </a>

            {result ? (
              <p
                role="status"
                className={cn(
                  "mt-2 flex items-start gap-1.5 text-[13px] leading-relaxed",
                  result.ok ? "text-ink-2" : "text-danger",
                )}
              >
                {result.ok ? (
                  <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                ) : null}
                {result.message}
              </p>
            ) : null}
          </div>

          <p className="flex items-start gap-1.5 px-1 pt-2 text-[12.5px] leading-relaxed text-ink-3">
            <ShieldCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            Stored in this browser only. It is never bundled into the published site,
            because anything shipped to a browser can be read back out of it.
          </p>
        </section>

        <section>
          <h3 className="px-1 pb-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Repository
          </h3>
          <div className="space-y-3 overflow-hidden rounded-md bg-fill/60 px-4 py-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner" value={draft.owner} onChange={(v) => set("owner", v)} />
              <Field label="Repository" value={draft.repo} onChange={(v) => set("repo", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Branch" value={draft.branch} onChange={(v) => set("branch", v)} />
              <Field label="File" value={draft.path} onChange={(v) => set("path", v)} />
            </div>
          </div>
        </section>

        {settings?.token ? (
          <button
            type="button"
            onClick={disconnect}
            className="pressable flex min-h-[50px] w-full items-center justify-center gap-2 rounded-md bg-danger-soft text-[16px] font-semibold text-danger"
          >
            <CloudOff size={17} aria-hidden="true" />
            Forget token on this device
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}

function StatusRow({ state, onSyncNow }: { state: SyncState; onSyncNow: () => void }) {
  const busy = state.phase === "pulling" || state.phase === "pushing";
  const label =
    state.phase === "pulling"
      ? "Checking for changes…"
      : state.phase === "pushing"
        ? "Saving to GitHub…"
        : state.phase === "error"
          ? (state.error ?? "Sync problem")
          : state.canWrite
            ? state.pendingWrite
              ? "Changes waiting to save"
              : "Up to date"
            : "Saved on this device — add a token to sync it everywhere";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-4 py-3",
        state.phase === "error" ? "bg-danger-soft" : "bg-fill/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          state.phase === "error" ? "bg-danger/15 text-danger" : "bg-accent-soft text-accent",
        )}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : state.phase === "error" ? (
          <CloudOff size={16} />
        ) : (
          <Check size={16} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[15px] leading-snug",
            state.phase === "error" ? "text-danger" : "text-ink",
          )}
        >
          {label}
        </p>
        {state.lastSyncedAt && state.phase !== "error" ? (
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
            Last synced {new Date(state.lastSyncedAt).toLocaleTimeString()}
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

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "block w-full rounded-sm bg-fill px-3.5 py-2.5 text-[16px] text-ink",
          "outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent/50",
        )}
      />
    </label>
  );
}
