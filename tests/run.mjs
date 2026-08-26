/**
 * The pure tests: no network, no browser, no build step.
 *
 * Both cover failures that type-checking cannot see — a paint expression the
 * renderer rejects at runtime, and a column mapping that would write a value
 * into the wrong one of the Places tab's 78 fields.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  "paint-expressions.test.mjs",
  "sheet-mapping.test.mjs",
  "sheet-queue.test.mjs",
  "visits.test.mjs",
  "travel-photos.test.mjs",
  "photos-auth-status.test.mjs",
  "linkify.test.mjs",
  "device-media.test.mjs",
  "media-player.test.mjs",
  "player-library.test.mjs",
  "trip-membership.test.mjs",
  "sheet-connection.test.mjs",
  "timeline.test.mjs",
  "draft-dates.test.mjs",
  "trips.test.mjs",
  "place-search.test.mjs",
  "sheet-cache.test.mjs",
  "autolink-sweep.test.mjs",
  "google-maps-links.test.mjs",
  "place-details.test.mjs",
  "insights.test.mjs",
  "dashboard.test.mjs",
  "photo-edits.test.mjs",
  "sheet-stack.test.mjs",
  "tagging.test.mjs",
  "flag-chips.test.mjs",
  "globe-frame.test.mjs",
  "celestial-sky.test.mjs",
  "swipe.test.mjs",
  "country-marks.test.mjs",
];

let failed = false;
for (const suite of suites) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      pathToFileURL(join(here, "alias.mjs")).href,
      join(here, suite),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
