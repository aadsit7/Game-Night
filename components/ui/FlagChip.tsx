"use client";

import { useSyncExternalStore } from "react";
import { Compass, Heart, Star } from "lucide-react";

import {
  FLAG_INK_RISE,
  FLAG_OVERSCAN,
  countryInitials,
  flagEmoji,
  flagEmojiSupported,
  flagTint,
  type FlagVariant,
} from "@/lib/ui/flags";
import { cn } from "@/lib/utils/cn";

/**
 * A country, as a circular crop of its flag inside a white ring.
 *
 * This is the same mark the globe draws over the Earth, in DOM rather than in
 * WebGL, and it exists so that the two can never drift: a place looks like
 * itself whether you meet it on the planet, in a list, in a trip or in a
 * search result. The ring is not decoration — it is what lets a saturated flag
 * sit on a photograph, on a card, or on the ocean without dissolving into it.
 *
 * Sizes are fixed rather than free, because a chip that can be any size stops
 * being a recognisable mark. Three: `sm` runs inside a line of text, `md` sits
 * beside a name, `lg` heads a sheet.
 */

export type FlagChipSize = "sm" | "md" | "lg";

/** Nothing to subscribe to: whether the platform has flags cannot change. */
const noSubscription = () => () => {};

/**
 * Whether this platform can draw a flag, as an external store.
 *
 * The probe needs a canvas, which the server does not have, so the answer is
 * read the way every other browser fact in this app is read — with a defined
 * server snapshot, so nothing mismatches during hydration. Platforms that do
 * have flags paint them on the first frame; only Windows swaps, once, to the
 * letters.
 */
function useFlagEmojiSupport(): boolean {
  return useSyncExternalStore(noSubscription, flagEmojiSupported, () => true);
}

const GEOMETRY: Record<FlagChipSize, { box: number; ring: number; badge: number }> = {
  sm: { box: 18, ring: 1.5, badge: 0 },
  md: { box: 26, ring: 2, badge: 13 },
  lg: { box: 36, ring: 2.5, badge: 16 },
};

export function FlagChip({
  countryCode,
  variant = "visited",
  size = "sm",
  className,
  style,
  title,
}: {
  countryCode?: string;
  /** Adds the small badge that says favourite or still-to-go. */
  variant?: FlagVariant;
  size?: FlagChipSize;
  className?: string;
  /** Layout only — the chip owns its own size and colour. */
  style?: React.CSSProperties;
  /** Screen-reader name. Omit for a chip that only repeats adjacent text. */
  title?: string;
}) {
  const supported = useFlagEmojiSupport();

  const emoji = flagEmoji(countryCode);
  const initials = countryInitials(countryCode);
  const { box, ring, badge } = GEOMETRY[size];

  const a11y = title
    ? ({ role: "img" as const, "aria-label": title })
    : ({ "aria-hidden": true as const });

  return (
    <span
      {...a11y}
      className={cn("relative inline-grid shrink-0 place-items-center align-middle", className)}
      style={{ width: box, height: box, ...style }}
    >
      <span
        className="relative grid size-full place-items-center overflow-hidden rounded-full bg-fill-strong"
        style={{
          /* Ring, hairline, shadow. The hairline is what keeps a white flag —
             Japan's is mostly white, Finland's nearly all of it — from
             dissolving into a white ring on a pale card. */
          boxShadow: [
            `0 0 0 ${ring}px var(--c-chip-ring)`,
            `0 0 0 ${ring + 0.5}px rgba(16, 20, 28, 0.1)`,
            "0 1px 3px rgba(12, 16, 22, 0.2)",
          ].join(", "),
          // The tint stands in for a flag we cannot draw; where we can, the
          // flag itself covers the disc and this never shows.
          background: emoji && supported ? undefined : flagTint(countryCode),
        }}
      >
        {emoji && supported ? (
          /* Absolute, not laid out: a text node wider than the disc is clipped
             against the start edge of a scroll container rather than centred in
             it, which cropped every flag off-centre while looking correct in
             the markup. */
          <span
            aria-hidden="true"
            className="pointer-events-none absolute select-none leading-none"
            style={{
              fontSize: box * FLAG_OVERSCAN,
              lineHeight: 1,
              left: "50%",
              top: "50%",
              transform: `translate(-50%, calc(-50% + ${FLAG_INK_RISE}em))`,
            }}
          >
            {emoji}
          </span>
        ) : initials ? (
          <span
            aria-hidden="true"
            className="select-none font-semibold text-white"
            style={{ fontSize: Math.round(box * 0.42), letterSpacing: "-0.02em" }}
          >
            {initials}
          </span>
        ) : (
          // Somewhere with no country at all — a mid-ocean pin, a place saved
          // before geocoding knew what to call it.
          <Compass size={Math.round(box * 0.52)} aria-hidden="true" className="text-white" />
        )}
      </span>

      {badge > 0 && variant !== "visited" ? (
        /* The badge takes the colour that state already has *in the app* —
           danger red for a favourite, accent for somewhere still to go — rather
           than the globe sprite's. On the Earth the accent is the selection
           colour and a wish has to be told apart from a tap; in a list nothing
           competes for it, and matching the "Want to go" pill beside it matters
           more than matching a mark on another screen. */
        <span
          aria-hidden="true"
          className={cn(
            "absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full text-white",
            variant === "favorite" ? "bg-danger" : "bg-accent",
          )}
          style={{
            width: badge,
            height: badge,
            boxShadow: `0 0 0 ${ring}px var(--c-chip-ring)`,
          }}
        >
          {variant === "favorite" ? (
            <Heart size={Math.round(badge * 0.6)} fill="currentColor" aria-hidden="true" />
          ) : (
            <Star size={Math.round(badge * 0.62)} fill="currentColor" aria-hidden="true" />
          )}
        </span>
      ) : null}
    </span>
  );
}
