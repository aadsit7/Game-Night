"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Compass, Grid3x3, Plus, SlidersHorizontal, TrendingUp } from "lucide-react";

import { ContinentStrip } from "@/components/insights/ContinentStrip";
import { HeatMatrix } from "@/components/insights/HeatMatrix";
import { HighlightGrid } from "@/components/insights/HighlightGrid";
import { HorizonCard } from "@/components/insights/HorizonCard";
import { LevelRow } from "@/components/insights/LevelRow";
import { PlaceRow } from "@/components/insights/PlaceRow";
import { RhythmCard } from "@/components/insights/RhythmCard";
import { StatsFilterSheet } from "@/components/insights/StatsFilterSheet";
import { SummaryCard } from "@/components/insights/SummaryCard";
import { YearBars } from "@/components/insights/YearBars";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  COUNTRIES_IN_THE_WORLD,
  buildDashboard,
  continentCoverage,
  continentsVisited,
} from "@/lib/insights/dashboard";
import {
  buildInsights,
  tripTypesOf,
  visitYears,
  type InsightMetric,
  type InsightScope,
} from "@/lib/insights/insights";
import { cn } from "@/lib/utils/cn";
import type { PlaceVisit, VisitedPlace } from "@/types/place";

/** Countries before the rollup folds itself away behind "show all". */
const ROLLUP_PREVIEW = 6;

