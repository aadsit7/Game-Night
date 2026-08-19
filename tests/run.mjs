/**
 * The pure tests: no network, no browser, no build step.
 *
 * Both cover failures that type-checking cannot see — a paint expression the
 * renderer rejects at runtime, and a merge rule that silently loses somebody's
 * travel history.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const suites = ["paint-expressions.test.mjs", "merge-rules.test.mjs"];

let failed = false;
for (const suite of suites) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", join(here, suite)],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
