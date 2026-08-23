"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether an element is on screen, or close enough that it is about to be.
 *
 * For deciding what a long list is allowed to be expensive about. A list row
 * nobody can see cannot be touched, so it does not need the machinery that
 * makes it respond to touch — and in a list of three hundred, that machinery
 * is the whole cost of opening the tab.
 *
 * Latches on and never goes back. Rows the traveller has actually scrolled
 * past stay ready, which keeps the total proportional to what they looked at
 * rather than to what they own, and avoids paying the cost twice for a list
 * being scrolled up and down.
 */

/**
 * How far outside the screen still counts as "about to be".
 *
 * Two screens' worth: a flick can cover that between one observer callback and
 * the next, and a row that arrives unready is a row whose first swipe does
 * nothing.
 */
const MARGIN = "200% 0px";

const wanted = new WeakMap<Element, () => void>();
let shared: IntersectionObserver | null = null;

/** One observer for every row on the screen, rather than one each. */
function observer(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) wanted.get(entry.target)?.();
      }
    },
    { rootMargin: MARGIN },
  );
  return shared;
}

export function useNearViewport(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;

    const io = observer();
    // Without an observer there is no way to tell, and the safe answer is the
    // one where everything works — just more expensively. Next frame rather
    // than now, so this stays a subscription that happens to answer
    // immediately rather than a render that schedules another render.
    if (!io) {
      const frame = requestAnimationFrame(() => setNear(true));
      return () => cancelAnimationFrame(frame);
    }

    wanted.set(element, () => setNear(true));
    io.observe(element);
    return () => {
      io.unobserve(element);
      wanted.delete(element);
    };
  }, [ref, near]);

  return near;
}
