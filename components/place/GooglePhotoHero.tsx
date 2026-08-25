"use client";

import { useEffect, useState } from "react";

import { fetchGooglePhotoUri } from "@/lib/maps/placeDetails";

/**
 * Google's photograph of the place, standing in while the journal has none.
 *
 * A place saved without a picture used to open on nothing but its name; when
 * the listing carries photographs, the first of them makes a perfectly good
 * hero until a real memory replaces it. It is display-only — not part of the
 * journal, so no viewer, no cover, no delete — and it wears the
 * photographer's name and where it came from, which Google's policies require
 * to travel with the picture. Until the picture resolves there is simply no
 * hero, exactly as before; failure costs nothing.
 */
export function GooglePhotoHero({
  googlePlaceId,
  photoName,
  photoBy,
  photoByUri,
  placeName,
}: {
  googlePlaceId: string;
  /** The photo's resource name from the listing, resolved to a URL on use. */
  photoName: string;
  /** Who took it, and their Maps profile when Google offers one. */
  photoBy?: string;
  photoByUri?: string;
  placeName: string;
}) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    fetchGooglePhotoUri(googlePlaceId, photoName, { signal: controller.signal })
      .then((found) => {
        if (alive && found) setUri(found);
      })
      .catch(() => {
        // An aborted lookup is a closed card; a failed one is just no hero.
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [googlePlaceId, photoName]);

  if (!uri) return null;

  return (
    <figure className="relative mb-4 overflow-hidden rounded-[22px] bg-fill">
      <img
        src={uri}
        alt={`Photo of ${placeName} from Google Maps`}
        draggable={false}
        className="aspect-[16/10] w-full object-cover"
      />
      <figcaption className="absolute bottom-2.5 left-2.5 flex max-w-[85%] items-center gap-1 rounded-pill bg-black/55 px-2.5 py-1 text-[11.5px] font-medium text-white backdrop-blur-sm">
        {photoBy ? (
          <>
            {photoByUri ? (
              <a
                href={photoByUri}
                target="_blank"
                rel="noreferrer"
                className="truncate underline decoration-white/40 underline-offset-2"
              >
                {photoBy}
              </a>
            ) : (
              <span className="truncate">{photoBy}</span>
            )}
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span className="shrink-0">Google Maps</span>
      </figcaption>
    </figure>
  );
}
