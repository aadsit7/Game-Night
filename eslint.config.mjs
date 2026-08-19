import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Every image in this app is an object URL for a blob held in IndexedDB,
      // already downscaled on the way in. `next/image` cannot optimise those,
      // and the app ships as a static export with no image server anyway, so
      // plain `<img>` with explicit dimensions and lazy loading is right here.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MapLibre's own worker, copied in before every build. Vendor code.
    "public/maplibre/**",
  ]),
]);

export default eslintConfig;
