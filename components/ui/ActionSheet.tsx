"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { Portal } from "@/components/ui/Portal";
import { useHistorySentinel } from "@/lib/hooks/useHistorySentinel";
import { MENU_LAYER } from "@/lib/ui/sheetStack";
import { cn } from "@/lib/utils/cn";

export type SheetAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * The iOS action sheet used by every `•••` menu. Chosen over an anchored
 * popover because it puts full-width, thumb-sized targets at the bottom of the
 * screen — reachable one-handed no matter where the card sits in the list.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  description,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  actions: SheetAction[];
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Back closes the menu, the same as tapping away from it.
  useHistorySentinel(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [open, onClose]);

  return (
    <Portal>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0" style={{ zIndex: MENU_LAYER }}>
            <motion.button
              type="button"
              aria-label="Dismiss menu"
              onClick={onClose}
              tabIndex={-1}
              className="absolute inset-0 cursor-default bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
            />

            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-label={title ? undefined : "Actions"}
              initial={reduceMotion ? { opacity: 0 } : { y: "110%" }}
              animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { y: "110%" }}
              transition={
                reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 40 }
              }
              className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[520px] px-3"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
            >
              <div className="sheet-surface overflow-hidden rounded-[20px] border border-glass-border shadow-float">
                {(title || description) && (
                  <div className="border-b border-separator px-5 py-3.5 text-center">
                    {title ? (
                      <p id={titleId} className="wrap-anywhere text-[15px] font-semibold text-ink">
                        {title}
                      </p>
                    ) : null}
                    {description ? (
                      <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>
                    ) : null}
                  </div>
                )}

                {actions.map((action, index) => (
                  <button
                    key={action.label}
                    type="button"
                    disabled={action.disabled}
                    onClick={() => {
                      onClose();
                      action.onSelect();
                    }}
                    className={cn(
                      "flex min-h-[54px] w-full items-center gap-3 px-5 text-left text-[17px]",
                      "transition-colors active:bg-fill disabled:opacity-40",
                      index > 0 && "border-t border-separator",
                      action.destructive ? "text-danger font-medium" : "text-ink",
                    )}
                  >
                    {action.icon ? (
                      <span aria-hidden="true" className="shrink-0 text-ink-2">
                        {action.icon}
                      </span>
                    ) : null}
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onClose}
                /*
                  Opaque, like the list above it. Translucent material let the
                  floating tab bar read straight through the Cancel button, which
                  is exactly where the eye goes to leave — a presented sheet is
                  opaque on iOS for this reason.
                */
                className="pressable sheet-surface mt-2 min-h-[54px] w-full rounded-[20px] border border-glass-border text-[17px] font-semibold text-accent shadow-soft"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </Portal>
  );
}
