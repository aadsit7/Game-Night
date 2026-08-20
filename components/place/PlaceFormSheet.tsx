"use client";

import { useId, useState } from "react";
import { CalendarRange, ChevronRight, MapPin, Trash2, TriangleAlert } from "lucide-react";

import { PhotoPicker } from "@/components/place/PhotoPicker";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import {
  isDraftValid,
  withEndDateShown,
  withVisitStart,
  type PlaceDraft,
} from "@/lib/store/draft";
import { isVisitOutsideTrip } from "@/lib/trips/tripDays";
import { cn } from "@/lib/utils/cn";
import { formatVisitRange } from "@/lib/utils/date";
import { formatCoordinates, isValidLatitude, isValidLongitude } from "@/lib/utils/geo";
import type { Trip } from "@/types/trip";

/** The value the trip select uses for "make a new one" — never a real id. */
export const NEW_TRIP_VALUE = "__new-trip__";

/**
 * Add and edit share one form — the fields are identical, and so is the mental
 * model. It is controlled from above so the draft survives a detour to the
 * globe to place a pin, or to create a trip.
 */
export function PlaceFormSheet({
  open,
  mode,
  draft,
  onChange,
  onSave,
  onClose,
  onChangeLocation,
  onAdjustPin,
  onDelete,
  saving,
  error,
  recessed,
  onRequestClose,
  trips,
  onCreateTrip,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: PlaceDraft;
  onChange: (draft: PlaceDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onChangeLocation: () => void;
  onAdjustPin: () => void;
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
  recessed?: boolean;
  onRequestClose?: () => boolean;
  /** Every trip that can be chosen, most recent first. */
  trips: Trip[];
  /** Opens the new-trip form. The draft here is untouched and comes back. */
  onCreateTrip: () => void;
}) {
  const [showEndDate, setShowEndDate] = useState(Boolean(draft.visitedTo));
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const ids = {
    name: useId(),
    city: useId(),
    country: useId(),
    from: useId(),
    to: useId(),
    notes: useId(),
    lat: useId(),
    lng: useId(),
    trip: useId(),
  };

  const selectedTrip = trips.find((trip) => trip.id === draft.tripId);
  // A place can carry a trip id this app has never heard of — one typed into
  // the sheet by hand, or belonging to a trip since deleted. Keeping it as an
  // option of its own means saving the form does not quietly discard it.
  const unknownTrip = Boolean(draft.tripId) && !selectedTrip;
  const visitOutsideTrip = Boolean(
    selectedTrip && isVisitOutsideTrip(selectedTrip, draft.visitedFrom || undefined),
  );

  const set = <K extends keyof PlaceDraft>(key: K, value: PlaceDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const hasPosition =
    isValidLatitude(draft.latitude) && isValidLongitude(draft.longitude);

  // Decided as the sheet opens, not on every keystroke: show the end-date field
  // when there already is one, and the coordinate fields when there is no pin
  // yet — the only case where typing numbers is the fastest way forward.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setShowEndDate(Boolean(draft.visitedTo));
      setShowCoordinates(!hasPosition);
    }
  }
  const canSave = isDraftValid(draft) && !saving;

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
      recessed={recessed}
      label={mode === "create" ? "Add a place" : `Edit ${draft.name || "place"}`}
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
            {mode === "create" ? "New Place" : "Edit Place"}
          </h2>
          <span aria-hidden="true" className="min-h-9 w-[52px] shrink-0" />
        </div>
      }
      footer={
        <Button block size="lg" onClick={onSave} disabled={!canSave} loading={saving}>
          {mode === "create" ? "Save Place" : "Save Changes"}
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

        {/* Location — already filled in from search, but always correctable. */}
        <Section title="Location">
          <button
            type="button"
            onClick={onChangeLocation}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-fill-strong"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <MapPin size={17} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium text-ink">
                {hasPosition
                  ? draft.locationLabel || draft.name || "Pinned location"
                  : "Choose a location"}
              </span>
              <span className="block truncate text-[13px] text-ink-2">
                {hasPosition
                  ? formatCoordinates(draft.latitude as number, draft.longitude as number)
                  : "Search for a city, country or landmark"}
              </span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
          </button>

          <Row>
            <button
              type="button"
              onClick={onAdjustPin}
              disabled={!hasPosition}
              className="flex min-h-[50px] w-full items-center justify-between px-4 text-left text-[16px] text-accent transition-colors active:bg-fill-strong disabled:text-ink-3"
            >
              Adjust Pin
              <ChevronRight size={18} aria-hidden="true" className="text-ink-3" />
            </button>
          </Row>

          {/* An escape hatch — never the expected path. */}
          <Row>
            <button
              type="button"
              onClick={() => setShowCoordinates((value) => !value)}
              aria-expanded={showCoordinates}
              className="flex min-h-[50px] w-full items-center justify-between px-4 text-left text-[15px] text-ink-2 transition-colors active:bg-fill-strong"
            >
              Enter coordinates manually
              <ChevronRight
                size={18}
                aria-hidden="true"
                className={cn(
                  "text-ink-3 transition-transform duration-200",
                  showCoordinates && "rotate-90",
                )}
              />
            </button>
          </Row>

          {showCoordinates ? (
            <Row>
              <div className="grid grid-cols-2 gap-3 px-4 py-3">
                <Field id={ids.lat} label="Latitude">
                  <input
                    id={ids.lat}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={-90}
                    max={90}
                    value={draft.latitude ?? ""}
                    onChange={(event) =>
                      set("latitude", event.target.value === "" ? null : Number(event.target.value))
                    }
                    className={inputClass}
                  />
                </Field>
                <Field id={ids.lng} label="Longitude">
                  <input
                    id={ids.lng}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={-180}
                    max={180}
                    value={draft.longitude ?? ""}
                    onChange={(event) =>
                      set(
                        "longitude",
                        event.target.value === "" ? null : Number(event.target.value),
                      )
                    }
                    className={inputClass}
                  />
                </Field>
              </div>
            </Row>
          ) : null}
        </Section>

        <Section title="Details">
          <div className="space-y-3 px-4 py-3.5">
            <Field id={ids.name} label="Place name">
              <input
                id={ids.name}
                type="text"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Kyoto"
                autoComplete="off"
                enterKeyHint="next"
                maxLength={120}
                className={inputClass}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field id={ids.city} label="City">
                <input
                  id={ids.city}
                  type="text"
                  value={draft.city}
                  onChange={(event) => set("city", event.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                  maxLength={120}
                  className={inputClass}
                />
              </Field>
              <Field id={ids.country} label="Country">
                <input
                  id={ids.country}
                  type="text"
                  value={draft.country}
                  onChange={(event) => set("country", event.target.value)}
                  placeholder="Japan"
                  autoComplete="off"
                  maxLength={120}
                  className={inputClass}
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="When">
          <div className="space-y-3 px-4 py-3.5">
            <Field id={ids.from} label="Date visited">
              <input
                id={ids.from}
                type="date"
                value={draft.visitedFrom}
                // The end date follows this one unless it has been set apart,
                // so a same-day trip needs no second visit to the calendar.
                onChange={(event) => onChange(withVisitStart(draft, event.target.value))}
                className={inputClass}
              />
            </Field>

            {showEndDate ? (
              <Field id={ids.to} label="End date">
                <input
                  id={ids.to}
                  type="date"
                  value={draft.visitedTo}
                  min={draft.visitedFrom || undefined}
                  onChange={(event) => set("visitedTo", event.target.value)}
                  className={inputClass}
                />
              </Field>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowEndDate(true);
                  onChange(withEndDateShown(draft));
                }}
                className="pressable inline-flex min-h-10 items-center gap-2 rounded-pill bg-fill-strong px-3.5 text-[15px] font-medium text-accent"
              >
                <CalendarRange size={16} aria-hidden="true" />
                Add an end date
              </button>
            )}
          </div>
        </Section>

        <Section title="Trip">
          <div className="space-y-2 px-4 py-3.5">
            <label htmlFor={ids.trip} className="sr-only">
              Trip
            </label>
            <select
              id={ids.trip}
              value={unknownTrip ? draft.tripId : (draft.tripId || "")}
              onChange={(event) => {
                const next = event.target.value;
                // "New Trip…" is a door, not a value: the draft keeps whatever
                // it had until a trip actually exists to point at.
                if (next === NEW_TRIP_VALUE) onCreateTrip();
                else set("tripId", next);
              }}
              className={cn(inputClass, "appearance-none")}
            >
              <option value="">No Trip</option>
              {unknownTrip ? (
                <option value={draft.tripId}>{draft.tripId} (not in Trips)</option>
              ) : null}
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
              <option value={NEW_TRIP_VALUE}>+ New Trip…</option>
            </select>

            {visitOutsideTrip && selectedTrip ? (
              <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-ink-2">
                <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-3" />
                {/*
                  A warning, never a correction. The dates may well be right and
                  the trip's wrong, and only the person typing knows which.
                */}
                <span>
                  This visit is outside the dates of {selectedTrip.name}
                  {formatVisitRange(selectedTrip.startDate, selectedTrip.endDate)
                    ? ` (${formatVisitRange(selectedTrip.startDate, selectedTrip.endDate)})`
                    : ""}
                  . It will still be saved to the trip.
                </span>
              </p>
            ) : (
              <p className="text-[13px] text-ink-2">
                Optional. A place with no trip still appears on the globe, the timeline and in
                your places.
              </p>
            )}
          </div>
        </Section>

        <Section title="Notes">
          <div className="px-4 py-3.5">
            <label htmlFor={ids.notes} className="sr-only">
              Notes
            </label>
            <textarea
              id={ids.notes}
              value={draft.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="What do you want to remember about this place?"
              className={cn(inputClass, "min-h-[92px] resize-none leading-relaxed")}
            />
          </div>
        </Section>

        <Section title="Photos">
          <div className="px-4 py-3.5">
            <PhotoPicker
              photos={draft.photos}
              onChange={(photos) => set("photos", photos)}
              onError={setPhotoError}
            />
            {photoError ? (
              <p role="alert" className="mt-2.5 text-[13px] text-danger">
                {photoError}
              </p>
            ) : (
              <p className="mt-2.5 text-[13px] text-ink-2">
                The first photo becomes the cover. Without one, we’ll show satellite
                imagery of the spot.
              </p>
            )}
          </div>
        </Section>

        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="pressable flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-danger-soft text-[16px] font-semibold text-danger"
          >
            <Trash2 size={17} aria-hidden="true" />
            Delete Place
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

function Row({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-separator">{children}</div>;
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
