"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  Clock,
  Globe,
  Map as MapIcon,
  Navigation,
  PersonStanding,
  Phone,
  Star,
} from "lucide-react";

import { googleMapsDirectionsUrl, googleMapsUrl, googleStreetViewUrl } from "@/lib/maps/googleMapsLinks";
import { sheetPlaceRepository } from "@/lib/storage/sheetPlaceRepository";
import {
  autoLinkGooglePlace,
  fetchGoogleDetails,
  hasGoogleDetails,
  localTimeAt,
  placeWeekdayIndex,
  type GooglePlaceDetails,
  type GoogleReview,
} from "@/lib/maps/placeDetails";
import { GooglePhotoStrip } from "@/components/place/GooglePhotoHero";
import { cn } from "@/lib/utils/cn";
import type { VisitedPlace } from "@/types/place";

/** Stable subscribe/server-snapshot pair for the repository store. */
const subscribeToSheet = (listener: () => void) => sheetPlaceRepository.subscribe(listener);
const never = () => false;

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
  showPhotos,
  onLinked,
  onDetails,
}: {
  place: VisitedPlace;
  /**
   * Carry the listing's photographs here as well.
   *
   * The sheet above leads with Google's picture only when the traveller has
   * none of their own — their memory outranks a stock photograph, and always
   * should. But that used to mean a place *with* a photo showed none of
   * Google's at all, which is the difference between "every place has this"
   * and "some places have this". Set when the hero slot is already taken, and
   * the pictures appear here instead, where nothing is competing for them.
   */
  showPhotos?: boolean;
  /** A confident match for an unlinked place was found; persist it. */
  onLinked?: (googlePlaceId: string) => void;
  /** The listing arrived; the sheet above may want its photograph. */
  onDetails?: (details: GooglePlaceDetails) => void;
}) {
  const [details, setDetails] = useState<GooglePlaceDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);

  /* Whether the sheet can serve listings — subscribed, not asked once: on a
     cold start the capabilities arrive a beat after the app does, and a card
     opened in that beat should fill in when they land, not stay bare until
     it is closed and reopened. */
  const detailsEnabled = useSyncExternalStore(subscribeToSheet, hasGoogleDetails, never);

  // The callback identities change every render (the sheet closes over the
  // place), but a new callback is not a reason to look the listing up again —
  // refs keep the latest ones without steering the effect.
  const onLinkedRef = useRef(onLinked);
  const onDetailsRef = useRef(onDetails);
  useEffect(() => {
    onLinkedRef.current = onLinked;
    onDetailsRef.current = onDetails;
  }, [onLinked, onDetails]);

  const placeId = place.id;
  const googlePlaceId = place.googlePlaceId;

  /* A different place starts with a blank card, always — reset during render
     the way the rest of the app resets on a changed prop, never mid-effect.
     This sheet is reused rather than remounted, so without this a place with
     no listing of its own went on wearing the *previous* place's rating,
     address and reviews: the load below returns early when there is nothing
     to look up, and "early" used to mean "leave what is there". */
  const [shownFor, setShownFor] = useState(placeId);
  if (shownFor !== placeId) {
    setShownFor(placeId);
    setDetails(null);
    setHoursOpen(false);
  }

  useEffect(() => {
    if (!detailsEnabled) return;

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
        if (alive) {
          setDetails(found);
          if (found) onDetailsRef.current?.(found);
        }
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
    // Refetches for a different place, a new link, or capabilities arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, googlePlaceId, detailsEnabled]);

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

          {details?.weekHours ? (
            <div>
              <button
                type="button"
                onClick={() => setHoursOpen((open) => !open)}
                aria-expanded={hoursOpen}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-fill-strong"
              >
                <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent">
                  <Clock size={16} aria-hidden="true" />
                </span>
                <span className="flex-1 text-[15px] text-ink">All hours</span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={cn("shrink-0 text-ink-3 transition-transform", hoursOpen && "rotate-180")}
                />
              </button>
              {hoursOpen ? (
                <ul className="space-y-1 px-3.5 pb-3 pt-0.5">
                  {details.weekHours.map((line, index) => (
                    <li
                      key={line}
                      className={cn(
                        "text-[14px] leading-snug",
                        index === placeWeekdayIndex(details.utcOffsetMinutes, new Date())
                          ? "font-semibold text-ink"
                          : "text-ink-2",
                      )}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
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

      {showPhotos && details?.photos ? (
        <div className="mb-2.5">
          <GooglePhotoStrip photos={details.photos} placeName={place.name} />
        </div>
      ) : null}

      {details?.reviews ? (
        <Reviews
          reviews={details.reviews}
          googleMapsUri={details.googleMapsUri}
          placeName={place.name}
        />
      ) : null}

      {/* The same spot on everyone's map. With a listing behind it, the map
          buttons open the real entry rather than a pin at the coordinates;
          Street View needs no listing at all — it aims at the coordinates. */}
      <div className="flex gap-2">
        <a
          href={googleMapsUrl(place)}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in Google Maps"
          className="pressable flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-md bg-fill text-[15px] font-medium text-ink"
        >
          <MapIcon size={16} aria-hidden="true" />
          Maps
        </a>
        <a
          href={googleMapsDirectionsUrl(place)}
          target="_blank"
          rel="noreferrer"
          className="pressable flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-md bg-fill text-[15px] font-medium text-ink"
        >
          <Navigation size={15} aria-hidden="true" />
          Directions
        </a>
        <a
          href={googleStreetViewUrl(place)}
          target="_blank"
          rel="noreferrer"
          className="pressable flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-md bg-fill text-[15px] font-medium text-ink"
        >
          <PersonStanding size={16} aria-hidden="true" />
          Street View
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

  // Google's own one-liner leads — it is the closest thing the card has to
  // an introduction, and it reads like one.
  if (details.summary) lines.push({ text: details.summary });

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
    details.priceLabel,
    details.utcOffsetMinutes !== undefined
      ? `${localTimeAt(details.utcOffsetMinutes, new Date())} there`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  if (character) lines.push({ text: character });

  if (details.address) lines.push({ text: details.address });
  if (details.wheelchairEntrance) lines.push({ text: "Wheelchair-accessible entrance" });

  return lines;
}

/**
 * What visitors said, the way Google Maps itself shows it: the reviewer's
 * face and name (linked to their profile — the attribution Google's display
 * policies require), their stars, when, and what they wrote. Three at most;
 * the rest live one tap away on the listing.
 */
function Reviews({
  reviews,
  googleMapsUri,
  placeName,
}: {
  reviews: GoogleReview[];
  googleMapsUri?: string;
  placeName: string;
}) {
  return (
    <div className="mb-2.5">
      <div className="flex items-baseline justify-between gap-3 pb-1.5">
        <h4 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          Reviews
        </h4>
        {/* Ranking disclosure, as their policies ask: these are Google's
            most-relevant picks, not the newest or ours. */}
        <span className="text-[12px] text-ink-3">most relevant · Google Maps</span>
      </div>
      <div className="divide-y divide-separator overflow-hidden rounded-[18px] bg-fill/60">
        {reviews.map((review, index) => (
          <div key={`${review.author}-${index}`} className="px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              {review.avatarUrl ? (
                <img
                  src={review.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-7 shrink-0 rounded-full bg-fill object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent"
                >
                  {review.author.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                {review.authorUri ? (
                  <a
                    href={review.authorUri}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-[14px] font-semibold leading-tight text-ink"
                  >
                    {review.author}
                  </a>
                ) : (
                  <span className="block truncate text-[14px] font-semibold leading-tight text-ink">
                    {review.author}
                  </span>
                )}
                <span className="mt-[2px] flex items-center gap-1.5 text-[12px] leading-tight text-ink-3">
                  {review.rating !== undefined ? (
                    <span
                      aria-label={`${review.rating} out of 5 stars`}
                      className="flex items-center gap-[1px] text-accent"
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={10}
                          aria-hidden="true"
                          fill={star <= (review.rating ?? 0) ? "currentColor" : "none"}
                          className={star <= (review.rating ?? 0) ? undefined : "text-ink-3"}
                        />
                      ))}
                    </span>
                  ) : null}
                  {review.when ? <span>{review.when}</span> : null}
                </span>
              </span>
            </div>
            {review.text ? (
              <p className="clamp-3 mt-2 text-[14px] leading-relaxed text-ink-2">{review.text}</p>
            ) : null}
          </div>
        ))}
        {googleMapsUri ? (
          <a
            href={googleMapsUri}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center justify-center text-[14px] font-medium text-accent transition-colors active:bg-fill-strong"
          >
            More reviews of {placeName} on Google Maps
          </a>
        ) : null}
      </div>
    </div>
  );
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
