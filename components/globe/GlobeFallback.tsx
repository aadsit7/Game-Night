"use client";

import { Globe2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * Shown instead of the map when Mapbox can't run — no token, a blocked
 * network, a style that failed to load. It stays on-brand rather than looking
 * like a crash, and it says exactly what to do next. The Places view keeps
 * working the whole time.
 */
export function GlobeFallback({
  reason,
  onRetry,
}: {
  reason: "missing-token" | "load-failed";
  onRetry?: () => void;
}) {
  const missingToken = reason === "missing-token";

  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-[#080b14] px-8 text-center">
      {/* A quiet stand-in for the Earth, drawn in CSS so it always renders. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 size-[min(78vw,420px)] -translate-x-1/2 -translate-y-[62%] rounded-full opacity-70"
          style={{
            background:
              "radial-gradient(circle at 34% 28%, #2f4a7a 0%, #1a2b4d 46%, #0c1428 78%, #080b14 100%)",
            boxShadow: "0 0 90px 20px rgba(60,110,190,0.16)",
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 size-[min(78vw,420px)] -translate-x-1/2 -translate-y-[62%] rounded-full opacity-25"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, rgba(255,255,255,0.35) 0 1px, transparent 1px 34px)",
            maskImage: "radial-gradient(circle at 50% 50%, black 62%, transparent 72%)",
            WebkitMaskImage: "radial-gradient(circle at 50% 50%, black 62%, transparent 72%)",
          }}
        />
        {/* Keeps the artwork from competing with the words in front of it. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(90% 55% at 50% 62%, rgba(8,11,20,0.9) 0%, rgba(8,11,20,0.55) 55%, rgba(8,11,20,0) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 max-w-[32rem] pb-16">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-[18px] bg-white/10 text-white/80">
          <Globe2 size={26} aria-hidden="true" />
        </div>

        <h2 className="text-balance text-[24px] font-semibold tracking-[-0.02em] text-white">
          {missingToken ? "The globe needs a map key" : "The globe couldn’t load"}
        </h2>

        <p className="mx-auto mt-2.5 max-w-[36ch] text-balance text-[15px] leading-relaxed text-white/60">
          {missingToken
            ? "Add a Mapbox public token and the Earth will appear here. Everything else — your places, search, adding and editing — keeps working."
            : "Something went wrong reaching the map service. Your places are safe, and the Places tab still works."}
        </p>

        {missingToken ? (
          <div className="mx-auto mt-5 w-fit max-w-full overflow-x-auto rounded-[14px] border border-white/10 bg-black/40 px-4 py-3 text-left">
            <code className="whitespace-pre text-[12.5px] leading-relaxed text-white/70">
              {"# .env.local\nNEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.…"}
            </code>
          </div>
        ) : onRetry ? (
          <div className="mt-6 flex justify-center">
            <Button
              variant="secondary"
              size="lg"
              icon={<RefreshCw size={17} />}
              onClick={onRetry}
              className="bg-white/12 text-white"
            >
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
