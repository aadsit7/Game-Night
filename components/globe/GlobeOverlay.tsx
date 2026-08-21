"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * The only chrome that sits on top of the Earth: a stat pill under the status
 * bar, and — when there is nothing pinned yet — an invitation. Everything else
 * gets out of the globe's way.
 */

export function GlobeStatsPill({
  places,
  countries,
  visible,
}: {
  places: number;
  countries: number;
  visible: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible && places > 0 ? (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={{ duration: reduceMotion ? 0 : 0.35, ease: [0.2, 0.8, 0.3, 1] }}
          className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 10px)" }}
        >
          <p className="glass mt-2 rounded-pill border border-glass-border px-4 py-2 text-[13px] font-medium text-ink shadow-soft">
            {places} {places === 1 ? "place" : "places"}
            <span aria-hidden="true" className="mx-1.5 text-ink-3">
              ·
            </span>
            {countries} {countries === 1 ? "country" : "countries"}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function GlobeEmptyState({
  visible,
  onAdd,
  bottomOffset,
}: {
  visible: boolean;
  onAdd: () => void;
  bottomOffset: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.2, 0.8, 0.3, 1] }}
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4"
          style={{ bottom: bottomOffset }}
        >
          <div className="glass pointer-events-auto w-full max-w-[420px] rounded-[26px] border border-glass-border p-6 text-center shadow-float">
            <h2 className="text-balance text-[22px] font-semibold tracking-[-0.02em] text-ink">
              Your world starts here
            </h2>
            <p className="mx-auto mt-2 max-w-[32ch] text-balance text-[15px] leading-relaxed text-ink-2">
              Save the places you’ve been and the ones you still want to go, and watch your travel history come to life.
            </p>
            <button
              type="button"
              onClick={onAdd}
              className="pressable mt-5 inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-md bg-accent px-5 text-[17px] font-semibold text-on-accent"
            >
              <Plus size={19} aria-hidden="true" />
              Add your first place
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Shown while the globe is in "tap to place a pin" mode. A banner rather than
 * a sheet, so the whole Earth stays reachable.
 */
export function PickModeBanner({
  visible,
  title,
  message,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  onCancel: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
          transition={{ type: "spring", stiffness: 460, damping: 38 }}
          className="absolute inset-x-0 top-0 z-30 flex justify-center px-3"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 10px)" }}
        >
          <div
            className={cn(
              "glass mt-2 flex w-full max-w-[480px] items-center gap-3 rounded-[20px]",
              "border border-glass-border py-2.5 pl-4 pr-2 shadow-float",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-ink">{title}</p>
              <p className="truncate text-[13px] text-ink-2">{message}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="pressable min-h-10 shrink-0 rounded-pill px-3 text-[15px] font-medium text-accent"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
