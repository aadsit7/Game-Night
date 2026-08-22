"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "framer-motion";

import { settleSwipe, type SwipeSide } from "@/lib/ui/swipe";
import { cn } from "@/lib/utils/cn";

/**
 * A list row you can pull sideways to reach its two most common actions.
 *
 * The shape every phone list has taught people: pull a little and the button
 * appears to be tapped; pull all the way and it just happens. Both are
 * supported, because both are what people already do.
 *
 * Destructive actions are not confirmed here. A dialog after a deliberate
 * gesture is friction in the wrong place, and this app already has the better
 * answer — deleting a place leaves an undo standing in the toast for as long
 * as the record is held. Ask afterwards, and only of the people who need it.
 *
 * Not the only way to reach any of this: everything on the row is also in the
 * row's own menu, which is what a keyboard and a screen reader use. A gesture
 * may be the fastest path to an action; it must never be the only one.
 */

export type SwipeAction = {
  label: string;
  icon: ReactNode;
  tone: "accent" | "danger";
  onAction: () => void;
};

/** How much of the row an open action takes up. Comfortably a thumb. */
const REVEAL = 88;

/** Further than any phone is wide: the finger runs out of screen first. */
const FREE = 2000;

const SPRING = { type: "spring" as const, stiffness: 520, damping: 44, mass: 0.8 };

export function SwipeRow({
  children,
  left,
  right,
  disabled = false,
  open,
  onOpenChange,
  className,
  radius = 18,
}: {
  children: ReactNode;
  /** Revealed by pulling the row to the right. */
  left?: SwipeAction;
  /** Revealed by pulling it to the left. */
  right?: SwipeAction;
  disabled?: boolean;
  /** False closes the row — the list keeps only one open at a time. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  radius?: number;
}) {
  const x = useMotionValue(0);
  const rowRef = useRef<HTMLLIElement>(null);
  const reduceMotion = useReducedMotion();
  const openSide = useRef<SwipeSide | null>(null);
  /** Set while a pull is in progress, so the click it ends with can be eaten. */
  const pulled = useRef(false);

  const settleTo = useCallback(
    (to: number) => {
      if (reduceMotion) x.set(to);
      else animate(x, to, SPRING);
    },
    [reduceMotion, x],
  );

  const close = useCallback(() => {
    openSide.current = null;
    settleTo(0);
  }, [settleTo]);

  // The list closes whatever it opened last when another row opens, or when
  // the rows underneath change out from under this one.
  useEffect(() => {
    if (!open && openSide.current) close();
  }, [open, close]);

  useEffect(() => {
    if (disabled && openSide.current) {
      close();
      onOpenChange(false);
    }
  }, [disabled, close, onOpenChange]);

  const run = useCallback(
    (side: SwipeSide) => {
      const action = side === "right" ? right : left;
      openSide.current = null;
      onOpenChange(false);
      action?.onAction();
      /* Home again, without an animation. The row is about to be replaced by
         whatever the action did — a place removed from the list, a sheet over
         the top of it — and sliding back from the edge underneath that reads
         as the action having failed. */
      x.set(0);
    },
    [left, right, onOpenChange, x],
  );

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const width = rowRef.current?.offsetWidth ?? 320;
      const outcome = settleSwipe({
        offset: x.get(),
        velocity: info.velocity.x,
        width,
        reveal: REVEAL,
        hasLeft: Boolean(left),
        hasRight: Boolean(right),
      });

      if (outcome.commit) {
        const finish = () => run(outcome.commit as SwipeSide);
        if (reduceMotion) finish();
        else animate(x, outcome.x, { duration: 0.18, ease: [0.3, 0, 0.8, 0.2] }).then(finish);
        return;
      }

      openSide.current = outcome.open;
      settleTo(outcome.x);
      onOpenChange(outcome.open !== null);
    },
    [left, right, onOpenChange, reduceMotion, run, settleTo, x],
  );

  const style = { borderRadius: radius };

  return (
    /* Clipped to its own footprint. These rows are inset cards rather than
       full-bleed list rows, so a card allowed to slide past the list's own
       margin reads as one escaping the layout; contained, it reads as the
       card sliding aside to uncover what is under it. */
    <li ref={rowRef} className={cn("relative isolate overflow-hidden", className)} style={style}>
      {/*
        The panels sit under the row rather than sliding in beside it, so the
        colour is already there the instant the row starts to move — the action
        is being uncovered, not fetched.
      */}
      {(left || right) && !disabled ? (
        <div className="absolute inset-0 overflow-hidden" style={style}>
          {left ? <Panel action={left} side="left" x={x} onRun={() => run("left")} /> : null}
          {right ? <Panel action={right} side="right" x={x} onRun={() => run("right")} /> : null}
        </div>
      ) : null}

      <motion.div
        style={{ x, borderRadius: radius }}
        className="relative z-10 bg-bg"
        drag={disabled || (!left && !right) ? false : "x"}
        // Lets the browser keep the vertical scroll it would otherwise have to
        // fight this gesture for.
        dragDirectionLock
        dragElastic={0.04}
        dragMomentum={false}
        /* Free to travel the whole width, not pinned at the detent. Clamping
           the drag to the button's width makes the full swipe unreachable —
           the row stops under your finger at 88px and the gesture everyone
           expects to complete the action silently cannot. A side with no
           action still gets nothing, and `settleSwipe` decides where any of it
           comes to rest. */
        dragConstraints={{ left: right ? -FREE : 0, right: left ? FREE : 0 }}
        onDragStart={() => {
          pulled.current = true;
        }}
        onDragEnd={onDragEnd}
        // Every touch starts innocent; only a drag makes the click that ends it
        // guilty. Without this, swiping a row also opens whatever was under the
        // finger — the row slid aside and the place opened anyway.
        onPointerDownCapture={() => {
          pulled.current = false;
        }}
        onClickCapture={(event) => {
          if (pulled.current) {
            event.preventDefault();
            event.stopPropagation();
            pulled.current = false;
            return;
          }
          // A tap on a row standing open puts it away rather than opening the
          // place behind it, which is what every list of this shape does.
          if (openSide.current) {
            event.preventDefault();
            event.stopPropagation();
            close();
            onOpenChange(false);
          }
        }}
      >
        {children}
      </motion.div>
    </li>
  );
}

