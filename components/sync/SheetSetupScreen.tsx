"use client";

import { Sheet } from "lucide-react";

import { SheetConnectionForm } from "@/components/sync/SheetConnectionForm";
import type { SheetConnection } from "@/lib/sheets/connection";

/**
 * The one-time gate, shown on a browser that hasn't been told where the sheet
 * is. Everything the app renders comes from the sheet, so there is nothing
 * truthful to show behind this until it is filled in.
 */
export function SheetSetupScreen({
  onConnected,
}: {
  onConnected: (connection: SheetConnection) => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-7">
        <span
          aria-hidden="true"
          className="mb-5 grid size-12 place-items-center rounded-md bg-accent-soft text-accent"
        >
          <Sheet size={22} />
        </span>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">
          Connect your sheet
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          Your places live in a Google Sheet, so every browser shows the same data. Paste the
          web app address and access code once and this device is set up for good.
        </p>
      </div>

      <SheetConnectionForm initial={null} submitLabel="Connect" onConnected={onConnected} />

      <p className="mt-6 text-[13px] leading-relaxed text-ink-3">
        Nothing here is stored in the site itself — the site is public, so the address and code
        stay in this browser only.
      </p>
    </main>
  );
}
