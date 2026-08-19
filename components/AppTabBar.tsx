"use client";

import { forwardRef } from "react";
import { Globe2, History, List, Plus } from "lucide-react";

import { SegmentedControl } from "@/components/ui/SegmentedControl";

export type AppMode = "globe" | "timeline" | "places";

/**
 * The app's entire navigation: three ways to read the same history and one way
 * to add to it, floating within thumb reach and clear of the home indicator.
 * No desktop navbar, no hidden menus — everything important is one tap away.
 */
export const AppTabBar = forwardRef<
  HTMLDivElement,
  {
    mode: AppMode;
    onModeChange: (mode: AppMode) => void;
    onAdd: () => void;
    hidden?: boolean;
  }
>(function AppTabBar({ mode, onModeChange, onAdd, hidden = false }, ref) {
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
        <SegmentedControl
          ariaLabel="View"
          value={mode}
          onChange={onModeChange}
          className="glass min-w-0 flex-1 border border-glass-border shadow-float"
          options={[
            { value: "globe", label: "Globe", icon: <Globe2 size={16} strokeWidth={2.1} /> },
            { value: "timeline", label: "Timeline", icon: <History size={16} strokeWidth={2.1} /> },
            { value: "places", label: "Places", icon: <List size={16} strokeWidth={2.1} /> },
          ]}
        />

        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a place"
          className="pressable grid size-[52px] shrink-0 place-items-center rounded-full bg-accent text-on-accent shadow-float"
        >
          <Plus size={24} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});
