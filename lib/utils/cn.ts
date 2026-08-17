type ClassValue = string | number | false | null | undefined;

/** Minimal class-name joiner — no dependency needed for this much. */
export function cn(...values: ClassValue[]): string {
  let out = "";
  for (const value of values) {
    if (!value && value !== 0) continue;
    out = out ? `${out} ${value}` : String(value);
  }
  return out;
}
