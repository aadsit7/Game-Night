/**
 * Draws the solar system onto a transparent canvas behind the globe.
 *
 * Each body is a real sphere, ray-cast in a fragment shader: its surface map
 * is sampled through the body's own rotation, so turning the globe swings a
 * different face of the Moon into view; its lighting comes from the one Sun
 * the whole scene shares, so bodies near the Sun in the sky wear crescents
 * and bodies opposite it hang full. Saturn's rings are the genuine geometry —
 * a plane cut through the shader's ray, banded by a radial strip texture,
 * throwing their shadow onto the planet and taking the planet's shadow across
 * their far side.
 *
 * The canvas sits *behind* the map's own canvas, which is transparent
 * everywhere the Earth is not. Occlusion is therefore free and exact: zoom in
 * and the world covers the sky, spin the globe and planets slide behind the
 * limb, all without a single line of z-testing here.
 *
 * Nothing renders on a timer. The scene redraws when the camera moves and is
 * otherwise a still photograph.
 */

import {
  SKY_BODIES,
  SUN,
  SUN_DIR,
  bodyFrame,
  bodyPxPerDeg,
  focusEase,
  focusedPlacement,
  projectDirection,
  rotateBodyFrame,
  sceneScale,
  toCamera,
  viewBasis,
  visibleEarthRadius,
  worldDir,
  type BodyKind,
  type SkyBody,
  type SkyFocus,
  type Vec3,
} from "@/lib/space/celestial";
import type { BakedTexture } from "@/lib/space/planetTextures";

/** What the sky needs to know about the camera, in CSS pixels. */
export type SkyView = {
  longitude: number;
  latitude: number;
  /** Where on screen the camera's target sits — the Earth's centre. */
  originX: number;
  originY: number;
  /** The Earth's projected radius, when the renderer can say; null otherwise. */
  earthRadius: number | null;
  /**
   * One body pulled out of the sky and made the subject — how a place on the
   * Moon is looked at. Null, and everything stays where the sphere puts it.
   */
  focus?: SkyFocus | null;
};

export type { SkyFocus } from "@/lib/space/celestial";

export type SkyRenderer = {
  render(view: SkyView): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  setBodyTexture(kind: BodyKind, texture: BakedTexture): void;
  setRingTexture(texture: BakedTexture): void;
  destroy(): void;
};

