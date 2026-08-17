"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as an external store.
 *
 * `useSyncExternalStore` is exactly the right primitive here: the browser owns
 * the value, React subscribes to it. It also gives a defined server snapshot,
 * so nothing mismatches during hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export const usePrefersDark = () => useMediaQuery("(prefers-color-scheme: dark)");
export const usePrefersReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
/** iPad and up — used only to widen layouts, never to change iPhone behaviour. */
export const useIsWide = () => useMediaQuery("(min-width: 768px)");
