"use client";

import { useEffect, useState } from "react";

import { fetchGooglePhotoUri, type GooglePhotoRef } from "@/lib/maps/placeDetails";
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
 */
export function GooglePhotoHero({
  photos,
  placeName,
}: {
  /** Up to three of the listing's photos, lead first, already credited. */
  photos: GooglePhotoRef[];
  placeName: string;
}) {
  /** Photo name → resolved address, or null once a lookup has failed. */
  const [uris, setUris] = useState<Record<string, string | null>>({});

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
  }, [photos]);

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
