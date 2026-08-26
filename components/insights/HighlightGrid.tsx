"use client";

import type { ReactNode } from "react";
import { CalendarRange, Clock3, Globe, Milestone, Route, Ruler, Timer } from "lucide-react";

import { formatDistance, useDistanceUnit } from "@/lib/hooks/useDistanceUnit";
import { MONTH_NAMES } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { TravelDashboard } from "@/lib/insights/dashboard";
import type { InsightMetric } from "@/lib/insights/insights";

/**
 * The facts a leaderboard can't hold: how long a trip of yours usually is,
 * when in the year you go, how far you have got from home, how long it has
 * been.
 *
 * Six small tiles, two to a row, because these are the answers people give
 * each other out loud — "my longest was ten days", "I always go in July" —
 * and none of them is a ranking. Anything the journal cannot answer simply
 * isn't drawn: an empty tile saying "—" is a worse answer than no tile.
 */
export function HighlightGrid({
  board,
  metric,
  year,
  onOpenPlace,
}: {
  board: TravelDashboard;
  metric: InsightMetric;
  /** The year in the lens, which decides what the fourth tile is about. */
  year: number | null;
  onOpenPlace: (id: string) => void;
}) {
  const unit = useDistanceUnit();
  const tiles: ReactNode[] = [];

  if (board.longest) {
    const { place, days } = board.longest;
    tiles.push(
      <Tile
        key="longest"
        icon={<Timer size={13} aria-hidden="true" />}
        label="Longest trip"
        value={`${days} ${days === 1 ? "day" : "days"}`}
        caption={[place.name, board.longest.label].filter(Boolean).join(" · ")}
        onPress={() => onOpenPlace(place.id)}
      />,
    );
  }

  if (board.typicalDays > 0) {
    tiles.push(
      <Tile
        key="typical"
        icon={<Clock3 size={13} aria-hidden="true" />}
        label="Typical trip"
        value={`${board.typicalDays} ${board.typicalDays === 1 ? "day" : "days"}`}
        caption={
          board.totals.trips === 1
            ? "from a single trip"
            : `the middle of ${board.totals.trips} trips`
        }
      />,
    );
  }

  if (board.busiestMonth) {
    const month = board.busiestMonth;
    const days = `${month.days} ${month.days === 1 ? "day" : "days"} away`;
    const trips = `${month.trips} ${month.trips === 1 ? "trip" : "trips"}`;
    tiles.push(
      <Tile
        key="month"
        icon={<CalendarRange size={13} aria-hidden="true" />}
        label="Busiest month"
        value={MONTH_NAMES[month.month]}
        caption={metric === "days" ? days : trips}
      />,
    );
  }

  if (year !== null) {
    tiles.push(
      <Tile
        key="new"
        icon={<Globe size={13} aria-hidden="true" />}
        label="New countries"
        value={String(board.newCountries)}
        caption={
          board.newCountries === 0
            ? `nowhere new in ${year}`
            : `first seen in ${year}`
        }
      />,
    );
  } else if (board.span) {
    const years = board.span.to - board.span.from + 1;
    tiles.push(
      <Tile
        key="span"
        icon={<Route size={13} aria-hidden="true" />}
        label="Travelling for"
        value={`${years} ${years === 1 ? "year" : "years"}`}
        caption={`since ${board.span.from}`}
      />,
    );
  }

  if (board.furthest) {
    const { place, km, fromHome } = board.furthest;
    tiles.push(
      <Tile
        key="furthest"
        icon={<Ruler size={13} aria-hidden="true" />}
        label={fromHome ? "Furthest from home" : "Furthest flung"}
        value={formatDistance(km, unit)}
        caption={
          fromHome && board.home
            ? `${place.name} · from ${board.home.city ?? board.home.name}`
            : `${place.name} · from the middle of your map`
        }
        onPress={() => onOpenPlace(place.id)}
      />,
    );
  }

  if (board.last) {
    const { place, label, daysAgo } = board.last;
    tiles.push(
      <Tile
        key="last"
        icon={<Milestone size={13} aria-hidden="true" />}
        label="Last trip"
        value={label ?? place.name}
        caption={[place.name, agoLabel(daysAgo)].filter(Boolean).join(" · ")}
        onPress={() => onOpenPlace(place.id)}
      />,
    );
  }

  if (tiles.length === 0) return null;

  return <div className="grid grid-cols-2 gap-2">{tiles}</div>;
}

/** "today", "yesterday", "9 days ago", "4 months ago", "2 years ago". */
function agoLabel(daysAgo: number | null): string | null {
  if (daysAgo === null || daysAgo < 0) return null;
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 45) return `${daysAgo} days ago`;
  const months = Math.round(daysAgo / 30.44);
  if (months < 18) return `${months} months ago`;
  const years = Math.round(daysAgo / 365.25);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function Tile({
  icon,
  label,
  value,
  caption,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption?: string | null;
  onPress?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1 text-[12px] font-medium leading-none text-ink-3">
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1.5 block truncate text-[19px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-ink">
        {value}
      </span>
      {caption ? (
        <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-ink-3">
          {caption}
        </span>
      ) : null}
    </>
  );

  const shell = "block w-full rounded-[18px] bg-fill/60 px-3.5 py-3 text-left";

  if (!onPress) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onPress}
      className={cn("pressable transition-colors active:bg-fill-strong", shell)}
    >
      {body}
    </button>
  );
}
