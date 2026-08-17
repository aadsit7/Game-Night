"use client";

import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";

import { useKeyboardInset } from "@/lib/hooks/useKeyboardInset";
import { cn } from "@/lib/utils/cn";

/**
 * An iOS-style bottom sheet.
 *
 * Two shapes, one component:
 *  - `compact` floats above the tab bar, leaves the globe interactive behind
 *    it, and is used for the pin preview.
 *  - `full` is a modal card covering most of the screen: it dims the
 *    background, traps focus, and is used for details and forms.
 *
 * Full sheets are dragged by their grabber and header only. Dragging from
 * anywhere would fight with scrolling the content — the same compromise iOS
 * makes once a sheet's content is scrollable.
 */

const SPRING = { type: "spring" as const, stiffness: 420, damping: 40, mass: 0.9 };

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  variant?: "compact" | "full";
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
  /** Pinned above the scroll area — sheet headers live here. */
  header?: ReactNode;
  /** Pinned to the bottom, above the safe area — primary actions live here. */
  footer?: ReactNode;
  /** Lifts a compact sheet clear of the tab bar. */
  bottomOffset?: number;
  className?: string;
  /** Stacked-sheet effect: recedes this sheet when another opens above it. */
  recessed?: boolean;
  dismissOnBackdrop?: boolean;
  /** Ask before closing — used by forms with unsaved changes. */
  onRequestClose?: () => boolean;
};

export function BottomSheet({
  open,
  onClose,
  variant = "full",
  label,
  children,
  header,
  footer,
  bottomOffset = 0,
  className,
  recessed = false,
  dismissOnBackdrop = true,
  onRequestClose,
}: BottomSheetProps) {
  const reduceMotion = useReducedMotion();
  const keyboardInset = useKeyboardInset();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const titleId = useId();
  const isModal = variant === "full";

  const requestClose = useCallback(() => {
    if (onRequestClose && onRequestClose() === false) return;
    onClose();
  }, [onClose, onRequestClose]);

  useEffect(() => {
    if (!open || recessed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, recessed, requestClose]);

  // Move focus into the sheet so screen readers and keyboards follow it, and
  // hand focus back when it closes.
  useEffect(() => {
    if (!open || !isModal || recessed) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector<HTMLElement>("[data-autofocus]");
      (target ?? panel).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous && document.contains(previous)) {
        previous.focus?.({ preventScroll: true });
      }
    };
  }, [open, isModal, recessed]);

  const onKeyDownCapture = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [
      ...panel.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > 110 || info.velocity.y > 700) requestClose();
    },
    [requestClose],
  );

  const lift = Math.max(keyboardInset, 0);
  const safeBottom = "max(env(safe-area-inset-bottom, 0px), 14px)";

  return (
    <AnimatePresence>
      {open ? (
        <>
          {isModal && (
            <motion.button
              type="button"
              aria-label={`Close ${label}`}
              onClick={dismissOnBackdrop ? requestClose : undefined}
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: recessed ? 0.5 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.22 }}
            />
          )}

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal={isModal || undefined}
            aria-labelledby={titleId}
            tabIndex={-1}
            inert={recessed || undefined}
            onKeyDownCapture={isModal ? onKeyDownCapture : undefined}
            drag="y"
            dragListener={!isModal}
            dragControls={dragControls}
            dragDirectionLock
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            initial={reduceMotion ? { opacity: 0 } : { y: "110%" }}
            animate={
              reduceMotion
                ? { opacity: 1 }
                : { y: 0, scale: recessed ? 0.93 : 1, opacity: recessed ? 0.65 : 1 }
            }
            exit={reduceMotion ? { opacity: 0 } : { y: "110%" }}
            transition={reduceMotion ? { duration: 0 } : SPRING}
            style={{
              bottom: isModal ? 0 : bottomOffset,
              maxHeight: isModal ? `calc(100dvh - ${lift > 0 ? 8 : 40}px)` : undefined,
              transformOrigin: "50% 0%",
            }}
            className={cn(
              "fixed z-50 flex flex-col shadow-float",
              "border-t border-glass-border",
              isModal
                ? "sheet-surface inset-x-0 mx-auto w-full max-w-[560px] rounded-t-[28px]"
                : "glass left-3 right-3 mx-auto max-w-[520px] rounded-[26px] border",
              className,
            )}
          >
            <span id={titleId} className="sr-only">
              {label}
            </span>

            {/* Grabber. On modal sheets it is also the drag handle. */}
            <div
              className="flex shrink-0 cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing"
              style={{ touchAction: "none" }}
              onPointerDown={isModal ? (event) => dragControls.start(event) : undefined}
              aria-hidden="true"
            >
              <span className="h-[5px] w-9 rounded-full bg-ink-3/50" />
            </div>

            {header ? (
              <div
                className="shrink-0 px-5"
                style={isModal ? { touchAction: "none" } : undefined}
                onPointerDown={
                  isModal
                    ? (event) => {
                        // Only start a drag from empty header space, never from
                        // a control the user meant to press.
                        if ((event.target as HTMLElement).closest("button, a, input")) return;
                        dragControls.start(event);
                      }
                    : undefined
                }
              >
                {header}
              </div>
            ) : null}

            <div className="scroll-area min-h-0 flex-1 px-5">{children}</div>

            {footer ? (
              <div
                className="shrink-0 border-t border-separator px-5 pt-3"
                style={{ paddingBottom: lift > 0 ? 12 : safeBottom }}
              >
                {footer}
              </div>
            ) : (
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ height: lift > 0 ? 8 : safeBottom }}
              />
            )}

            {lift > 0 ? <div aria-hidden="true" style={{ height: lift }} /> : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
