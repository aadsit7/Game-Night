"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_CAMERA } from "@/lib/maps/basemap";
import {
  GLINT_STARS,
  bodyFrame,
  bodyOfKind,
  bodyPxPerDeg,
  bodySurfaceDir,
  focusEase,
  focusedPlacement,
  projectDirection,
  rotateBodyFrame,
  sceneScale,
  skyPxPerDeg,
  starfieldOffset,
  toCamera,
  viewBasis,
  visibleEarthRadius,
  worldDir,
  type Vec3,
} from "@/lib/space/celestial";
import { bakeBodyTexture, bakeRingStrip } from "@/lib/space/planetTextures";
import { createSkyRenderer, type SkyRenderer, type SkyView } from "@/lib/space/skyRenderer";

export type SpaceSceneHandle = {
  /** Point the sky the way the map's camera points. Cheap to call per frame. */
  setView(view: SkyView): void;
};

type Props = {
  handleRef?: React.RefObject<SpaceSceneHandle | null>;
  /**
   * What to call the spot marked on a focused world. Present only while a
   * place off Earth is open; the mark's *position* rides the view, so it
   * keeps station on the surface as the world turns under it.
   */
  focusLabel?: string | null;
};

/** Directions of the glinting stars, fixed for the life of the module. */
const GLINT_DIRS: Vec3[] = GLINT_STARS.map((star) => worldDir(star.longitude, star.latitude));

/**
 * Bake order puts the showpieces first, so the sky dresses itself in the
 * order the eye lands on it — and Saturn is not Saturn until its ring is.
 */
const BAKE_STEPS: Array<(renderer: SkyRenderer) => void> = [
  (renderer) => renderer.setBodyTexture("moon", bakeBodyTexture("moon")),
  (renderer) => renderer.setBodyTexture("saturn", bakeBodyTexture("saturn")),
  (renderer) => renderer.setRingTexture(bakeRingStrip()),
  (renderer) => renderer.setBodyTexture("jupiter", bakeBodyTexture("jupiter")),
  (renderer) => renderer.setBodyTexture("mars", bakeBodyTexture("mars")),
  (renderer) => renderer.setBodyTexture("venus", bakeBodyTexture("venus")),
  (renderer) => renderer.setBodyTexture("neptune", bakeBodyTexture("neptune")),
  (renderer) => renderer.setBodyTexture("uranus", bakeBodyTexture("uranus")),
  (renderer) => renderer.setBodyTexture("pluto", bakeBodyTexture("pluto")),
];

/**
 * How far into the approach the surface mark appears. Before this the world
 * is still crossing the sky at a couple of dozen pixels wide, and a labelled
 * pin on it would be bigger than the world it is marking.
 */
const FOCUS_MARK_FROM = 0.55;

/** A frame's worth of work at a time, in the gaps the map's loading leaves. */
function whenIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => callback(), { timeout: 900 });
  } else {
    window.setTimeout(callback, 1);
  }
}

/**
 * The sky behind the globe: a starfield, the brightest stars with their
 * glints, and the solar system — all fixed to one celestial sphere and
 * re-projected whenever the camera moves, so turning the globe turns the
 * whole heavens around you. Everything here sits behind the map's transparent
 * canvas; the Earth occludes it all simply by being drawn in front.
 *
 * Without WebGL the planets fall back to their painted CSS stand-ins, and the
 * starfield keeps its parallax — that part is nothing but a transform.
 */
