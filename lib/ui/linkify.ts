/**
 * Splits guidance text into plain and link segments, so a URL inside a
 * setup message can be rendered tappable. The strings this runs on come
 * from the Apps Script — its own advice, or a Google error body it relayed
 * — and sometimes carry the exact console page that fixes a problem. On a
 * phone, retyping that address is the difference between fixed and given
 * up. Only absolute https addresses count; everything else stays inert
 * text.
 */

export type TextSegment = { text: string; href?: string };

/** Sentence punctuation that follows a URL rather than belonging to it. */
function splitTrailingPunctuation(raw: string): [string, string] {
  const match = /[.,;:!?…]+$/.exec(raw);
  if (!match) return [raw, ""];
  return [raw.slice(0, raw.length - match[0].length), match[0]];
}

export function linkifyText(text: string): TextSegment[] {
  const pattern = /https:\/\/[^\s"'<>()]+/g;
  const segments: TextSegment[] = [];
  let at = 0;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > at) segments.push({ text: text.slice(at, match.index) });
    const [url, trailing] = splitTrailingPunctuation(match[0]);
    // A bare "https://" with its address entirely stripped is not a link.
    if (url.length > "https://".length) {
      segments.push({ text: url, href: url });
      if (trailing) segments.push({ text: trailing });
    } else {
      segments.push({ text: match[0] });
    }
    at = match.index + match[0].length;
  }

  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
