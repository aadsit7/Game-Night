"use client";

import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useKeyboardInset } from "@/lib/hooks/useKeyboardInset";
import { scrimLayer, sheetLayer } from "@/lib/ui/sheetStack";
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
 *
 * Sheets stack. `depth` — 0 for the front one, 1 for the card behind it, and
 * so on — is what orders them, because the components are rendered in a fixed
 * order by the shell and the stack they form is decided at runtime. Paint
 * order therefore cannot come from the DOM: it has to come from the stack, or
 * a sheet opened second ends up drawn underneath the one it opened from.
 *
 * And every sheet is rendered into `document.body` rather than where it is
 * written. A `z-index` only ranks a box against its siblings: the Places view
 * sits in a stacking context of its own, so a sheet opened from inside it —
 * the sort-and-filter sheet, the trip tagger — was ranked *within* that view
 * and painted underneath the tab bar, which floats above it. The bottom
 * eighty pixels of those sheets, counts and all, were behind the tab bar.
 * A portal takes the sheet out to the top level, where its layer means what it
 * says.
 */

const SPRING = { type: "spring" as const, stiffness: 420, damping: 40, mass: 0.9 };

/** Whether there is a DOM to portal into. Never changes once answered. */
const noSubscription = () => () => {};
const useIsClient = () => useSyncExternalStore(noSubscription, () => true, () => false);

/** How far a card behind peeks above the one in front of it. */
const PEEK_PX = 10;

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
  /**
   * Position in the sheet stack: 0 is the sheet in front, 1 sits behind it,
   * and so on. Drives both the layering and the receded-card treatment.
   */
  depth?: number;
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
  depth = 0,
  dismissOnBackdrop = true,
  onRequestClose,
}: BottomSheetProps) {
  const reduceMotion = useReducedMotion();
  const keyboardInset = useKeyboardInset();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const titleId = useId();
  const isModal = variant === "full";

  const recessed = depth > 0;
  const layer = sheetLayer(depth);

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

  const isClient = useIsClient();
  const lift = Math.max(keyboardInset, 0);
  const safeBottom = "max(env(safe-area-inset-bottom, 0px), 14px)";

  const tree = (
    <AnimatePresence>
      {open ? (
        <>
          {isModal && (
            <motion.button
              type="button"
              aria-label={`Close ${label}`}
              onClick={dismissOnBackdrop ? requestClose : undefined}
              tabIndex={-1}
              className="fixed inset-0 cursor-default bg-scrim"
              style={{ zIndex: scrimLayer(depth) }}
              initial={{ opacity: 0 }}
              animate={{ opacity: recessed ? 0.55 : 1 }}
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
            /*
             * A card behind stays fully opaque and is dimmed by the scrim of
             * the sheet in front of it. Fading it instead made two sheets
             * legible at once, their text interleaved — the card behind has to
             * stay a solid card, exactly as iOS keeps it.
             */
            animate={
              reduceMotion
                ? { opacity: 1 }
                : {
                    y: -depth * PEEK_PX,
                    scale: 1 - Math.min(depth, 3) * 0.045,
                    opacity: 1,
                  }
            }
            exit={reduceMotion ? { opacity: 0 } : { y: "110%" }}
            transition={reduceMotion ? { duration: 0 } : SPRING}
            style={{
              bottom: isModal ? 0 : bottomOffset,
              maxHeight: isModal ? `calc(100dvh - ${lift > 0 ? 8 : 40}px)` : undefined,
              transformOrigin: "50% 0%",
              zIndex: layer,
            }}
            className={cn(
              "fixed flex flex-col shadow-float",
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

  // Nothing to portal into until there is a document. Sheets are never open on
  // a first render, so the server and the client agree on "nothing here yet".
  return isClient ? createPortal(tree, document.body) : null;
}
