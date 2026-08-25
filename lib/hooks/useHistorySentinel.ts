"use client";

import { useEffect, useRef } from "react";

/**
 * Makes the phone's back gesture close the surface on top instead of
 * leaving the site.
 *
 * Every sheet, menu, viewer and picker holds one browser-history entry while
 * it is open — a sentinel. Swiping back (or pressing the browser's back
 * button) pops a sentinel; the most recently opened surface still standing is
 * asked to close, exactly as if its own close button had been tapped, so an
 * unsaved form still gets to say "wait". Closing a surface any other way
 * quietly consumes its sentinel, so back never has to be pressed twice for
 * one dismissal.
 *
 * Two disciplines keep this honest:
 *
 * The sentinels are fungible — identical, interchangeable entries — because
 * surfaces open and close in the same breath all the time (a search sheet
 * becomes a form in one tap). What must hold is only the count: one entry in
 * history per surface on the registry, whatever order React runs effects in.
 *
 * And every history mutation goes through one queue. `history.back()` is
 * asynchronous — its pop arrives a beat later — so a push racing in behind a
 * consume would land on the wrong side of it. The queue holds each consume
 * open until its own pop has actually arrived (or a beat has passed), so
 * closing one card and opening the next in the same gesture keeps the books
 * straight.
 */

type Registered = { requestClose: () => void };

/** Surfaces currently holding a sentinel, oldest first. */
const registry: Registered[] = [];

const SENTINEL = { travelGlobeSheet: true };

function isSentinel(state: unknown): boolean {
  return typeof state === "object" && state !== null && "travelGlobeSheet" in state;
}

/** All history writes, strictly in order. */
let chain: Promise<void> = Promise.resolve();

function enqueue(op: () => void | Promise<void>): void {
  chain = chain.then(op).catch(() => undefined);
}

/** The consume whose pop hasn't arrived yet; that pop is ours, not a tap. */
let awaitingConsume: (() => void) | null = null;

function pushEntry(): void {
  enqueue(() => {
    window.history.pushState(SENTINEL, "");
  });
}

function consumeEntry(): void {
  enqueue(
    () =>
      new Promise<void>((resolve) => {
        // Nothing of ours on top — a real navigation already took it.
        if (!isSentinel(window.history.state)) {
          resolve();
          return;
        }
        const done = () => {
          if (awaitingConsume === done) awaitingConsume = null;
          resolve();
        };
        awaitingConsume = done;
        window.history.back();
        // A pop that never comes (some browsers coalesce) must not wedge
        // every later open; a beat is longer than any real back takes.
        window.setTimeout(done, 250);
      }),
  );
}

function onPopState(): void {
  if (awaitingConsume) {
    awaitingConsume();
    return;
  }
  const top = registry[registry.length - 1];
  if (!top) return;

  // The gesture consumed a sentinel. Put one back first, then ask the
  // surface to close: if it closes, its own cleanup consumes the restored
  // entry; if it refuses (an unsaved form raising its discard prompt), the
  // entry stands and the next swipe asks again.
  pushEntry();
  top.requestClose();
}

let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

/**
 * Holds one history sentinel while `open` is true. `requestClose` must be
 * the same path the surface's own close control takes — guards included.
 */
export function useHistorySentinel(open: boolean, requestClose: () => void): void {
  // The freshest close path, without a changing callback re-running the
  // sentinel effect — reopening the entry on every render would stack them.
  const close = useRef(requestClose);
  useEffect(() => {
    close.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    listen();

    const registered: Registered = { requestClose: () => close.current() };
    registry.push(registered);
    pushEntry();

    return () => {
      const index = registry.indexOf(registered);
      if (index !== -1) registry.splice(index, 1);
      consumeEntry();
    };
  }, [open]);
}