/**
 * One side's action, as wide as the row is open.
 *
 * Its width tracks the row rather than being fixed at the detent, so a pull
 * past the detent — the one that is about to commit — grows the colour behind
 * it instead of leaving a gap at the edge of the screen.
 */
function Panel({
  action,
  side,
  x,
  onRun,
}: {
  action: SwipeAction;
  side: SwipeSide;
  x: ReturnType<typeof useMotionValue<number>>;
  onRun: () => void;
}) {
  const width = useMotionValue(0);
  useEffect(() => {
    const sync = (value: number) => {
      const pulled = side === "right" ? -value : value;
      width.set(Math.max(0, pulled));
    };
    sync(x.get());
    return x.on("change", sync);
  }, [side, width, x]);

  return (
    <motion.div
      style={{ width }}
      aria-hidden="true"
      className={cn(
        "absolute inset-y-0 flex items-center overflow-hidden",
        side === "right" ? "right-0 justify-end" : "left-0 justify-start",
        action.tone === "danger" ? "bg-danger" : "bg-accent",
      )}
    >
      {/*
        A real button, so the revealed action can simply be tapped — but out of
        the tab order and hidden from assistive tech, because it only exists
        once a finger has pulled the row and everything it does is in the row's
        own menu, which is the path a keyboard and a screen reader take.
      */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onRun}
        className={cn(
          "flex h-full w-[88px] shrink-0 flex-col items-center justify-center gap-1 text-white",
          side === "right" ? "pr-1" : "pl-1",
        )}
      >
        {action.icon}
        <span className="text-[11.5px] font-semibold leading-none">{action.label}</span>
      </button>
    </motion.div>
  );
}
