"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchGooglePhotoUri,
  forgetGooglePhotoUri,
  type GooglePhotoRef,
} from "@/lib/maps/placeDetails";
import { cn } from "@/lib/utils/cn";

/**
 * Google's photographs of the place, standing in while the journal has none.
 *
 * A place saved without a picture used to open on nothing but its name; when
 * the listing carries photographs, the first leads as the hero and up to two
 * more sit under it. Every picture is display-only — not part of the journal,
 * so no viewer, no cover, no delete — and each wears its photographer's name,
 * which Google's policies require to travel with it. Until the lead resolves
 * there is simply no hero, exactly as before; the strip's boxes are reserved
 * from the start, so pictures arrive into place rather than pushing the page
 * around. Failure anywhere costs nothing but the picture.
 *
 * A place that *does* have a photograph of its own still gets these — as the
 * strip below, inside the Google Maps section — because "Google's pictures of
 * where I've been" should not be a thing only some entries have.
 */

/**
 * Photo name → the address to draw it from, resolved as they arrive.
 *
 * `null` means the lookup came back empty and there is nothing to draw. The
 * one interesting case is the third: an address that *resolved* and then
 * failed to load. Google hands back a signed link with a lifetime, so a
 * cached one can expire between being remembered and being drawn — and the
 * browser is the only thing that finds out. `retry` throws that address away
 * on both sides and asks again, once, which turns a broken box back into a
 * photograph.
 */
function useGooglePhotos(photos: GooglePhotoRef[]): {
  uris: Record<string, string | null>;
  retry: (photoName: string) => void;
} {
  const [uris, setUris] = useState<Record<string, string | null>>({});
  const [attempt, setAttempt] = useState<Record<string, number>>({});

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    for (const photo of photos) {
      fetchGooglePhotoUri(photo.name, { signal: controller.signal })
        .then((uri) => {
          if (alive) setUris((current) => ({ ...current, [photo.name]: uri }));
        })
        .catch(() => {
          // An aborted lookup is a closed card; nothing to record.
        });
    }
    return () => {
      alive = false;
      controller.abort();
    };
    // `attempt` is what a retry bumps; the effect is the one place that fetches.
  }, [photos, attempt]);

  const retry = useCallback((photoName: string) => {
    setAttempt((current) => {
      // Exactly one retry per picture. A second failure is the picture's, not
      // the cache's, and asking a third time would only spend the allowance.
      if (current[photoName]) return current;
      forgetGooglePhotoUri(photoName);
      setUris((entries) => {
        const next = { ...entries };
        delete next[photoName];
        return next;
      });
      return { ...current, [photoName]: 1 };
    });
  }, []);

  return { uris, retry };
}

export function GooglePhotoHero({
  photos,
  placeName,
}: {
  /** Up to three of the listing's photos, lead first, already credited. */
  photos: GooglePhotoRef[];
  placeName: string;
}) {
  const { uris, retry } = useGooglePhotos(photos);

  const lead = photos[0];
  const leadUri = lead ? uris[lead.name] : null;
  if (!lead || !leadUri) return null;

  const extras = photos.slice(1).filter((photo) => uris[photo.name] !== null);

  return (
    <div className="mb-4">
      <figure className="relative overflow-hidden rounded-[22px] bg-fill">
        <img
          src={leadUri}
          alt={`Photo of ${placeName} from Google Maps`}
          draggable={false}
          onError={() => retry(lead.name)}
          className="aspect-[16/10] w-full object-cover"
        />
        <Credit by={lead.by} byUri={lead.byUri} withSource />
      </figure>

      {extras.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {extras.map((photo, index) => {
            const uri = uris[photo.name];
            return (
              <figure
                key={photo.name}
                className={cn(
                  "relative overflow-hidden rounded-[14px] bg-fill",
                  extras.length === 1 && index === 0 && "col-span-2",
                )}
              >
                {uri ? (
                  <img
                    src={uri}
                    alt={`Photo of ${placeName} from Google Maps`}
                    loading="lazy"
                    draggable={false}
                    onError={() => retry(photo.name)}
                    className="aspect-[2/1] w-full object-cover"
                  />
                ) : (
                  <div className="skeleton aspect-[2/1] w-full" aria-hidden="true" />
                )}
                {uri ? <Credit by={photo.by} byUri={photo.byUri} /> : null}
              </figure>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The same photographs, as a row rather than a hero.
 *
 * This is what a place that already leads with the traveller's own picture
 * gets: Google's pictures where they belong, inside the Google Maps section,
 * beneath the rating and above the reviews — present on every place, and
 * never competing with the photograph that is actually a memory.
 */
export function GooglePhotoStrip({
  photos,
  placeName,
}: {
  photos: GooglePhotoRef[];
  placeName: string;
}) {
  const { uris, retry } = useGooglePhotos(photos);
  // Nothing resolved and nothing still trying: draw no empty row at all.
  const shown = photos.filter((photo) => uris[photo.name] !== null);
  if (shown.length === 0) return null;

  return (
    <div>
      <h4 className="pb-1.5 text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-3">
        Photos
      </h4>
      {/* Scrolls rather than shrinks: three pictures squeezed onto a phone's
          width are three thumbnails of nothing. Aligned with the card above
          rather than bled to the window — the sheet's own padding is not 16px,
          so a bleed left a four-pixel sliver that read as a mistake. */}
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {shown.map((photo) => {
          const uri = uris[photo.name];
          return (
            <figure
              key={photo.name}
              className="relative w-[72%] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-[16px] bg-fill"
            >
              {uri ? (
                <img
                  src={uri}
                  alt={`Photo of ${placeName} from Google Maps`}
                  loading="lazy"
                  draggable={false}
                  onError={() => retry(photo.name)}
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="skeleton aspect-[4/3] w-full" aria-hidden="true" />
              )}
              {uri ? <Credit by={photo.by} byUri={photo.byUri} /> : null}
            </figure>
          );
        })}
      </div>
    </div>
  );
}

/** The credit riding the picture: the photographer, and where it came from. */
function Credit({ by, byUri, withSource }: { by?: string; byUri?: string; withSource?: boolean }) {
  if (!by && !withSource) return null;
  return (
    <figcaption
      className={cn(
        "absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1 rounded-pill bg-black/55 px-2 py-0.5 font-medium text-white backdrop-blur-sm",
        withSource ? "bottom-2.5 left-2.5 px-2.5 py-1 text-[11.5px]" : "text-[10.5px]",
      )}
    >
      {by ? (
        byUri ? (
          <a
            href={byUri}
            target="_blank"
            rel="noreferrer"
            className="truncate underline decoration-white/40 underline-offset-2"
          >
            {by}
          </a>
        ) : (
          <span className="truncate">{by}</span>
        )
      ) : null}
      {by && withSource ? <span aria-hidden="true">·</span> : null}
      {withSource ? <span className="shrink-0">Google Maps</span> : null}
    </figcaption>
  );
}
