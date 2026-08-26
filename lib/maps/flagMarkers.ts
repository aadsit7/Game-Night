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
/** Drawn at 3× — the phones this is built for have three device pixels per
 * CSS pixel, and a 2× chip upscaled by the GPU is a chip seen through glass. */
export const MARKER_PIXEL_RATIO = 3;

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
 * The fine dark line where the flag meets the ring.
 *
 * The DOM chip has carried one from the start, and for the same reason it is
 * needed here: Japan's flag is mostly white and Finland's nearly all of it,
 * and inside a white ring either simply dissolves. A hairline at the crop edge
 * is what keeps every flag reading as a disc sitting *in* the ring rather than
 * a stain spreading into it.
 */
const CONTOUR = "rgba(12, 18, 28, 0.18)";

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
/* Finding the flag's ink                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where a platform actually painted the flag, found rather than believed.
 *
 * The first version of this file placed the emoji with `textAlign`,
 * `textBaseline` and a pair of measured em-fractions — and shipped chips that
 * were mostly ring, because canvas metrics for colour emoji are exactly the
 * thing platforms disagree on. iOS in particular has been seen putting the
 * glyph's ink down and to the right of where the alignment asked, which left
 * a sliver of flag at the edge of the crop and the rest outside it.
 *
 * So the metrics are no longer trusted at all. The glyph is drawn once onto a
 * generous scratch canvas, the alpha channel is scanned for the box the ink
 * actually landed in, and *that box* is what gets fitted to the disc. Wherever
 * the renderer decides to put a flag, this finds it.
 */