const VERTEX_SHADER = `
attribute vec2 aCorner;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uHalfPx;
uniform float uScaleP;
varying vec2 vP;
void main() {
  vP = vec2(aCorner.x, -aCorner.y) * uScaleP;
  vec2 px = uCenter + aCorner * uHalfPx;
  vec2 clip = vec2(px.x / uResolution.x * 2.0 - 1.0, 1.0 - px.y / uResolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vP;

uniform int uKind;          // 0 world, 1 ringed world, 2 sun, 3 earth atmosphere
uniform sampler2D uMap;
uniform sampler2D uRing;
uniform mat3 uCamToBody;
uniform vec3 uLight;        // toward the sun, camera space (x right, y up, z out)
uniform vec3 uAxis;         // spin axis, camera space
uniform float uPxPerUnit;
uniform float uFlatten;
uniform float uLimb;
uniform float uBump;
uniform vec3 uAtmColor;
uniform float uAtmStrength;
uniform vec2 uRingRadii;
uniform vec2 uTexel;
uniform vec2 uSunDir;       // for the halo: sunward direction on screen, y up
uniform float uHaloInner;
uniform float uFade;

vec4 blendOver(vec4 top, vec4 bottom) {
  float a = top.a + bottom.a * (1.0 - top.a);
  if (a < 0.0005) return vec4(0.0);
  vec3 rgb = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / a;
  return vec4(rgb, a);
}

void main() {
  vec4 outc = vec4(0.0);

  if (uKind == 2) {
    // The Sun: a glare, not a disc — a hot core, two blooms, and the faintest
    // cross of diffraction to match the glint the brightest stars wear.
    float r = length(vP);
    float a = 0.9 * exp(-r * r * 38.0) + 0.34 * exp(-r * r * 6.5) + 0.13 * exp(-r * 2.1);
    a += (exp(-abs(vP.y) * 46.0) + exp(-abs(vP.x) * 46.0)) * exp(-r * 3.2) * 0.22;
    vec3 c = mix(vec3(1.0, 0.99, 0.95), vec3(1.0, 0.8, 0.52), clamp(r * 1.5, 0.0, 1.0));
    outc = vec4(c, clamp(a, 0.0, 1.0));
  } else if (uKind == 3) {
    // The air around the Earth, drawn just outside the limb the map renders,
    // and brighter on whichever side the Sun is — scattered daylight.
    float r = length(vP);
    float x = r / uHaloInner;
    vec2 dir = r > 0.0001 ? vP / r : vec2(0.0, 1.0);
    float sunSide = 0.5 + 0.5 * dot(dir, uSunDir);
    float shell = smoothstep(0.86, 0.995, x) * (1.0 - smoothstep(1.0, 1.55, x));
    float glow = shell * (0.3 + 0.95 * sunSide * sunSide);
    vec3 c = mix(vec3(0.72, 0.88, 1.0), vec3(0.16, 0.38, 0.85), smoothstep(1.0, 1.42, x));
    outc = vec4(c, glow * 0.6);
  } else {
    // A world: ray-cast the sphere, look its surface up through the body's
    // own rotation, and light it from the Sun.
    vec2 q = vec2(vP.x, vP.y / uFlatten);
    float rr = length(q);
    float aaw = 1.6 / max(uPxPerUnit, 1.0);
    float disc = 1.0 - smoothstep(1.0 - aaw, 1.0 + 0.4 * aaw, rr);
    vec3 col = vec3(0.0);
    float sphereZ = -1000.0;

    if (disc > 0.0) {
      vec3 n = vec3(q.x, q.y, sqrt(max(1.0 - min(rr * rr, 1.0), 0.0)));
      sphereZ = n.z;
      vec3 nb = uCamToBody * n;
      float lon = atan(nb.x, nb.z);
      float lat = asin(clamp(nb.y, -1.0, 1.0));
      vec2 uv = vec2(lon * 0.1591549 + 0.5, 0.5 - lat * 0.3183099);
      vec4 samp = texture2D(uMap, uv);

      // Relief from the height channel: craters cast at the terminator.
      vec3 nl = n;
      if (uBump > 0.001) {
        float hE = texture2D(uMap, uv + vec2(uTexel.x, 0.0)).a;
        float hS = texture2D(uMap, uv + vec2(0.0, uTexel.y)).a;
        vec3 tU = normalize(cross(n, uAxis) + vec3(0.0001));
        vec3 tV = cross(n, tU);
        nl = normalize(n - (tU * (hE - samp.a) + tV * (hS - samp.a)) * uBump * 5.0);
      }

      float dGeo = dot(n, uLight);
      float d = dot(nl, uLight);
      float twil = smoothstep(-0.14, 0.12, dGeo);
      float light = twil * (0.22 + 0.78 * max(d, 0.0));
      light *= mix(1.0, 0.32 + 0.68 * sqrt(max(n.z, 0.0)), uLimb);
      // The night side is never a hole in the sky: a cool wash of starlight
      // and earthshine keeps a body in shadow reading as a body.
      col = samp.rgb * light + samp.rgb * vec3(0.085, 0.10, 0.135) * (1.0 - twil);

      // The thin bright air at the edge of the day side.
      float rim = pow(1.0 - max(n.z, 0.0), 2.8);
      col += uAtmColor * rim * uAtmStrength * (0.2 + 0.8 * twil);

      // The rings' shadow, laid across the globe of the planet.
      if (uKind == 1) {
        float la = dot(uLight, uAxis);
        if (abs(la) > 0.001) {
          float s0 = -dot(n, uAxis) / la;
          if (s0 > 0.0) {
            float rho = length(n + uLight * s0);
            float u2 = (rho - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
            if (u2 > 0.0 && u2 < 1.0) {
              col *= 1.0 - 0.8 * texture2D(uRing, vec2(u2, 0.5)).a;
            }
          }
        }
      }
    }

    vec4 sphere4 = vec4(col, disc);

    // The rings themselves: the body's equator plane, cut by the view ray,
    // banded by radius — behind the planet on the far side, in front on the
    // near side, which is all a ring ever is.
    vec4 ring4 = vec4(0.0);
    float ringZ = -2000.0;
    if (uKind == 1 && abs(uAxis.z) > 0.0002) {
      float t = -(vP.x * uAxis.x + vP.y * uAxis.y) / uAxis.z;
      vec3 R = vec3(vP.x, vP.y, t);
      float rho = length(R);
      float u2 = (rho - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
      if (u2 > 0.0 && u2 < 1.0) {
        vec4 rs = texture2D(uRing, vec2(u2, 0.5));
        float la = dot(uLight, uAxis);
        float lit = 0.74 + 0.36 * clamp(abs(la) * 1.7, 0.0, 1.0);
        // Seen from the unlit face, the rings dim to a lantern shade.
        if (la * uAxis.z < 0.0) lit *= 0.6;
        // The planet's own shadow, sweeping across the far arc.
        float bq = dot(R, uLight);
        float cc = dot(R, R) - 1.0;
        if (bq < 0.0 && bq * bq - cc > 0.0) lit *= 0.12;
        // Edge-on, a razor: thin to nothing rather than alias.
        float thin = smoothstep(0.0, 0.045, abs(uAxis.z));
        ring4 = vec4(rs.rgb * lit, rs.a * thin);
        ringZ = t;
      }
    }

    outc = ringZ > sphereZ ? blendOver(ring4, sphere4) : blendOver(sphere4, ring4);

    // A last breath of air past the limb, for the worlds that have any.
    if (uAtmStrength > 0.001) {
      float rOut = max(rr - 1.0, 0.0);
      float edgeLit = smoothstep(-0.4, 0.5, dot(normalize(vec3(q, 0.001)), uLight));
      float glowA = uAtmStrength * 0.5 * exp(-rOut * 10.0) * (1.0 - disc) * (0.25 + 0.75 * edgeLit);
      outc = blendOver(outc, vec4(uAtmColor, glowA));
    }
  }

  gl_FragColor = vec4(outc.rgb, outc.a * uFade);
}
`;

