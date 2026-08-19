"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { validateUrl, type SheetConnection } from "@/lib/sheets/connection";
import { SheetError, ping } from "@/lib/sheets/sheetsClient";
import { cn } from "@/lib/utils/cn";

/**
 * The two things this browser needs to reach the sheet.
 *
 * Neither is in the published code. The site is served from a public
 * repository, so anything committed alongside it is readable by anyone who
 * opens the page — which is exactly why these are typed once per browser and
 * kept in localStorage instead.
 */
export function SheetConnectionForm({
  initial,
  submitLabel,
  onConnected,
}: {
  initial: SheetConnection | null;
  submitLabel: string;
  onConnected: (connection: SheetConnection) => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const connect = async () => {
    const problem = validateUrl(url);
    if (problem) {
      setResult({ ok: false, message: problem });
      return;
    }
    if (!code.trim()) {
      setResult({ ok: false, message: "Enter the access code you set on the script." });
      return;
    }

    const connection: SheetConnection = { url: url.trim(), code: code.trim() };
    setChecking(true);
    setResult(null);

    try {
      // Proving the address and code work before saving them means a typo is
      // caught here, rather than turning into a screen full of travel data
      // that silently never saves.
      await ping(connection);
      setResult({ ok: true, message: "Connected. Loading your data…" });
      onConnected(connection);
    } catch (error) {
      setResult({
        ok: false,
        message:
          error instanceof SheetError
            ? error.message
            : "Couldn’t reach the sheet. Check the address and try again.",
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field
        label="Sheet connection address"
        value={url}
        onChange={setUrl}
        placeholder="https://script.google.com/macros/s/…/exec"
        hint="Apps Script gives you this when you deploy the script as a web app."
      />
      <Field
        label="Access code"
        value={code}
        onChange={setCode}
        placeholder="The code you set on the script"
        hint="Stored in this browser only. You'll type it once on each device."
      />

      {result ? (
        <p
          className={cn(
            "flex items-start gap-2 rounded-sm px-3 py-2.5 text-[14px] leading-snug",
            result.ok ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger",
          )}
          role={result.ok ? "status" : "alert"}
        >
          {result.ok ? (
            <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          )}
          {result.message}
        </p>
      ) : null}

      <Button block size="lg" loading={checking} onClick={connect}>
        {submitLabel}
      </Button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          "block w-full rounded-sm bg-fill px-3.5 py-2.5 text-[16px] text-ink placeholder:text-ink-3",
          "outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent/50",
        )}
      />
      <span className="mt-1 block text-[12.5px] leading-snug text-ink-3">{hint}</span>
    </label>
  );
}
