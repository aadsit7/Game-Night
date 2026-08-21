"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, LocateFixed, MapPin } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { formatAccuracy } from "@/lib/maps/geolocation";
import { cn } from "@/lib/utils/cn";
import { formatCoordinates } from "@/lib/utils/geo";

/**
 * The control bar shown while a pin is being placed or corrected.
 *
 * Everything above it stays visible — the whole point is to see the pin
 * against the map while you move it. Nobody should have to type coordinates to
 * fix a location.
 */
export function AdjustPinBar({
  open,
  mode,
  latitude,
  longitude,
  label,
  resolving,
  onCancel,
  onSave,
  onUseMyLocation,
  locating,
  locationError,
  accuracy,
}: {
  open: boolean;
  mode: "create" | "adjust";
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  resolving: boolean;
  onCancel: () => void;
  onSave: () => void;
  /** Moves the pin to where the device says it is. */
  onUseMyLocation: () => void;
  locating: boolean;
  /** Why the last attempt failed, if it did. Shown in place of the hint. */
  locationError: string | null;
  /** Metres of uncertainty in the current fix, when there is one. */
  accuracy: number | null;
}) {
  const reduceMotion = useReducedMotion();
  const hasPosition = latitude !== null && longitude !== null;
  const accuracyLabel = accuracy === null ? null : formatAccuracy(accuracy);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38 }
          }
          className="fixed inset-x-0 bottom-0 z-[60] px-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          role="group"
          aria-label={mode === "create" ? "Place the pin" : "Adjust the pin"}
        >
          <div className="glass mx-auto w-full max-w-[520px] rounded-[24px] border border-glass-border p-4 shadow-float">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                <MapPin size={17} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold text-ink">
                  {mode === "create" ? "Place the pin" : "Adjust the pin"}
                </p>
                <p className="mt-0.5 truncate text-[13.5px] text-ink-2" aria-live="polite">
                  {resolving ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      Finding this place…
                    </span>
                  ) : (
                    (label ?? "Drag the pin, or tap anywhere on the map")
                  )}
                </p>
                {hasPosition ? (
                  <p className="mt-0.5 truncate text-[12px] tabular-nums text-ink-3">
                    {formatCoordinates(latitude, longitude)}
                    {accuracyLabel ? <span className="ml-1.5">{accuracyLabel}</span> : null}
                  </p>
                ) : null}
              </div>

              {/*
                Placing a pin where you are standing is the common case for
                anywhere that has no searchable name — a viewpoint, a beach, a
                spot on a trail — and hunting for it on a world map is the slow
                way to do it.
              */}
              <button
                type="button"
                onClick={onUseMyLocation}
                disabled={locating}
                aria-label="Move the pin to my location"
                className={cn(
                  "pressable grid size-10 shrink-0 place-items-center rounded-full",
                  "bg-fill text-accent transition-colors disabled:opacity-60",
                )}
              >
                {locating ? (
                  <Loader2 size={18} aria-hidden="true" className="animate-spin" />
                ) : (
                  <LocateFixed size={18} aria-hidden="true" />
                )}
              </button>
            </div>

            {locationError ? (
              <p role="alert" className="mt-2.5 text-[12.5px] leading-relaxed text-danger">
                {locationError}
              </p>
            ) : null}

            <div className="mt-3.5 flex gap-2.5">
              <Button variant="secondary" size="lg" onClick={onCancel} className="flex-1">
                Cancel
              </Button>
              <Button size="lg" onClick={onSave} disabled={!hasPosition} className="flex-[1.4]">
                {mode === "create" ? "Use This Spot" : "Save Pin Location"}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
