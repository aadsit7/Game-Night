"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

/**
 * Creating and editing a trip: a name, two dates, and a line about it.
 *
 * The same shape as the place form on purpose — the same sections, the same
 * inputs, the same Cancel/Save header — because a trip is another record in
 * the same journal, not a different kind of screen.
 */

export type TripDraft = {
  /** Present when editing an existing trip. */
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
};

export function emptyTripDraft(): TripDraft {
  return { name: "", startDate: "", endDate: "", description: "" };
}

/**
 * Sets the start date, bringing an unset or now-impossible end date with it —
 * the same courtesy the place form extends, for the same reason: the picker
 * should open where the trip is, not where today is.
 */
export function withTripStart(draft: TripDraft, startDate: string): TripDraft {
  const wasTracking = !draft.endDate || draft.endDate === draft.startDate;
  const endsBeforeItStarts = Boolean(startDate && draft.endDate && draft.endDate < startDate);
  return {
    ...draft,
    startDate,
    endDate: wasTracking || endsBeforeItStarts ? startDate : draft.endDate,
  };
}

export function isTripDraftValid(draft: TripDraft): boolean {
  if (!draft.name.trim()) return false;
  // Calendar dates are `YYYY-MM-DD`, so comparing as strings orders them.
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) return false;
  return true;
}

export function isTripDraftDirty(current: TripDraft, original: TripDraft): boolean {
  return (
    current.name !== original.name ||
    current.startDate !== original.startDate ||
    current.endDate !== original.endDate ||
    current.description !== original.description
  );
}

export function TripFormSheet({
  open,
  mode,
  draft,
  onChange,
  onSave,
  onClose,
  onDelete,
  saving,
  error,
  depth,
  onRequestClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: TripDraft;
  onChange: (draft: TripDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
  /** Position in the sheet stack; see BottomSheet. */
  depth?: number;
  onRequestClose?: () => boolean;
}) {
  const ids = {
    name: useId(),
    start: useId(),
    end: useId(),
    description: useId(),
  };

  const set = <K extends keyof TripDraft>(key: K, value: TripDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const datesBackwards = Boolean(
    draft.startDate && draft.endDate && draft.endDate < draft.startDate,
  );
  const canSave = isTripDraftValid(draft) && !saving;

  const requestClose = () => {
    if (onRequestClose && onRequestClose() === false) return;
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      onRequestClose={onRequestClose}
      depth={depth}
      label={mode === "create" ? "New trip" : `Edit ${draft.name || "trip"}`}
      header={
        <div className="flex items-center justify-between gap-3 pb-3 pt-1">
          <button
            type="button"
            onClick={requestClose}
            className="pressable -ml-2 min-h-9 shrink-0 rounded-pill px-2 text-[16px] text-accent"
          >
            Cancel
          </button>
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
            {mode === "create" ? "New Trip" : "Edit Trip"}
          </h2>
          <span aria-hidden="true" className="min-h-9 w-[52px] shrink-0" />
        </div>
      }
      footer={
        <Button block size="lg" onClick={onSave} disabled={!canSave} loading={saving}>
          {mode === "create" ? "Create Trip" : "Save Changes"}
        </Button>
      }
    >
      <div className="space-y-6 pb-3">
        {error ? (
          <p
            role="alert"
            className="rounded-sm bg-danger-soft px-3.5 py-3 text-[14px] leading-relaxed text-danger"
          >
            {error}
          </p>
        ) : null}

        <Section title="Trip">
          <div className="space-y-3 px-4 py-3.5">
            <Field id={ids.name} label="Trip name">
              <input
                id={ids.name}
                type="text"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Japan 2026"
                autoComplete="off"
                enterKeyHint="next"
                maxLength={120}
                data-autofocus
                className={inputClass}
              />
            </Field>
          </div>
        </Section>

        <Section title="When">
          <div className="space-y-3 px-4 py-3.5">
            <Field id={ids.start} label="Start date">
              <input
                id={ids.start}
                type="date"
                value={draft.startDate}
                onChange={(event) => onChange(withTripStart(draft, event.target.value))}
                className={inputClass}
              />
            </Field>

            <Field id={ids.end} label="End date">
              <input
                id={ids.end}
                type="date"
                value={draft.endDate}
                min={draft.startDate || undefined}
                onChange={(event) => set("endDate", event.target.value)}
                className={inputClass}
              />
            </Field>

            {datesBackwards ? (
              <p role="alert" className="text-[13px] text-danger">
                The trip ends before it starts. Move one of the dates.
              </p>
            ) : null}
          </div>
        </Section>

        <Section title="Notes">
          <div className="px-4 py-3.5">
            <label htmlFor={ids.description} className="sr-only">
              Description
            </label>
            <textarea
              id={ids.description}
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What was this trip?"
              className={cn(inputClass, "min-h-[76px] resize-none leading-relaxed")}
            />
          </div>
        </Section>

        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="pressable flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-danger-soft text-[16px] font-semibold text-danger"
          >
            <Trash2 size={17} aria-hidden="true" />
            Delete Trip
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}

const inputClass = cn(
  "block w-full rounded-sm bg-fill px-3.5 py-2.5 text-[16px] text-ink",
  "placeholder:text-ink-3 outline-none transition-shadow",
  "focus-visible:ring-2 focus-visible:ring-accent/50",
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="px-1 pb-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {title}
      </h3>
      <div className="overflow-hidden rounded-md bg-fill/60">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}
