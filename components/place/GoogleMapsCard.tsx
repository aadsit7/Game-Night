"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Map as MapIcon, Navigation, Phone, Star } from "lucide-react";

import { googleMapsDirectionsUrl, googleMapsUrl } from "@/lib/maps/googleMapsLinks";
import {
  autoLinkGooglePlace,
  fetchGoogleDetails,
  hasGoogleDetails,
  localTimeAt,
  type GooglePlaceDetails,
} from "@/lib/maps/placeDetails";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";

/**
 * The place as Google Maps knows it, inside the card.
 *
 * Rating, whether it is open right now, what it is, the local time there, the
 * address, and ways through to the website and phone — the questions a person
 * actually has about somewhere they have been or want to go. All of it is
 * best-effort: with no key, no listing, or no answer, the section quietly
 * shrinks to the two buttons, which work for every place.
 *
 * The section title doubles as the attribution Google's policies ask for when
 * their data is shown without one of their maps.
 */
export function GoogleMapsCard({
  place,
  onLinked,
}: {
  place: VisitedPlace;
  /** A confident match for an unlinked place was found; persist it. */
  onLinked?: (googlePlaceId: string) => void;
}) {
  const [details, setDetails] = useState<GooglePlaceDetails | null>(null);
  const [loading, setLoading] = useState(false);

  // The callback identity changes every render (the sheet closes over the
  // place), but a new callback is not a reason to look the listing up again —
  // a ref keeps the latest one without it steering the effect.
  const onLinkedRef = useRef(onLinked);
  useEffect(() => {
    onLinkedRef.current = onLinked;
  }, [onLinked]);

  const placeId = place.id;
  const googlePlaceId = place.googlePlaceId;

  useEffect(() => {
    if (!hasGoogleDetails()) return;

    const controller = new AbortController();
    let alive = true;

    const load = async () => {
      setLoading(true);
      try {
        let id = googlePlaceId;
        if (!id) {
          // Saved before listings were captured: one search, biased to the
          // pin, taken only on a confident match — then remembered, so the
          // journal's back catalogue lights up one card at a time.
          const linked = await autoLinkGooglePlace(place);
          if (!linked) return;
          // Persist even if the card has closed meanwhile: the search is
          // already answered, and keeping it is the whole point.
          onLinkedRef.current?.(linked);
          if (!alive) return;
          id = linked;
        }

        const found = await fetchGoogleDetails(id, { signal: controller.signal });
        if (alive) setDetails(found);
      } catch {
        // An aborted lookup is a closed card, not a problem to report.
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();
    return () => {
      alive = false;
      controller.abort();
    };
    // The card refetches when it shows a different place or a new link lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, googlePlaceId]);

  const facts = details ? factLines(details) : [];
  const website = details?.website;
  const phone = details?.phone;
  const showCard = loading || facts.length > 0 || Boolean(website || phone);

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        {/* "Google Maps", verbatim — the section name and the attribution. */}
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Google Maps</h3>
        {details?.rating !== undefined ? (
          <span className="flex items-center gap-1 text-[14px] text-ink-2">
            <Star size={13} aria-hidden="true" className="text-accent" fill="currentColor" />
            <span className="font-semibold tabular-nums text-ink">
              {details.rating.toFixed(1)}
            </span>
            {details.ratingCount ? (
              <span className="tabular-nums text-ink-3">
                ({details.ratingCount.toLocaleString()})
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {showCard ? (
        <div className="mb-2.5 divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
          {loading && facts.length === 0 ? (
            <div className="space-y-2 px-3.5 py-3" aria-hidden="true">
              <div className="skeleton h-4 w-2/3 rounded" />
              <div className="skeleton h-4 w-1/2 rounded" />
            </div>
          ) : facts.length > 0 ? (
            <div className="space-y-1 px-3.5 py-3">
              {facts.map((line) => (
                <p
                  key={line.text}
                  className={cn(
                    "text-[15px] leading-snug",
                    line.tone === "danger" ? "font-medium text-danger" : "text-ink-2",
                  )}
                >
                  {line.text}
                </p>
              ))}
            </div>
          ) : null}

          {website ? (
            <LinkRow
              icon={<Globe size={16} aria-hidden="true" />}
              label="Website"
              value={websiteLabel(website)}
              href={website}
              external
            />
          ) : null}
          {phone ? (
            <LinkRow
              icon={<Phone size={16} aria-hidden="true" />}
              label="Phone"
              value={phone}
              href={`tel:${phone.replace(/[^+\d]/g, "")}`}
            />
          ) : null}
        </div>
      ) : null}

      {/* The same spot on everyone's map. With a listing behind it, either
          button opens the real entry rather than a pin at the coordinates. */}
      <div className="flex gap-2.5">
        <a
          href={googleMapsUrl(place)}
          target="_blank"
          rel="noreferrer"
          className="pressable flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-md bg-fill text-[16px] font-medium text-ink"
        >
          <MapIcon size={17} aria-hidden="true" />
          Google Maps
        </a>
        <a
          href={googleMapsDirectionsUrl(place)}
          target="_blank"
          rel="noreferrer"
          className="pressable flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-md bg-fill text-[16px] font-medium text-ink"
        >
          <Navigation size={16} aria-hidden="true" />
          Directions
        </a>
      </div>
    </section>
  );
}

type FactLine = { text: string; tone?: "danger" };

/**
 * The card's prose, one short line per fact, in the order they matter:
 * whether you can still go, whether it is open right now, what it is and
 * what time it is there, and where it stands.
 */
function factLines(details: GooglePlaceDetails): FactLine[] {
  const lines: FactLine[] = [];

  if (details.permanentlyClosed) {
    lines.push({ text: "Permanently closed", tone: "danger" });
  } else if (details.temporarilyClosed) {
    lines.push({ text: "Temporarily closed", tone: "danger" });
  } else if (details.openNow !== undefined) {
    const state = details.openNow ? "Open now" : "Closed now";
    lines.push({
      text: details.todaysHours ? `${state} · ${details.todaysHours}` : state,
    });
  } else if (details.todaysHours) {
    lines.push({ text: `Today · ${details.todaysHours}` });
  }

  const character = [
    details.kind,
    details.utcOffsetMinutes !== undefined
      ? `${localTimeAt(details.utcOffsetMinutes, new Date())} there`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  if (character) lines.push({ text: character });

  if (details.address) lines.push({ text: details.address });

  return lines;
}

/** "toureiffel.paris", not forty characters of path. */
function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One tappable row of the grouped card, in the sheet's own row shape. */
function LinkRow({
  icon,
  label,
  value,
  href,
  external,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-fill-strong"
    >
      <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] leading-tight text-ink-3">{label}</span>
        <span className="mt-[3px] block truncate text-[16px] leading-tight text-accent">
          {value}
        </span>
      </span>
    </a>
  );
}