type FlagInk = {
  source: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Answered once per emoji per page. Three answers, not two: a box, `null` for
 * "measured, and there is no usable flag there" (fall back to the letters),
 * and `"unreadable"` for a canvas that refuses pixel reads — some privacy
 * modes do — where the old metric placement is still the best draw available.
 */
const inkCache = new Map<string, FlagInk | "unreadable" | null>();

/** Scratch geometry: room for the glyph wherever the platform puts it. */
const INK_CANVAS = 320;
/* Large enough that the disc never upscales it: the ink of a 128px flag is
   ~110px tall, and the largest thing it is drawn into is an 86-device-pixel
   circle. Also comfortably inside Apple Color Emoji's largest bitmap strike,
   so the source is the sharpest picture the font can produce. */
const INK_FONT = 128;
/** Below this alpha a pixel is antialiasing fringe, not flag. */
const INK_ALPHA = 24;

function measureFlagInk(emoji: string): FlagInk | "unreadable" | null {
  const cached = inkCache.get(emoji);
  if (cached !== undefined) return cached;

  let result: FlagInk | "unreadable" | null = "unreadable";
  try {
    const scratch = document.createElement("canvas");
    scratch.width = INK_CANVAS;
    scratch.height = INK_CANVAS;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      /* Left-aligned on the alphabetic baseline — the one placement every
         renderer grew up on — from a point with a whole glyph's worth of
         room on every side of it. A renderer with the very bug this exists
         for may land the ink a full em from where it was asked to, in any
         direction, and it must still land *on the canvas* to be found. */
      ctx.font = `${INK_FONT}px ${EMOJI_FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(emoji, INK_CANVAS * 0.3, INK_CANVAS * 0.55);

      const { data } = ctx.getImageData(0, 0, INK_CANVAS, INK_CANVAS);
      let minX = INK_CANVAS;
      let minY = INK_CANVAS;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < INK_CANVAS; y += 1) {
        const row = y * INK_CANVAS * 4;
        for (let x = 0; x < INK_CANVAS; x += 1) {
          if (data[row + x * 4 + 3] >= INK_ALPHA) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      /* Plausibility, not perfection: a flag's ink is most of an em tall and
         no emoji flag is wider than 2:1 or so. A blank (nothing drawn), a
         tofu sliver, or a pair of loose regional-indicator letters — all the
         shapes a missing glyph takes — fail one of these, and the chip falls
         back to the letters it would rather wear than a stretched accident.
         Nepal, the one flag taller than it is wide, passes comfortably. */
      result =
        maxX < 0 || height < INK_FONT * 0.45 || width > height * 2.4
          ? null
          : { source: scratch, x: minX, y: minY, width, height };
    }
  } catch {
    result = "unreadable";
  }
  inkCache.set(emoji, result);
  return result;
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

/**
 * A breath of light across a coloured disc — brighter above, dimmer below.
 *
 * Flat badge fills read as printed dots; this one-gradient pass is what makes
 * the count and the favourite badges read as small solid objects sitting on
 * the chip, without ever getting glossy enough to be skeuomorphic.
 */
function shadeDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  const light = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
  light.addColorStop(0, "rgba(255, 255, 255, 0.22)");
  light.addColorStop(0.45, "rgba(255, 255, 255, 0.03)");
  light.addColorStop(1, "rgba(8, 12, 20, 0.16)");
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** The id of the badge that turns a chip into "several places here". */
export const COUNT_BADGE_IMAGE = "flag:count-badge";

/** CSS pixels of the badge sprite — wide enough for a two-digit count. */
export const COUNT_BADGE_BOX = 24;

/** The badge's own disc, inside the margin its drop shadow needs. */
export const COUNT_BADGE_RADIUS = COUNT_BADGE_BOX / 2 - 2;

/**
 * The disc a cluster's count sits in.
 *
 * A cluster is the same chip as a single place — a flag, cropped to a circle —
 * because a group of places in Portugal is still Portugal. What makes it a
 * group is this: a filled badge in the traveller's own colour, ringed like the
 * chip it hangs off, with the number drawn over it by the label layer.
 *
 * Sized to the DOM chip's proportions rather than to its old self: a badge
 * nearly as wide as its chip stopped being a badge and became a second chip,
 * which is exactly how the opening globe used to read.
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
  ctx.shadowColor = "rgba(8, 12, 20, 0.35)";
  ctx.shadowBlur = 2.5;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = overlay.pinStroke;
  ctx.beginPath();
  ctx.arc(centre, centre, COUNT_BADGE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = overlay.cluster;
  ctx.beginPath();
  ctx.arc(centre, centre, COUNT_BADGE_RADIUS - 2, 0, Math.PI * 2);
  ctx.fill();
  shadeDisc(ctx, centre, centre, COUNT_BADGE_RADIUS - 2);

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
  const ink = emoji && flagEmojiSupported() ? measureFlagInk(emoji) : null;

  if (ink && ink !== "unreadable") {
    /* Cover the disc with the measured ink and let the crop take the sides —
       scaled from the *smaller* side so both dimensions clear the circle,
       with a breath of overscan so the emoji's rounded corners and soft edge
       stay outside it. No font metric is consulted anywhere in this path. */
    const target = DISC_RADIUS * 2 * 1.06;
    const k = target / Math.min(ink.width, ink.height);
    const width = ink.width * k;
    const height = ink.height * k;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      ink.source,
      ink.x,
      ink.y,
      ink.width,
      ink.height,
      DISC_CENTRE - width / 2,
      DISC_CENTRE - height / 2,
      width,
      height,
    );
  } else if (emoji && ink === "unreadable") {
    // A canvas that hid its pixels from the measurement: place by metrics,
    // the way the DOM chip does, which is right everywhere the metrics are.
    ctx.fillStyle = "#000000";
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

  // The hairline where flag meets ring — see CONTOUR for why it exists.
  ctx.strokeStyle = CONTOUR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(DISC_CENTRE, DISC_CENTRE, DISC_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

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
    shadeDisc(ctx, x, y, BADGE_RADIUS - 1.5);

    ctx.fillStyle = "#FFFFFF";
    if (variant === "favorite") heartPath(ctx, x, y + 0.3, 6.4);
    else starPath(ctx, x, y, 3.9);
    ctx.fill();
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