type BodyState = {
  body: SkyBody;
  dir: Vec3;
  frame: { meridian: Vec3; axis: Vec3; binormal: Vec3 };
  texture: WebGLTexture;
  texel: [number, number];
};

/** Rows-to-columns for `uniformMatrix3fv`, which wants column-major. */
function mat3FromRows(r0: Vec3, r1: Vec3, r2: Vec3): Float32Array {
  return new Float32Array([r0[0], r1[0], r2[0], r0[1], r1[1], r2[1], r0[2], r1[2], r2[2]]);
}

export function createSkyRenderer(canvas: HTMLCanvasElement): SkyRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      // Decorative: never a reason to fail a page or drain a weak battery.
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[sky]", gl.getShaderInfoLog(shader));
      }
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[sky]", gl.getProgramInfoLog(program));
    }
    return null;
  }
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(program, "aCorner");
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    resolution: u("uResolution"),
    center: u("uCenter"),
    halfPx: u("uHalfPx"),
    scaleP: u("uScaleP"),
    kind: u("uKind"),
    map: u("uMap"),
    ring: u("uRing"),
    camToBody: u("uCamToBody"),
    light: u("uLight"),
    axis: u("uAxis"),
    pxPerUnit: u("uPxPerUnit"),
    flatten: u("uFlatten"),
    limb: u("uLimb"),
    bump: u("uBump"),
    atmColor: u("uAtmColor"),
    atmStrength: u("uAtmStrength"),
    ringRadii: u("uRingRadii"),
    texel: u("uTexel"),
    sunDir: u("uSunDir"),
    haloInner: u("uHaloInner"),
    fade: u("uFade"),
  };
  gl.uniform1i(loc.map, 0);
  gl.uniform1i(loc.ring, 1);

  /** A 1×1 stand-in in the body's own colour, until its map is baked. */
  const placeholder = (rgba: [number, number, number, number]): WebGLTexture => {
    const texture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };

  const bodies: BodyState[] = SKY_BODIES.map((body) => ({
    body,
    dir: worldDir(body.longitude, body.latitude),
    frame: bodyFrame(body),
    texture: placeholder([
      Math.round(body.base[0] * 255),
      Math.round(body.base[1] * 255),
      Math.round(body.base[2] * 255),
      128,
    ]),
    texel: [1, 1],
  }));
  // Rings stay invisible — and cast no shadow — until their strip arrives.
  const ringTexture = placeholder([0, 0, 0, 0]);
  const sunDir = SUN_DIR;

  let widthCss = 0;
  let heightCss = 0;
  let dpr = 1;

  const upload = (texture: WebGLTexture, baked: BakedTexture, repeatX: boolean) => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      baked.width,
      baked.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      baked.pixels,
    );
    // Every size in play is a power of two, so WebGL1 will mip and repeat.
    if (baked.height > 1) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  const drawQuad = (centerX: number, centerY: number, halfCss: number, scaleP: number) => {
    gl.uniform2f(loc.center, centerX * dpr, centerY * dpr);
    gl.uniform1f(loc.halfPx, halfCss * dpr);
    gl.uniform1f(loc.scaleP, scaleP);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const smoothstepJs = (a: number, b: number, t: number) => {
    const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
  };

  const render = (view: SkyView) => {
    if (gl.isContextLost() || widthCss < 2 || heightCss < 2) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.resolution, canvas.width, canvas.height);

    const basis = viewBasis(view.longitude, view.latitude);
    const sunCam = toCamera(basis, sunDir);
    const scale = sceneScale(widthCss, heightCss);
    // The Earth's disc, when it is one on screen rather than a wall of map.
    const earthR = visibleEarthRadius(view.earthRadius, widthCss, heightCss);
    const pxPerDeg = bodyPxPerDeg(widthCss, heightCss, earthR);
    const focus = view.focus && view.focus.amount > 0 ? view.focus : null;
    const focusT = focus ? focusEase(focus.amount) : 0;

    gl.uniform3f(loc.light, sunCam[0], sunCam[1], sunCam[2]);

    // The Sun first: everything else in the sky is nearer than it is.
    const sunAt = projectDirection(basis, sunDir, pxPerDeg);
    if (sunAt.angle < 125) {
      const fade = 1 - smoothstepJs(102, 124, sunAt.angle);
      if (fade > 0.01) {
        gl.uniform1i(loc.kind, 2);
        gl.uniform1f(loc.fade, fade);
        drawQuad(view.originX + sunAt.x, view.originY + sunAt.y, SUN.radius * scale, 1);
      }
    }

    /* The subject goes last, so an approaching world passes in front of the
       sky it is leaving rather than through it. */
    const order = focus
      ? [...bodies.filter((state) => state.body.kind !== focus.kind),
         ...bodies.filter((state) => state.body.kind === focus.kind)]
      : bodies;

    for (const state of order) {
      const { body } = state;
      const at = projectDirection(basis, state.dir, pxPerDeg);
      const subject = focus?.kind === body.kind ? focus : null;

      /* The subject is never faded, culled or eclipsed on the way in: it is
         the thing being looked at, and half of that journey crosses sky the
         camera is not pointing at. Everything else behaves as it always has. */
      const inSky = 1 - smoothstepJs(96, 120, at.angle);
      const fade = subject ? Math.max(inSky, focusT) : inSky;
      if (fade <= 0.01) continue;

      const placed = focusedPlacement(
        { x: view.originX + at.x, y: view.originY + at.y, radius: body.radius * scale },
        subject,
      );
      const radius = placed.radius;
      const extent = body.ring ? body.ring.outer * 1.04 : 1.3;
      const half = radius * extent;
      const cx = placed.x;
      const cy = placed.y;
      // Off the canvas, or wholly behind the opaque Earth: not worth a draw.
      if (cx + half < 0 || cx - half > widthCss || cy + half < 0 || cy - half > heightCss) continue;
      if (
        !subject &&
        earthR !== null &&
        Math.hypot(at.x, at.y) + half < earthR * 0.92
      ) {
        continue;
      }

      // The one turn that brings a named spot round to face the camera.
      const frame = subject?.rotation
        ? rotateBodyFrame(state.frame, subject.rotation)
        : state.frame;
      const meridianCam = toCamera(basis, frame.meridian);
      const axisCam = toCamera(basis, frame.axis);
      const binormalCam = toCamera(basis, frame.binormal);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, state.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, ringTexture);

      gl.uniform1i(loc.kind, body.ring ? 1 : 0);
      gl.uniformMatrix3fv(loc.camToBody, false, mat3FromRows(meridianCam, axisCam, binormalCam));
      gl.uniform3f(loc.axis, axisCam[0], axisCam[1], axisCam[2]);
      gl.uniform1f(loc.pxPerUnit, radius * dpr);
      gl.uniform1f(loc.flatten, body.flatten);
      gl.uniform1f(loc.limb, body.limb);
      gl.uniform1f(loc.bump, body.bump);
      gl.uniform3f(loc.atmColor, body.atmosphere[0], body.atmosphere[1], body.atmosphere[2]);
      gl.uniform1f(loc.atmStrength, body.atmosphereStrength);
      gl.uniform2f(loc.ringRadii, body.ring?.inner ?? 1, body.ring?.outer ?? 2);
      gl.uniform2f(loc.texel, state.texel[0], state.texel[1]);
      gl.uniform1f(loc.fade, fade);
      drawQuad(cx, cy, half, extent);
    }

    /* The Earth's own air, hugging the limb the map draws — brightest where
       the Sun stands, which is how a planet says which way is day. It leaves
       with the planet: while another world is being looked at the map itself
       is faded out, and an atmosphere still glowing round nothing would be
       the one thing left insisting the Earth is there. */
    if (earthR !== null && focusT < 0.999) {
      const flat = Math.hypot(sunCam[0], sunCam[1]);
      gl.uniform1i(loc.kind, 3);
      gl.uniform1f(loc.fade, 1 - focusT);
      gl.uniform1f(loc.haloInner, 1 / 1.6);
      gl.uniform2f(
        loc.sunDir,
        flat > 1e-6 ? sunCam[0] / flat : 0,
        flat > 1e-6 ? sunCam[1] / flat : 1,
      );
      drawQuad(view.originX, view.originY, earthR * 1.6, 1);
    }
  };

  return {
    render,
    resize(nextWidth: number, nextHeight: number, nextDpr: number) {
      widthCss = Math.max(1, Math.round(nextWidth));
      heightCss = Math.max(1, Math.round(nextHeight));
      dpr = Math.min(2, Math.max(1, nextDpr));
      canvas.width = Math.round(widthCss * dpr);
      canvas.height = Math.round(heightCss * dpr);
    },
    setBodyTexture(kind: BodyKind, texture: BakedTexture) {
      const state = bodies.find((candidate) => candidate.body.kind === kind);
      if (!state || gl.isContextLost()) return;
      upload(state.texture, texture, true);
      state.texel = [1.5 / texture.width, 1.5 / texture.height];
    },
    setRingTexture(texture: BakedTexture) {
      if (gl.isContextLost()) return;
      upload(ringTexture, texture, false);
    },
    destroy() {
      try {
        for (const state of bodies) gl.deleteTexture(state.texture);
        gl.deleteTexture(ringTexture);
        gl.deleteBuffer(quad);
        gl.deleteProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
      } catch {
        // A lost context has already thrown all of this away.
      }
    },
  };
}
