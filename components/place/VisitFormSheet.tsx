"use client";

import { useState } from "react";
import { CalendarPlus, Home, Trash2 } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import type { Trip } from "@/types/trip";

/**
 * One visit, being written: the dates, the trip it belonged to, what kind of
 * trip it was, and a line about it. Small on purpose — logging "we went back
 * in February" should take four taps, not a form.
 */
export type VisitDraft = {
  /** Present when editing a real visit row. Absent for a new one. */
  id?: string;
  startDate: string;
  endDate: string;
  tripId: string;
  tripType: string;
  notes: string;
  /** A period of living here, not a stay — Visit Status "Lived there". */
  lived: boolean;
};

export function emptyVisitDraft(): VisitDraft {
  return { startDate: "", endDate: "", tripId: "", tripType: "", notes: "", lived: false };
}

export function VisitFormSheet({
  open,
  mode,
  placeName,
  draft,
  onChange,
  onSave,
  onClose,
  onDelete,
  saving,
  error,
  depth,
  onRequestClose,
  trips,
  tripTypes,
}: {
  open: boolean;
  mode: "add" | "edit";
  /** Named in the title, so "Add Visit" always says where to. */
  placeName: string;
  draft: VisitDraft;
  onChange: (draft: VisitDraft) => void;
  onSave: () => void;
  onClose: () => void;
  /** Removing a visit; absent while adding one. */
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
  depth?: number;
  /** Ask before closing — the unsaved-changes guard, as on the other forms. */
  onRequestClose?: () => boolean;
  trips: Trip[];
  /** The sheet's own Trip Type words, from the Lookups tab. */
  tripTypes: string[];
}) {
  const [showEndDate, setShowEndDate] = useState(Boolean(draft.endDate));

  // Re-opening resets which fields are revealed to match the visit itself.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setShowEndDate(Boolean(draft.endDate && draft.endDate !== draft.startDate));
  }

  const set = <K extends keyof VisitDraft>(key: K, value: VisitDraft[K]) =>
    onChange({ ...draft, [key]: value });

  /**
   * The same rule as the place form: the end date follows the start until it
   * has been chosen on purpose, and never ends up before the start.
   */
  const setStart = (startDate: string) => {
    const wasTracking = !draft.endDate || draft.endDate === draft.startDate;
    const endsBeforeItStarts = Boolean(startDate && draft.endDate && draft.endDate < startDate);
    onChange({
      ...draft,
      startDate,
      endDate: wasTracking || endsBeforeItStarts ? startDate : draft.endDate,
    });
  };

  // A visit type the sheet's list doesn't know — typed by hand into the sheet
  // itself — still has to appear as what it is rather than vanish.
  const knownType = !draft.tripType || tripTypes.includes(draft.tripType);

  // Cancel goes through the same unsaved-changes guard as dragging the sheet
  // away or pressing Escape — one rule, whichever way you leave.
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
      label={mode === "add" ? `Add a visit to ${placeName}` : `Edit visit to ${placeName}`}
      header={
        <div className="flex items-center justify-between gap-3 pb-2 pt-1">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
            {mode === "add" ? "Add Visit" : "Edit Visit"}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            data-autofocus
            className="pressable -mr-1 rounded-pill px-2 py-1 text-[16px] font-medium text-accent"
          >
            Cancel
          </button>
        </div>
      }
      footer={
        <Button block size="lg" onClick={onSave} disabled={saving} loading={saving}>
          {mode === "add" ? "Add Visit" : "Save Changes"}
        </Button>
      }
    >
      <div className="pb-4">
        <p className="pb-4 text-[15px] text-ink-2">
          <CalendarPlus size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
          {mode === "add" ? `Another time at ${placeName}.` : `One stay at ${placeName}.`}
        </p>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-medium text-ink-2">Date visited</span>
            <input
              type="date"
              value={draft.startDate}
              onChange={(event) => setStart(event.target.value)}
              className="min-h-11 w-full rounded-sm bg-fill px-3.5 text-[16px] text-ink"
            />
          </label>

          {showEndDate ? (
            <label className="block">
              <span className="mb-1.5 block text-[14px] font-medium text-ink-2">End date</span>
              <input
                type="date"
                value={draft.endDate}
                min={draft.startDate || undefined}
                onChange={(event) => set("endDate", event.target.value)}
                className="min-h-11 w-full rounded-sm bg-fill px-3.5 text-[16px] text-ink"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowEndDate(true);
                if (!draft.endDate) set("endDate", draft.startDate);
              }}
              className="pressable text-[15px] font-medium text-accent"
            >
              Add an end date
            </button>
          )}

          {/* A residence is the same row with a different word in Visit
              Status — one switch, not a separate system. */}
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[15px] text-ink">
              <Home size={16} aria-hidden="true" className="text-accent" />
              I lived here during this time
            </span>
            <input
              type="checkbox"
              checked={draft.lived}
              onChange={(event) => set("lived", event.target.checked)}
              className="size-5 accent-[var(--color-accent,#0a84ff)]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[14px] font-medium text-ink-2">Trip type</span>
            <select
              value={draft.tripType}
              onChange={(event) => set("tripType", event.target.value)}
              className="min-h-11 w-full appearance-none rounded-sm bg-fill px-3.5 text-[16px] text-ink"
            >
              <option value="">None</option>
              {!knownType ? <option value={draft.tripType}>{draft.tripType}</option> : null}
              {tripTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          {trips.length > 0 || draft.tripId ? (
            <label className="block">
              <span className="mb-1.5 block text-[14px] font-medium text-ink-2">Trip</span>
              <select
                value={draft.tripId}
                onChange={(event) => set("tripId", event.target.value)}
                className="min-h-11 w-full appearance-none rounded-sm bg-fill px-3.5 text-[16px] text-ink"
              >
                <option value="">No trip</option>
                {draft.tripId && !trips.some((trip) => trip.id === draft.tripId) ? (
                  <option value={draft.tripId}>Unknown trip</option>
                ) : null}
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-[14px] font-medium text-ink-2">Highlights</span>
            <textarea
              value={draft.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={3}
              placeholder="What made this one this one?"
              className="w-full resize-none rounded-sm bg-fill px-3.5 py-2.5 text-[16px] text-ink placeholder:text-ink-3"
            />
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-4 rounded-sm bg-danger-soft px-3.5 py-2.5 text-[15px] text-danger">
            {error}
          </p>
        ) : null}

        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="pressable mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md text-[16px] font-medium text-danger"
          >
            <Trash2 size={16} aria-hidden="true" />
            Remove Visit
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}
