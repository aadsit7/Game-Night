"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DEFAULT_MEDIA_CODE, saveMediaCode, storedMediaCode } from "@/lib/photos/mediaCode";

/**
 * Typing the private media access code, once per device.
 *
 * This is the key to viewing already-imported photo bytes — deliberately not
 * Google Photos OAuth, and deliberately not the shared sheet code that ships
 * in the public bundle. It lives in Apps Script Script Properties and in the
 * browsers it has been typed into, nowhere else.
 */
export function MediaCodeSheet({
  open,
  depth,
  onClose,
  onSaved,
}: {
  open: boolean;
  depth?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");

  // Re-opening starts from what this device was actually given — the field
  // stays empty while the standard default is doing the work.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setCode(storedMediaCode());
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      depth={depth}
      label="Media access code"
      header={
        <div className="flex items-center justify-between gap-3 pb-2 pt-1">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Media access code
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-autofocus
            className="pressable -mr-1 rounded-pill px-2 py-1 text-[16px] font-medium text-accent"
          >
            Cancel
          </button>
        </div>
      }
      footer={
        <Button
          block
          size="lg"
          disabled={code.trim().length === 0}
          onClick={() => {
            saveMediaCode(code);
            onSaved();
            onClose();
          }}
        >
          Save on this device
        </Button>
      }
    >
      <div className="space-y-4 pb-4">
        <p className="flex items-start gap-2 text-[14.5px] leading-relaxed text-ink-2">
          <KeyRound size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          Your photos live in a private Drive folder, behind this code. Out of
          the box it is simply {DEFAULT_MEDIA_CODE} and nothing needs entering —
          this sheet is for a script whose owner set their own
          MEDIA_ACCESS_CODE. Enter it once; it stays in this browser only.
        </p>
        <input
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste the media access code"
          className="min-h-12 w-full rounded-sm bg-fill px-3.5 text-[16px] text-ink placeholder:text-ink-3"
        />
      </div>
    </BottomSheet>
  );
}
