/**
 * The flag chip: one mark, drawn the same way everywhere.
 *
 * A travel journal's unit is "somewhere in a country", and until now the app
 * said so twice in two different languages — a bare emoji in the lists, a
 * coloured dot on the globe. Neither reads as the other. This module owns the
 * one answer both of them ask for: given an ISO country code, what goes inside
 * the disc?
 *
 * Deliberately DOM-agnostic apart from `flagEmojiSupported`, which has to look
 * at a real canvas: the React chip and the WebGL marker sprite both import
 * from here, and the sprite generator runs long before React does.
 */

import { countryFlag } from "@/lib/utils/geo";

export { countryFlag as flagEmoji };

/**
 * An ISO 3166-1 alpha-2 code, upper-cased — or nothing.
 *
 * The same rule `countryFlag` applies, in a form the rest of the chip can use:
 * a code that cannot become a flag must not become letters either, or a row
 * from a spreadsheet reading "United States" turns into a chip saying UN.
 */
export function countryCodeOf(countryCode?: string): string | null {
  if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) return null;
  return countryCode.toUpperCase();
}

/** What the chip falls back to when the platform can't draw a flag. */
export function countryInitials(countryCode?: string): string {
  return countryCodeOf(countryCode) ?? "";
}

/**
 * How the flag is fitted to the disc, measured rather than guessed.
 *
 * A flag emoji is drawn well inside its font size — 1.17em wide and 0.86em
 * tall, its ink sitting 0.055em above where the text is placed — so a glyph
 * set to the disc's diameter leaves pale crescents top and bottom, and one
 * placed on the centre line sits high. Scaling until the ink's *height*
 * covers the circle and letting the crop take the sides is what makes the chip
 * read as a flag rather than as a flag on a badge. The globe's sprite is drawn
 * from the same two numbers.
 */
export const FLAG_OVERSCAN = 1.2;
export const FLAG_INK_RISE = 0.055;

/**
 * The three states a place can be in, in the order they win.
 *
 * `selected` is deliberately absent: on the globe it is a halo drawn under the
 * chip rather than a different chip, so a tap never changes what the mark says
 * about the place — only how loudly it says it.
 */
export type FlagVariant = "visited" | "favorite" | "wishlist";

export function flagVariant(place: {
  favorite?: boolean;
  wantToGo?: boolean;
}): FlagVariant {
  // A wish first: it is the one state that changes what the place *is* rather
  // than how much it mattered, and a favourite you have not been to is still
  // somewhere to go.
  if (place.wantToGo) return "wishlist";
  if (place.favorite) return "favorite";
  return "visited";
}

/**
 * A stable colour for the letters fallback.
 *
 * Not a guess at the country's real flag — inventing one would be worse than
 * admitting we can't draw it. Just a hue held constant per country so the same
 * place is the same colour every time you look at it, at a lightness that
 * carries white letters in both schemes.
 */
export function flagTint(countryCode?: string): string {
  const code = countryInitials(countryCode);
  if (code.length !== 2) return "hsl(215 12% 46%)";
  // Two letters, 26 values each: spread across the wheel rather than clustered,
  // so AR and AT are not the same blue.
  const index = (code.charCodeAt(0) - 65) * 26 + (code.charCodeAt(1) - 65);
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 42% 44%)`;
}

/* -------------------------------------------------------------------------- */
/* Whether this platform can draw a flag at all                                */
/* -------------------------------------------------------------------------- */

let supported: boolean | null = null;

/**
 * Windows has no flag emoji.
 *
 * Chrome and Edge on Windows render a regional-indicator pair as two boxed
 * letters, because the system emoji font ships no flag glyphs — so a design
 * built on `🇯🇵` silently becomes "JP" in a box on a large share of desktops,
 * and on a canvas it becomes two grey letters inside our lovingly drawn ring.
 * Better to know, and draw the letters ourselves.
 *
 * The probe: paint a flag we know is strongly coloured and ask whether any
 * pixel came out saturated. A real flag has red and blue in it; a letter pair
 * is monochrome text. Answered once and cached — it cannot change while the
 * page is open.
 *
 * Returns `true` when there is nothing to look at (server render, no 2D
 * context), so the first paint is always the optimistic one and hydration
 * matches. The chip re-asks after mount, where the answer is real.
 */
export function flagEmojiSupported(): boolean {
  if (supported !== null) return supported;
  if (typeof document === "undefined") return true;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return true;

    context.textBaseline = "top";
    context.font = '20px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    context.fillText("\u{1F1FA}\u{1F1F8}", 0, 0);

    const { data } = context.getImageData(0, 0, 24, 24);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (max - min > 60) {
        supported = true;
        return true;
      }
    }
    supported = false;
    return false;
  } catch {
    // A locked-down canvas (some privacy modes throw on getImageData) tells us
    // nothing, so assume the better outcome rather than degrading everyone.
    return true;
  }
}

/** Test seam: the probe is memoised, and a test needs to try both answers. */
export function __setFlagEmojiSupport(value: boolean | null): void {
  supported = value;
}