/**
 * The journal as a dashboard, built for a phone in one hand.
 *
 * It reads top to bottom the way the questions arrive: how much travelling was
 * that, what stands out, what is next, when in the year do I go, how have the
 * years compared, where do I keep going back to. Four figures lead, because a
 * number small enough to be a caption is not a dashboard; every board below
 * them is a way *into* the collection rather than a trophy shelf — rows,
 * cells, bars and continents all open the places behind them.
 *
 * One lens covers the whole tab: a year, a kind of trip, and whether visits or
 * days do the ranking. The year rail stays on screen because it is the control
 * people move constantly; the rest lives in a sheet behind one button, which
 * is how two thirds of the chrome came off the top of a phone screen.
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
  /** A row, a cell, a bar or a continent was tapped; the shell raises the drill sheet. */
  onDrill: (scope: InsightScope, label: string) => void;
  onAdd: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [level, setLevel] = useState<"country" | "continent">("country");
  const [yearView, setYearView] = useState<"bars" | "grid">("bars");
  const [rollupExpanded, setRollupExpanded] = useState(false);

  /*
   * The lens: a year, a kind of trip, and which number leads. Every section —
   * and every drill — looks through it, so a board and its drill can never
   * answer different questions.
   */
  const [year, setYear] = useState<number | null>(null);
  const [continent, setContinent] = useState<string | null>(null);
  const [tripType, setTripType] = useState<string | null>(null);
  const [metric, setMetric] = useState<InsightMetric>("stays");
  const [filtersOpen, setFiltersOpen] = useState(false);

  /* Chip vocabularies come from the unfiltered journal, so picking a year
     never hides the way back to the others. */
  const years = useMemo(() => visitYears(places, visits), [places, visits]);
  const tripTypes = useMemo(() => tripTypesOf(visits), [visits]);
  const continents = useMemo(() => continentsVisited(places, visits), [places, visits]);

  const lens = useMemo(
    () => ({
      year: year ?? undefined,
      tripType: tripType ?? undefined,
      continent: continent ?? undefined,
      metric,
    }),
    [year, tripType, continent, metric],
  );

  const insights = useMemo(() => buildInsights(places, visits, lens), [places, visits, lens]);
  const board = useMemo(() => buildDashboard(places, visits, lens), [places, visits, lens]);

  const { regulars, matrix } = insights;
  const rollup = level === "country" ? insights.countries : insights.continents;
  const rollupTop = Math.max(
    1,
    ...rollup.map((row) => (metric === "days" ? row.days : row.stays)),
  );
  const rollupRows = rollupExpanded ? rollup : rollup.slice(0, ROLLUP_PREVIEW);

  /* Continent → places there, for the coverage strip. Read past the region
     filter on purpose: the strip is what sets that filter, so it has to keep
     showing the continents the lens is currently excluding. */
  const continentPlaces = useMemo(() => {
    const coverage = continentCoverage(places, visits, {
      year: year ?? undefined,
      tripType: tripType ?? undefined,
    });
    return new Map(coverage.map((row) => [row.name, row.places]));
  }, [places, visits, year, tripType]);

  const filtersActive = tripType !== null || continent !== null || metric !== "stays";
  /* The scope, said once. Under "all time" the chip above already says those
     words, so the subtitle spends itself on something the chip cannot: the
     stretch of calendar the numbers below actually cover. */
  const lensLabel = [
    year !== null
      ? String(year)
      : board.span && board.span.from !== board.span.to
        ? `${board.span.from}–${board.span.to}`
        : "All time",
    continent,
    tripType,
  ]
    .filter(Boolean)
    .join(" · ");

  /* A section with a heading and nothing under it is worse than no section.
     Both of these can come up honestly — a journal of undated stays has no
     calendar to draw and no records to hold. */
  const hasHighlights =
    year !== null ||
    board.span !== null ||
    board.longest !== null ||
    board.busiestMonth !== null ||
    board.furthest !== null ||
    board.last !== null ||
    board.typicalDays > 0;
  const hasMonths = board.months.some((month) => month.trips > 0);

  /* An empty journal and an empty filter answer are different sentences. */
  const isEmpty =
    !loading && years.length === 0 && year === null && tripType === null &&
    continent === null && board.totals.places === 0;
  const filteredEmpty = !loading && !isEmpty && board.totals.trips === 0;

  /** The lens, spelled out for a drill's title: "Japan · 2024 · Family". */
  const drill = useCallback(
    (scope: Omit<InsightScope, "tripType" | "metric">, label: string) => {
      const parts = [label, scope.year ?? year ?? undefined, tripType ?? undefined].filter(
        (part): part is string | number => part !== undefined && part !== null,
      );
      onDrill(
        { ...scope, year: scope.year ?? year ?? undefined, tripType: tripType ?? undefined, metric },
        parts.join(" · "),
      );
    },
    [onDrill, year, tripType, metric],
  );

  const clearFilters = useCallback(() => {
    setYear(null);
    setTripType(null);
    setContinent(null);
  }, []);

  return (
    <div className="absolute inset-0 bg-bg">
      <div className="scroll-area absolute inset-0" style={{ paddingBottom: bottomInset }}>
        <div className="mx-auto w-full max-w-[720px] px-4 sm:max-w-[880px]">
          <header
            className="pb-2"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
            <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] text-ink">
              Stats
            </h1>
            {loading ? (
              <div className="mt-2.5 flex gap-2" aria-hidden="true">
                <div className="skeleton h-4 w-32 rounded" />
              </div>
            ) : !isEmpty ? (
              /* The scope, under the title, where iOS puts it — so the numbers
                 below never have to be read to find out what they are about. */
              <p className="mt-1.5 text-[14px] text-ink-2">{lensLabel}</p>
            ) : null}
          </header>

          {loading ? (
            <div className="space-y-2 pt-2" aria-hidden="true">
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="skeleton h-[86px] w-full rounded-[18px]" />
                ))}
              </div>
              <div className="skeleton h-40 w-full rounded-[18px]" />
            </div>
          ) : isEmpty ? (
            <EmptyState
              className="pt-8"
              icon={<Compass size={28} aria-hidden="true" />}
              title="Numbers need journeys"
              description="Save the places you’ve been — the shape of your travelling year builds itself here."
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
            <>
              {/*
                One row of chrome, pinned below the status bar. The years are
                out here because they are what people move; everything else is
                behind the button, which wears a dot when it is holding
                something.
              */}
              <div
                className="sticky z-10 -mx-4 mb-1 bg-bg/85 px-4 pb-2.5 pt-1 backdrop-blur-xl"
                style={{ top: "env(safe-area-inset-top, 0px)" }}
              >
                <div className="flex items-center gap-2">
                  <div className="scrollbar-none -ml-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pl-4">
                    <Chip active={year === null} label="All time" onPress={() => setYear(null)} />
                    {years.map((option) => (
                      <Chip
                        key={option}
                        active={year === option}
                        label={String(option)}
                        onPress={() => setYear(year === option ? null : option)}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setFiltersOpen(true)}
                    aria-label="Filter your stats"
                    className={cn(
                      "pressable relative grid size-10 shrink-0 place-items-center rounded-sm",
                      "transition-colors",
                      filtersActive ? "bg-accent-soft text-accent" : "bg-fill text-ink-2",
                    )}
                  >
                    <SlidersHorizontal size={18} aria-hidden="true" />
                    {filtersActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-1 top-1 size-2 rounded-full bg-accent"
                      />
                    ) : null}
                  </button>
                </div>
              </div>

              {filteredEmpty ? (
                <div className="mt-4 rounded-[18px] bg-fill/60 px-4 py-8 text-center">
                  <p className="text-[15px] leading-relaxed text-ink-2">
                    Nothing matches this lens — no{" "}
                    {tripType ? `${tripType.toLowerCase()} ` : ""}
                    {year ? `trips in ${year}` : "trips"}
                    {continent ? ` in ${continent}` : ""} yet.
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="pressable mt-3 min-h-10 rounded-pill px-4 text-[15px] font-medium text-accent"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <motion.div
                  key={`${year ?? "all"}-${tripType ?? "any"}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.3, 1] }}
                  className="pb-4"
                >
                  <SummaryCard
                    totals={board.totals}
                    previous={board.previous}
                    metric={metric}
                    onMetricChange={setMetric}
                  />

                  {hasHighlights ? (
                    <Section title="Highlights">
                      <HighlightGrid
                        board={board}
                        metric={metric}
                        year={year}
                        onOpenPlace={onOpenPlace}
                      />
                    </Section>
                  ) : null}

                  {/* What's next only makes sense outside a past year. */}
                  {year === null &&
                  (board.upcoming.length > 0 || board.wishlist.places > 0) ? (
                    <Section title="On the horizon">
                      <HorizonCard
                        upcoming={board.upcoming}
                        wishlist={board.wishlist}
                        onOpenPlace={onOpenPlace}
                      />
                    </Section>
                  ) : null}

                  {hasMonths ? (
                    <Section
                      title="When you travel"
                      aside={
                        <span className="text-[14px] text-ink-3">
                          {metric === "days" ? "days away" : "trips"}
                        </span>
                      }
                    >
                      <RhythmCard months={board.months} metric={metric} />
                    </Section>
                  ) : null}

                  {board.years.length > 0 ? (
                    <Section
                      title="Year by year"
                      aside={
                        year !== null ? (
                          <span className="text-[14px] text-ink-3">all years</span>
                        ) : null
                      }
                    >
                      <SegmentedControl
                        ariaLabel="Show years as"
                        className="mb-2.5 max-w-[240px]"
                        value={yearView}
                        onChange={setYearView}
                        options={[
                          {
                            value: "bars",
                            label: "Trend",
                            icon: <TrendingUp size={15} aria-hidden="true" />,
                          },
                          {
                            value: "grid",
                            label: "By country",
                            icon: <Grid3x3 size={15} aria-hidden="true" />,
                          },
                        ]}
                      />
                      {yearView === "bars" ? (
                        <div className="rounded-[18px] bg-fill/60 p-3">
                          <YearBars
                            years={board.years}
                            metric={metric}
                            selected={year}
                            onSelect={setYear}
                          />
                          <p className="mt-1.5 px-1 text-[12px] leading-snug text-ink-3">
                            Tap a year to look through it. A dot marks the years that
                            added a country you had never been to.
                          </p>
                        </div>
                      ) : matrix.years.length > 0 ? (
                        <HeatMatrix
                          matrix={matrix}
                          metric={metric}
                          onCell={(row, cellYear) =>
                            drill({ level: "country", key: row.key, year: cellYear }, row.label)
                          }
                        />
                      ) : (
                        <p className="rounded-[18px] bg-fill/60 px-3.5 py-4 text-[15px] leading-relaxed text-ink-2">
                          No dated stays to cross with the calendar yet.
                        </p>
                      )}
                    </Section>
                  ) : null}

                  <Section
                    title="Your regulars"
                    aside={
                      <span className="text-[14px] text-ink-3">
                        {year !== null || filtersActive ? "more than once" : "been more than once"}
                      </span>
                    }
                  >
                    {regulars.length === 0 ? (
                      <p className="rounded-[18px] bg-fill/60 px-3.5 py-4 text-[15px] leading-relaxed text-ink-2">
                        {filtersActive || year !== null
                          ? "No repeats under this lens — every stay here was a first."
                          : "No repeats yet. The first place you go back to starts the board."}
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
                            lead={metric}
                            onPress={() => onOpenPlace(tally.place.id)}
                          />
                        ))}
                      </div>
                    )}
                  </Section>

                  <Section
                    title="Where you keep going"
                    aside={
                      <span className="text-[14px] tabular-nums text-ink-3">
                        {/* "3 of 195" is only true of the whole world; inside a
                            region the denominator would be a different number
                            nobody knows, so the claim is dropped instead. */}
                        {continent === null
                          ? `${insights.countries.length} of ${COUNTRIES_IN_THE_WORLD} countries`
                          : `${insights.countries.length} ${
                              insights.countries.length === 1 ? "country" : "countries"
                            }`}
                      </span>
                    }
                  >
                    <div className="mb-2.5">
                      <ContinentStrip
                        visited={continentPlaces}
                        selected={continent}
                        onSelect={setContinent}
                      />
                    </div>

                    <SegmentedControl
                      ariaLabel="Roll travel up by"
                      className="mb-2.5"
                      value={level}
                      onChange={(next) => {
                        setLevel(next);
                        setRollupExpanded(false);
                      }}
                      options={[
                        { value: "country", label: "Countries" },
                        { value: "continent", label: "Continents" },
                      ]}
                    />

                    <div className="divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
                      {rollupRows.map((row) => (
                        <LevelRow
                          key={row.key}
                          row={row}
                          level={level}
                          lead={metric}
                          share={(metric === "days" ? row.days : row.stays) / rollupTop}
                          onPress={() => drill({ level, key: row.key }, row.label)}
                        />
                      ))}

                      {rollup.length > ROLLUP_PREVIEW ? (
                        <button
                          type="button"
                          onClick={() => setRollupExpanded((open) => !open)}
                          aria-expanded={rollupExpanded}
                          className="min-h-11 w-full px-3.5 text-left text-[15px] font-medium text-accent transition-colors active:bg-fill-strong"
                        >
                          {rollupExpanded
                            ? "Show fewer"
                            : `Show all ${rollup.length} ${
                                level === "country" ? "countries" : "continents"
                              }`}
                        </button>
                      ) : null}
                    </div>
                  </Section>
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Keeps scrolling content from running into the status bar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-bg/85 backdrop-blur-xl"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />

      <StatsFilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        metric={metric}
        onMetricChange={setMetric}
        year={year}
        onYearChange={setYear}
        years={years}
        continent={continent}
        onContinentChange={setContinent}
        continents={continents}
        tripType={tripType}
        onTripTypeChange={setTripType}
        tripTypes={tripTypes}
      />
    </div>
  );
}

/** One pill of the year rail. */
function Chip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={cn(
        "pressable inline-flex min-h-9 shrink-0 items-center rounded-pill px-3",
        "text-[13.5px] font-medium tabular-nums transition-colors",
        active ? "bg-accent text-on-accent" : "bg-fill text-ink-2",
      )}
    >
      {label}
    </button>
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