export function SpaceScene({ handleRef, focusLabel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glintRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const markRef = useRef<HTMLSpanElement>(null);

  const rendererRef = useRef<SkyRenderer | null>(null);
  const viewRef = useRef<SkyView | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const rafRef = useRef(0);

  const [fallback, setFallback] = useState(false);

  const renderScene = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (width < 2 || height < 2) return;

    const view: SkyView = viewRef.current ?? {
      longitude: DEFAULT_CAMERA.center[0],
      latitude: DEFAULT_CAMERA.center[1],
      originX: width / 2,
      originY: height / 2,
      earthRadius: null,
    };

    const pxPerDeg = skyPxPerDeg(width, height);
    const basis = viewBasis(view.longitude, view.latitude);

    // The deep field: one wrapped translation moves every painted star.
    const stars = starsRef.current;
    if (stars) {
      const offset = starfieldOffset(view.longitude, view.latitude, pxPerDeg);
      stars.style.transform = `translate3d(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px, 0)`;
    }

    // The named stars ride the same sphere the planets do.
    for (let i = 0; i < GLINT_STARS.length; i += 1) {
      const element = glintRefs.current[i];
      if (!element) continue;
      const at = projectDirection(basis, GLINT_DIRS[i], pxPerDeg);
      const x = view.originX + at.x;
      const y = view.originY + at.y;
      const visible =
        at.angle < 105 && x > -30 && x < width + 30 && y > -30 && y < height + 30;
      element.style.visibility = visible ? "visible" : "hidden";
      if (visible) {
        element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${GLINT_STARS[i].scale})`;
      }
    }

    // The mark on the surface of a focused world: found the way the shader
    // finds a texel, so the pin lands on the feature the map paints rather
    // than near it, and rides round the limb as the world turns.
    const mark = markRef.current;
    if (mark) {
      const focus = view.focus;
      const body = focus ? bodyOfKind(focus.kind) : null;
      const site = focus?.site;
      let placed = false;

      if (focus && body && site && focus.amount > FOCUS_MARK_FROM) {
        const frame = focus.rotation
          ? rotateBodyFrame(bodyFrame(body), focus.rotation)
          : bodyFrame(body);
        const surface = toCamera(basis, bodySurfaceDir(frame, site.longitude, site.latitude));

        const earthRadius = visibleEarthRadius(view.earthRadius, width, height);
        const at = projectDirection(
          basis,
          worldDir(body.longitude, body.latitude),
          bodyPxPerDeg(width, height, earthRadius),
        );
        const disc = focusedPlacement(
          {
            x: view.originX + at.x,
            y: view.originY + at.y,
            radius: body.radius * sceneScale(width, height),
          },
          focus,
        );

        // Facing away is behind the world, not merely off to one side.
        if (surface[2] > 0.06) {
          const x = disc.x + surface[0] * disc.radius;
          const y = disc.y - surface[1] * disc.radius * body.flatten;
          const arrival = focusEase((focus.amount - FOCUS_MARK_FROM) / (1 - FOCUS_MARK_FROM));
          // Flat to the surface at the limb, full-faced in the middle.
          mark.style.opacity = String(arrival * Math.min(1, surface[2] * 3.2));
          mark.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          mark.style.visibility = "visible";
          placed = true;
        }
      }

      if (!placed) mark.style.visibility = "hidden";
    }

    rendererRef.current?.render(view);
  }, []);

  /** Everything repaints at most once a frame, however often the map moves. */
  const markDirty = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      renderScene();
    });
  }, [renderScene]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      setView: (view: SkyView) => {
        viewRef.current = view;
        markDirty();
      },
    };
  }, [handleRef, markDirty]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container) return;

    let cancelled = false;

    const renderer = canvas ? createSkyRenderer(canvas) : null;
    rendererRef.current = renderer;
    if (!renderer) setFallback(true);

    // A lost context is not coming back on its own; the painted planets are.
    const onContextLost = () => {
      rendererRef.current = null;
      setFallback(true);
    };
    canvas?.addEventListener("webglcontextlost", onContextLost);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      sizeRef.current = { width, height };
      rendererRef.current?.resize(width, height, window.devicePixelRatio || 1);
      markDirty();
    });
    observer.observe(container);

    // Bake the surface maps one step at a time, in idle moments — each is a
    // few dozen milliseconds of arithmetic, and the map's tiles are usually
    // still in flight while it happens. Placeholder discs hold each orbit
    // until its world arrives.
    if (renderer) {
      const bakeNext = (index: number) => {
        if (cancelled || !rendererRef.current || index >= BAKE_STEPS.length) return;
        BAKE_STEPS[index](rendererRef.current);
        markDirty();
        whenIdle(() => bakeNext(index + 1));
      };
      whenIdle(() => bakeNext(0));
    }

    return () => {
      cancelled = true;
      observer.disconnect();
      canvas?.removeEventListener("webglcontextlost", onContextLost);
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, [markDirty]);

  return (
    <div ref={containerRef} aria-hidden="true" className="globe-space__scene">
      <div ref={starsRef} className="globe-space__stars" />
      {GLINT_STARS.map((star, index) => (
        <span
          key={index}
          ref={(element) => {
            glintRefs.current[index] = element;
          }}
          className="globe-space__star"
          style={{
            animationDuration: `${star.period}s`,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
      {fallback ? (
        <>
          <span className="planet planet--saturn" />
          <span className="planet planet--moon" />
          <span className="planet planet--mars" />
        </>
      ) : (
        <canvas ref={canvasRef} className="globe-space__bodies" />
      )}

      {/* Where you stood, on the world you are looking at. Positioned by the
          same arithmetic that paints the surface, so it stays on its crater
          as the Moon turns — and slides behind the limb when that crater does. */}
      <span ref={markRef} className="globe-space__mark">
        <span className="globe-space__mark-dot" />
        {focusLabel ? <span className="globe-space__mark-label">{focusLabel}</span> : null}
      </span>
    </div>
  );
}
