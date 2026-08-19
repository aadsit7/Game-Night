import type { NextConfig } from "next";

/**
 * The app is entirely client-side — no server components that need a runtime,
 * no API routes — so it can be exported as static files and served from a
 * plain host. GitHub Pages serves this repo from a subpath, hence `basePath`.
 *
 * Both are opt-in via environment variables so `npm run dev` and a plain
 * `npm run build` behave exactly as they did before, at the root path.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") || "";
const staticExport = process.env.STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  // The floating dev badge sits exactly where the tab bar does.
  devIndicators: false,

  ...(staticExport ? { output: "export" as const } : {}),
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
