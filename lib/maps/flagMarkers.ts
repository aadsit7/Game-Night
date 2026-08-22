/**
 * The globe's pins, drawn as flag chips.
 *
 * A 5px coloured dot answers "is there something here"; it does not answer
 * "where is here". A circular crop of the country's flag answers both at once,
 * at any zoom, without a label — which is why the mark on the planet is now the
 * same mark the lists use, generated here as a sprite the renderer can place a
 * thousand of without touching the DOM.
 *
 * Sprites rather than `maplibregl.Marker` elements on purpose: an HTML marker
 * per place means a DOM node per place, laid out and transformed on every
 * frame of every drag, and it opts out of clustering, collision and the
 * globe's own depth sorting. An `addImage` sprite is a texture upload once and
 * a quad thereafter.
 */

import {
  FLAG_INK_RISE,
  FLAG_OVERSCAN,
  countryCodeOf,
  countryInitials,
  flagEmoji,
  flagEmojiSupported,
  flagTint,
  type FlagVariant,
} from "@/lib/ui/flags";
import type { OverlayPalette } from "@/lib/maps/basemap";

/** CSS pixels of the whole sprite: the disc, its ring, and room for a badge. */
export const MARKER_BOX = 44;
/** Drawn at 2× so the chip is crisp on the phones this is built for. */
export const MARKER_PIXEL_RATIO = 2;

const DISC_CENTRE = 20;
/** Outer edge of the white ring — the chip's own radius, in CSS pixels. */
export const MARKER_RADIUS = 16;
const RING_WIDTH = 2.5;
/** The flag itself, cropped to this circle. */
const DISC_RADIUS = MARKER_RADIUS - RING_WIDTH;

const BADGE_CENTRE = { x: 31, y: 31 };
const BADGE_RADIUS = 7;

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
const LABEL_FONT =
  '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * The id a feature asks for by name.
 *
 * Country and variant, and nothing else — no scheme, no selection. A style
 * swap discards every registered image and we re-register from scratch, and a
 * selection is a halo under the chip rather than a different chip, so neither
 * belongs in the key. Keeping it that small is what holds the sprite count at
 * "countries you have been to", rather than at "places you have saved".
 */
export function markerImageId(countryCode: string | undefined, variant: FlagVariant): string {
  return `flag:${countryCodeOf(countryCode) ?? "__"}:${variant}`;
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.8);
  ctx.bezierCurveTo(cx - s * 1.7, cy - s * 0.3, cx - s * 0.7, cy - s * 1.3, cx, cy - s * 0.3);
  ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.3, cx + s * 1.7, cy - s * 0.3, cx, cy + s * 0.8);
  ctx.closePath();
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number): void {
  const inner = outer * 0.46;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** The id of the badge that turns a chip into "several places here". */
export const COUNT_BADGE_IMAGE = "flag:count-badge";

/** CSS pixels of the badge sprite — wide enough for three characters. */
export const COUNT_BADGE_BOX = 26;

/**
 * The disc a cluster's count sits in.
 *
 * A cluster is the same chip as a single place — a flag, cropped to a circle —
 * because a group of places in Portugal is still Portugal. What makes it a
 * group is this: a filled badge in the traveller's own colour, ringed like the
 * chip it hangs off, with the number drawn over it by the label layer.
 */
export function drawCountBadge(overlay: OverlayPalette): ImageData | null {
  if (typeof document === "undefined") return null;

  const scale = MARKER_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = COUNT_BADGE_BOX * scale;
  canvas.height = COUNT_BADGE_BOX * scale;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.scale(scale, scale);
  const centre = COUNT_BADGE_BOX / 2;

  ctx.save();
  ctx.shadowColor = "rgba(8, 12, 20, 0.4)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = overlay.pinStroke;
  ctx.beginPath();
  ctx.arc(centre, centre, centre - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = overlay.cluster;
  ctx.beginPath();
  ctx.arc(centre, centre, centre - 3, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * One chip, as pixels.
 *
 * Returns `null` where there is no canvas to draw on — a server render, or a
 * browser that has taken the 2D context away — and every caller treats that as
 * "this place keeps the plain mark", never as an error.
 */
export function drawMarker(
  countryCode: string | undefined,
  variant: FlagVariant,
  overlay: OverlayPalette,
): ImageData | null {
  if (typeof document === "undefined") return null;

  const scale = MARKER_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = MARKER_BOX * scale;
  canvas.height = MARKER_BOX * scale;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // The ring, with the chip's only shadow under it. Drawn as a filled disc
  // rather than a stroke so the shadow falls from the outer edge and never
  // shows through the translucent parts of a flag.
  ctx.save();
  ctx.shadowColor = "rgba(8, 12, 20, 0.45)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = overlay.pinStroke;
  ctx.beginPath();
  ctx.arc(DISC_CENTRE, DISC_CENTRE, MARKER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The flag, cropped to the disc the way an avatar crops a photograph.
  ctx.save();
  ctx.beginPath();
  ctx.arc(DISC_CENTRE, DISC_CENTRE, DISC_RADIUS, 0, Math.PI * 2);
  ctx.clip();

  const emoji = flagEmoji(countryCode);
  const initials = countryInitials(countryCode);

  if (emoji && flagEmojiSupported()) {
    ctx.fillStyle = "#000000";
    // Fitted exactly as the DOM chip fits it — same overscan, same correction
    // for ink that sits above the line — so the two marks are one mark.
    const size = DISC_RADIUS * 2 * FLAG_OVERSCAN;
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.fillText(emoji, DISC_CENTRE, DISC_CENTRE + size * FLAG_INK_RISE);
  } else {
    ctx.fillStyle = initials.length === 2 ? flagTint(countryCode) : overlay.pin;
    ctx.fillRect(0, 0, MARKER_BOX, MARKER_BOX);
    if (initials.length === 2) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = LABEL_FONT;
      ctx.fillText(initials, DISC_CENTRE, DISC_CENTRE + 0.5);
    }
  }
  ctx.restore();

  if (variant !== "visited") {
    const { x, y } = BADGE_CENTRE;
    ctx.fillStyle = overlay.pinStroke;
    ctx.beginPath();
    ctx.arc(x, y, BADGE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = variant === "favorite" ? overlay.pin : overlay.pinWishlist;
    ctx.beginPath();
    ctx.arc(x, y, BADGE_RADIUS - 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    if (variant === "favorite") heartPath(ctx, x, y + 0.3, 6.4);
    else starPath(ctx, x, y, 3.9);
    ctx.fill();
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
