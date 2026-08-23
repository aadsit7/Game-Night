"use client";

import { forwardRef, useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Earth, History, Luggage, MapPin, Play, Plus } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type AppMode = "globe" | "timeline" | "places" | "trips" | "player";

/**
 * The app's entire navigation: five ways to read the same history and one way
 * to add to it, floating within thumb reach and clear of the home indicator.
 * No desktop navbar, no hidden menus — everything important is one tap away.
 *
 * Built as a tab bar rather than a segmented control, which is what it always
 * was. The distinction is not pedantry: a segmented control picks a value out
 * of a set and can reasonably shrink to icons, and this bar navigates, so its
 * destinations keep their names at every width. Stacking the label under the
 * icon is what buys the room to do that on a small phone — the same reason
 * every iOS tab bar is shaped this way.
 */

const TABS: Array<{ value: AppMode; label: string; Icon: typeof Earth }> = [
  { value: "globe", label: "Globe", Icon: Earth },
  { value: "timeline", label: "Timeline", Icon: History },
  { value: "places", label: "Places", Icon: MapPin },
  { value: "trips", label: "Trips", Icon: Luggage },
  { value: "player", label: "Player", Icon: Play },
];

export const AppTabBar = forwardRef<
  HTMLDivElement,
  {
    mode: AppMode;
    onModeChange: (mode: AppMode) => void;
    onAdd: () => void;
    hidden?: boolean;
  }
>(function AppTabBar({ mode, onModeChange, onAdd, hidden = false }, ref) {
  const reduceMotion = useReducedMotion();
  const thumbId = useId();

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pt-3 transition-[opacity,transform] duration-300"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)",
        opacity: hidden ? 0 : 1,
        transform: hidden ? "translateY(16px)" : "none",
        visibility: hidden ? "hidden" : "visible",
      }}
      // Hidden from assistive tech while a modal flow owns the screen.
      inert={hidden || undefined}
    >
      <div className="pointer-events-auto mx-auto flex max-w-[520px] items-center gap-2.5">
        <nav
          aria-label="Views"
          className="glass flex min-w-0 flex-1 items-center gap-0.5 rounded-[26px] border border-glass-border p-1.5 shadow-float"
        >
          {TABS.map(({ value, label, Icon }) => {
            const active = value === mode;
            return (
              <button
                key={value}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onModeChange(value)}
                className={cn(
                  "relative isolate flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px]",
                  "min-h-[50px] rounded-[20px] px-1 pt-1.5 pb-1 transition-colors duration-200",
                  active ? "text-accent" : "text-ink-2",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={thumbId}
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-[20px] bg-surface-2 shadow-soft"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
                    }
                  />
                )}
                <Icon
                  size={20}
                  strokeWidth={active ? 2.3 : 1.9}
                  aria-hidden="true"
                  className="shrink-0"
                />
                <span
                  className={cn(
                    "max-w-full truncate text-[10.5px] leading-none tracking-[0.005em]",
                    active ? "font-semibold" : "font-medium",
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a place"
          className="pressable grid size-[58px] shrink-0 place-items-center rounded-[22px] bg-accent text-on-accent shadow-float"
        >
          <Plus size={25} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});
