"use client";

import { useEffect, useState } from "react";

/**
 * Height, in CSS pixels, currently covered by the software keyboard.
 *
 * iOS Safari does not resize the layout viewport when the keyboard appears, so
 * a bottom-anchored sheet would sit underneath it. `visualViewport` is the only
 * reliable signal: the gap between the layout viewport bottom and the visual
 * viewport bottom is the keyboard.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!viewport) return;

    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overlap = window.innerHeight - viewport.height - viewport.offsetTop;
        // Ignore the few pixels of jitter from Safari's collapsing toolbars.
        setInset(overlap > 60 ? Math.round(overlap) : 0);
      });
    };

    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, []);

  return inset;
}
