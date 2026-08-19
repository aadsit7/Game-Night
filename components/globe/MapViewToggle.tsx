"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { MapView } from "@/lib/maps/basemap";

/**
 * Countries or Cities — the two ways people actually read a travel map.
 * Countries answers "how much of the world have I seen"; Cities answers
 * "where exactly have I been". Sitting just above the tab bar keeps both
 * within the same thumb sweep as everything else.
 */
export function MapViewToggle({
  value,
  onChange,
  visible,
  bottomOffset,
}: {
  value: MapView;
  onChange: (value: MapView) => void;
  visible: boolean;
  bottomOffset: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.2, 0.8, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
          style={{ bottom: bottomOffset }}
        >
          <SegmentedControl
            ariaLabel="Map detail"
            value={value}
            onChange={onChange}
            className="glass pointer-events-auto w-auto border border-glass-border shadow-soft"
            options={[
              { value: "countries", label: "Countries" },
              { value: "cities", label: "Cities" },
            ]}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
