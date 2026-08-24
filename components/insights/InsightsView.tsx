"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BarChart3, ChevronRight, Compass, Plus } from "lucide-react";

import { PlaceRow } from "@/components/insights/PlaceRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FlagChip } from "@/components/ui/FlagChip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  buildInsights,
  type InsightScope,
  type LevelTally,
  type TravelMatrix,
} from "@/lib/insights/insights";
import { cn } from "@/lib/utils/cn";
import type { PlaceVisit, VisitedPlace } from "@/types/place";

/**
 * The journal as a scoreboard: where you keep going, and how much.
 *
 * Three depths of the same answer. The regulars are individual places been
 * to more than once; the rollup reads the same stays a country or a
 * continent at a time; the matrix crosses your busiest countries with the
 * years, so a decade of travelling has a shape before a single row is read.
 * Every row and every cell drills down — a leaderboard you cannot open is
 * a trophy shelf, and this is a way through the collection.
 */
export function InsightsView({
  places,
  visits,
  loading,
  bottomInset,
  onOpenPlace,
  onDrill,
  onAdd,
}: {
  places: VisitedPlace[];
  visits: PlaceVisit[];
  loading: boolean;
  bottomInset: number;
  onOpenPlace: (id: string) => void;
  /** A row or cell was tapped; the shell raises the drill sheet. */
  onDrill: (scope: InsightScope, label: string) => void;
  onAdd: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [level, setLevel] = useState<"country" | "continent">("country");

  const insights = useMemo(() => buildInsights(places, visits), [places, visits]);
  const { totals, regulars, matrix } = insights;
  const rollup = level === "country" ? insights.countries : insights.continents;
  const isEmpty = !loading && totals.places === 0;

  return (
    <div className="absolute inset-0 bg-bg">
      <div className="scroll-area absolute inset-0" style={{ paddingBottom: bottomInset }}>
        <div className="mx-auto w-full max-w-[720px] px-4 sm:max-w-[880px]">
          <header
            className="pb-2"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
            <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">
              Insights
            </h1>
            {loading ? (
              <div className="mt-2.5 flex gap-2" aria-hidden="true">
                <div className="skeleton h-4 w-48 rounded" />
              </div>
            ) : !isEmpty ? (
              <p className="mt-2 text-[14px] text-ink-2">
                <Figure value={totals.stays} label={totals.stays === 1 ? "visit" : "visits"} />
                <Dot />
                <Figure value={totals.days} label="days away" />
                <Dot />
                <Figure
                  value={totals.countries}
                  label={totals.countries === 1 ? "country" : "countries"}
                />
              </p>
            ) : null}
          </header>

          {loading ? (
            <div className="space-y-3 pt-2" aria-hidden="true">
              <div className="skeleton h-24 w-full rounded-[18px]" />
              <div className="skeleton h-40 w-full rounded-[18px]" />
            </div>
          ) : isEmpty ? (
            <EmptyState
              className="pt-8"
              icon={<Compass size={28} aria-hidden="true" />}
              title="Numbers need journeys"
              description="Save the places you’ve been — the ones you keep going back to will rise to the top here."
              action={
                <button
                  type="button"
                  onClick={onAdd}
                  className="pressable inline-flex min-h-[50px] items-center gap-2 rounded-md bg-accent px-6 text-[17px] font-semibold text-on-accent"
                >
                  <Plus size={19} aria-hidden="true" />
                  Add a place
                </button>
              }
            />
          ) : (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.3, 1] }}
              className="pb-4"
            >
              <Section
                title="Your regulars"
                aside={<span className="text-[14px] text-ink-3">been more than once</span>}
              >
                {regulars.length === 0 ? (
                  <p className="rounded-[18px] bg-fill/60 px-3.5 py-4 text-[15px] leading-relaxed text-ink-2">
                    No repeats yet. The first place you go back to starts the board.
                  </p>
                ) : (
                  <div className="divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
                    {regulars.map((tally, index) => (
                      <PlaceRow
                        key={tally.place.id}
                        place={tally.place}
                        rank={index + 1}
                        stays={tally.stays}
                        days={tally.days}
                        lastLabel={tally.lastLabel}
                        onPress={() => onOpenPlace(tally.place.id)}
                      />
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Where you keep going">
                <SegmentedControl
                  ariaLabel="Roll travel up by"
                  className="mb-2.5"
                  value={level}
                  onChange={setLevel}
                  options={[
                    { value: "country", label: "Countries" },
                    { value: "continent", label: "Continents" },
                  ]}
                />
                <div className="divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
                  {rollup.map((row) => (
                    <LevelRow
                      key={row.key}
                      row={row}
                      level={level}
                      onPress={() => onDrill({ level, key: row.key }, row.label)}
                    />
                  ))}
                </div>
              </Section>

              {matrix.years.length > 0 ? (
                <Section
                  title="Year by year"
                  aside={
                    <span className="flex items-center gap-1.5 text-[14px] text-ink-3">
                      <BarChart3 size={13} aria-hidden="true" />
                      visits
                    </span>
                  }
                >
                  <HeatMatrix
                    matrix={matrix}
                    onCell={(row, year) =>
                      onDrill({ level: "country", key: row.key, year }, `${row.label} · ${year}`)
                    }
                  />
                </Section>
              ) : null}
            </motion.div>
          )}
        </div>
      </div>

      {/* Keeps scrolling content from running into the status bar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-bg/85 backdrop-blur-xl"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />
    </div>
  );
}

/** Continents wear initials where countries wear flags. */
const CONTINENT_INITIALS: Record<string, string> = {
  Africa: "AF",
  Antarctica: "AN",
  Asia: "AS",
  Europe: "EU",
  "North America": "NA",
  Oceania: "OC",
  "South America": "SA",
  Elsewhere: "…",
};

function LevelRow({
  row,
  level,
  onPress,
}: {
  row: LevelTally;
  level: "country" | "continent";
  onPress: () => void;
}) {
  const caption = [
    row.places === 1 ? "1 place" : `${row.places} places`,
    row.stays === 1 ? "1 visit" : `${row.stays} visits`,
    row.days > 0 ? `${row.days} ${row.days === 1 ? "day" : "days"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onPress}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-fill-strong"
    >
      {level === "country" ? (
        <FlagChip countryCode={row.code} />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent"
        >
          {CONTINENT_INITIALS[row.label] ?? "…"}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {row.label}
        </span>
        <span className="mt-[3px] block truncate text-[13px] leading-tight text-ink-3">
          {caption}
        </span>
      </span>
      <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-ink-3" />
    </button>
  );
}

/**
 * The busiest countries against the years, a contribution graph for travel.
 * Cell colour is how many stays; the number says it exactly. Wide history
 * scrolls inside the card rather than stretching the page.
 */
function HeatMatrix({
  matrix,
  onCell,
}: {
  matrix: TravelMatrix;
  onCell: (row: TravelMatrix["rows"][number], year: number) => void;
}) {
  const most = Math.max(
    1,
    ...Array.from(matrix.cells.values()).map((cell) => cell.stays),
  );

  return (
    <div className="overflow-x-auto rounded-[18px] bg-fill/60 p-3 scrollbar-none">
      <table className="border-separate border-spacing-[3px]">
        <thead>
          <tr>
            <th aria-label="Country" />
            {matrix.years.map((year) => (
              <th
                key={year}
                scope="col"
                className="min-w-[34px] pb-0.5 text-center text-[11px] font-medium tabular-nums text-ink-3"
              >
                ’{String(year).slice(2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="pr-1.5 text-left">
                <FlagChip countryCode={row.code} />
                <span className="sr-only">{row.label}</span>
              </th>
              {matrix.years.map((year) => {
                const cell = matrix.cells.get(`${row.key}:${year}`);
                if (!cell) {
                  return (
                    <td key={year} aria-label={`${row.label} ${year}: no visits`}>
                      <span className="block size-[34px] rounded-[9px] bg-fill" />
                    </td>
                  );
                }
                const heat = cell.stays / most;
                return (
                  <td key={year}>
                    <button
                      type="button"
                      onClick={() => onCell(row, year)}
                      aria-label={`${row.label} ${year}: ${cell.stays} ${
                        cell.stays === 1 ? "visit" : "visits"
                      }`}
                      className="pressable relative grid size-[34px] place-items-center rounded-[9px] bg-fill"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-[9px] bg-accent"
                        style={{ opacity: 0.2 + heat * 0.65 }}
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          "relative text-[12px] font-semibold tabular-nums",
                          heat > 0.5 ? "text-on-accent" : "text-ink",
                        )}
                      >
                        {cell.stays}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <>
      <span className="font-semibold tabular-nums text-ink">{value.toLocaleString()}</span>{" "}
      <span>{label}</span>
    </>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="mx-1.5 text-ink-3">
      ·
    </span>
  );
}
