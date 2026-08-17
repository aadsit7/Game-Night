"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils/cn";

export type ToastAction = { label: string; onPress: () => void };

export type ToastMessage = {
  id: string;
  text: string;
  action?: ToastAction;
  tone?: "neutral" | "error";
};

/**
 * A single, transient message pinned above the tab bar. Announced politely so
 * "Place deleted · Undo" reaches screen readers without stealing focus.
 */
export function Toast({
  toast,
  onDismiss,
  bottomOffset,
  /** Moves to the top when a sheet owns the bottom of the screen. */
  placement = "bottom",
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
  bottomOffset: number;
  placement?: "bottom" | "top";
}) {
  const reduceMotion = useReducedMotion();
  const fromTop = placement === "top";
  const enterY = fromTop ? -16 : 16;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={
        fromTop
          ? { top: "max(env(safe-area-inset-top, 0px), 10px)" }
          : { bottom: bottomOffset }
      }
    >
      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.id}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: enterY, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: enterY * 0.75, scale: 0.97 }}
            transition={
              reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 38 }
            }
            className={cn(
              "pointer-events-auto flex max-w-[440px] items-center gap-3 rounded-pill",
              "glass border border-glass-border py-2.5 pl-4 shadow-float",
              toast.action ? "pr-2" : "pr-4",
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[15px]",
                toast.tone === "error" ? "text-danger" : "text-ink",
              )}
            >
              {toast.text}
            </span>

            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onPress();
                  onDismiss();
                }}
                className="pressable min-h-9 shrink-0 rounded-pill bg-fill px-3.5 text-[15px] font-semibold text-accent"
              >
                {toast.action.label}
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
