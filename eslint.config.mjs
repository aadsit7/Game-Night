import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Every image in this app is either an object URL for a blob held in
      // IndexedDB or a Mapbox static-image URL that is already sized and
      // cached at the edge. `next/image` cannot optimise the former and adds
      // a second round trip to the latter, so plain `<img>` with explicit
      // dimensions and lazy loading is the right call here.
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
  ]),
]);

export default eslintConfig;
