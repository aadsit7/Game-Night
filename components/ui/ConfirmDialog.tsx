"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef } from "react";

import { Portal } from "@/components/ui/Portal";
import { useHistorySentinel } from "@/lib/hooks/useHistorySentinel";
import { ALERT_LAYER } from "@/lib/ui/sheetStack";
import { cn } from "@/lib/utils/cn";

/**
 * A native-feeling alert. One question, two answers, the destructive one
 * clearly marked — never a confirmation page, never a chain of dialogs.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  layer = ALERT_LAYER,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * Where the alert paints. The default outranks every sheet; a question
   * asked from inside a media layer passes `MEDIA_ALERT_LAYER`, because the
   * question must outrank the thing it is about.
   */
  layer?: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  // Back answers a question the safe way: it cancels.
  useHistorySentinel(open, onCancel);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus the safe choice, not the destructive one.
    const frame = requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [open, onCancel]);

  return (
    <Portal>
      <AnimatePresence>
        {open ? (
          <div
            className="fixed inset-0 grid place-items-center px-8"
            style={{ zIndex: layer }}
          >
            <motion.button
              type="button"
              aria-label="Dismiss"
              tabIndex={-1}
              onClick={onCancel}
              className="absolute inset-0 cursor-default bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
            />

            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={message ? messageId : undefined}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.08 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={
                reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 620, damping: 40 }
              }
              className="relative w-full max-w-[300px] overflow-hidden rounded-[20px] glass border border-glass-border shadow-float"
            >
              <div className="px-6 pt-5 pb-4 text-center">
                <h2 id={titleId} className="wrap-anywhere text-[17px] font-semibold text-ink">
                  {title}
                </h2>
                {message ? (
                  <p id={messageId} className="mt-1.5 text-[13px] leading-snug text-ink-2">
                    {message}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 border-t border-separator">
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={onCancel}
                  className="min-h-[48px] border-r border-separator text-[17px] text-accent transition-colors active:bg-fill"
                >
                  {cancelLabel}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className={cn(
                    "min-h-[48px] text-[17px] font-semibold transition-colors active:bg-fill",
                    destructive ? "text-danger" : "text-accent",
                  )}
                >
                  {confirmLabel}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </Portal>
  );
}
