/**
 * The memories player: playlist assembly for places and trips, the player
 * state machine, and the Google Photos safety rails.
 *
 * The silent failures this guards against: a place's player leaking another
 * place's media; a trip playlist missing a member place or playing a
 * twice-reachable record twice; a video advanced by the photo clock instead
 * of its own `ended` event; a pause that quietly keeps counting; a blocked
 * iOS autoplay freezing the playlist instead of asking for a tap; and any
 * code path from playback or removal that could touch a Google Photos
 * original.
 *
 * Run with: npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  formatMediaCounts,
  mediaCounts,
  playbackKind,
  playbackOrder,
  playlistForPlace,
  playlistForTrip,
} = await import("../lib/photos/mediaPlaylist.ts");
const {
  DEFAULT_PHOTO_DURATION_MS,
  createPlayerState,
  isTimedItem,
  playerPosition,
  playlistProgress,
  reducePlayer,
} = await import("../lib/photos/playerCore.ts");
const { travelPhotoRequestParams } = await import("../lib/sheets/sheetsClient.ts");

let failures = 0;
function test(name, body) {
  try {
    body();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log("media player");

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const NOW = "2026-01-01T00:00:00.000Z";
let sequence = 0;

function media(extra = {}) {
  sequence += 1;
  return {
    id: `TPHOTO-${String(sequence).padStart(4, "0")}`,
    source: "google-photos",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function video(extra = {}) {
  return media({ mimeType: "video/mp4", videoDriveFileId: "drive-clip", ...extra });
}

function place(id, extra = {}) {
  return {
    id,
    name: id,
    country: "Japan",
    latitude: 35,
    longitude: 135,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function visit(id, placeId, extra = {}) {
  return { id, placeId, createdAt: NOW, updatedAt: NOW, ...extra };
}

function trip(id, extra = {}) {
  return { id, name: id, createdAt: NOW, updatedAt: NOW, ...extra };
}

/* The acceptance scenario: one trip, three member places, media on each.
 * Tokyo and Kyoto belong through their visits' Trip ID; Osaka belongs the
 * legacy way, through the place-level cell alone. */
const japan = trip("TRIP-JAPAN", { startDate: "2026-04-01", endDate: "2026-04-10" });
const tokyo = place("PL-TOKYO");
const kyoto = place("PL-KYOTO");
const osaka = place("PL-OSAKA", { tripId: "TRIP-JAPAN" });
const paris = place("PL-PARIS");
const allPlaces = [tokyo, kyoto, osaka, paris];
const allVisits = [
  visit("VIS-TOKYO", "PL-TOKYO", { startDate: "2026-04-01", endDate: "2026-04-03", tripId: "TRIP-JAPAN" }),
  visit("VIS-KYOTO", "PL-KYOTO", { startDate: "2026-04-04", endDate: "2026-04-07", tripId: "TRIP-JAPAN" }),
  visit("VIS-PARIS", "PL-PARIS", { startDate: "2025-06-01" }),
];

/* ------------------------------------------------------------------ *
 * Place playlists
 * ------------------------------------------------------------------ */

test("a place's playlist holds that place's media and nothing else", () => {
  const kyotoPhoto = media({ placeId: "PL-KYOTO", visitId: "VIS-KYOTO", takenAt: "2026-04-05T10:00:00Z" });
  const kyotoClip = video({ placeId: "PL-KYOTO", visitId: "VIS-KYOTO", takenAt: "2026-04-06T10:00:00Z" });
  const tokyoPhoto = media({ placeId: "PL-TOKYO", visitId: "VIS-TOKYO", takenAt: "2026-04-02T10:00:00Z" });
  const journeyPhoto = media({ tripId: "TRIP-JAPAN", takenAt: "2026-04-01T08:00:00Z" });

  const playlist = playlistForPlace([kyotoPhoto, kyotoClip, tokyoPhoto, journeyPhoto], "PL-KYOTO");
  assert.deepEqual(playlist.map((item) => item.id), [kyotoPhoto.id, kyotoClip.id]);
});

test("place playlists span every visit of the place, residences included", () => {
  const stay = media({ placeId: "PL-KYOTO", visitId: "VIS-KYOTO", takenAt: "2026-04-05T10:00:00Z" });
  const residence = media({ placeId: "PL-KYOTO", visitId: "VIS-KYOTO-LIVED", takenAt: "2015-01-10T10:00:00Z" });
  const playlist = playlistForPlace([stay, residence], "PL-KYOTO");
  // Both visits' media, oldest capture first.
  assert.deepEqual(playlist.map((item) => item.id), [residence.id, stay.id]);
});

test("deleted media never plays", () => {
  const kept = media({ placeId: "PL-KYOTO", takenAt: "2026-04-05T10:00:00Z" });
  const gone = media({ placeId: "PL-KYOTO", takenAt: "2026-04-06T10:00:00Z", deletedAt: NOW });
  assert.deepEqual(
    playlistForPlace([kept, gone], "PL-KYOTO").map((item) => item.id),
    [kept.id],
  );
});

test("a place with no media has an empty playlist — no button to show", () => {
  assert.deepEqual(playlistForPlace([media({ placeId: "PL-TOKYO" })], "PL-KYOTO"), []);
});

/* ------------------------------------------------------------------ *
 * Trip playlists
 * ------------------------------------------------------------------ */

test("a trip's playlist combines every member place's media with the trip's own", () => {
  const tokyoPhoto = media({ placeId: "PL-TOKYO", visitId: "VIS-TOKYO", tripId: "TRIP-JAPAN", takenAt: "2026-04-02T09:00:00Z" });
  // Attached to Kyoto before it joined the trip: no Trip ID of its own.
  const kyotoPhoto = media({ placeId: "PL-KYOTO", takenAt: "2026-04-05T09:00:00Z" });
  // Osaka is a member through the legacy place-level cell alone.
  const osakaClip = video({ placeId: "PL-OSAKA", takenAt: "2026-04-08T09:00:00Z" });
  // Journey-level media, attached to the trip itself.
  const journeyPhoto = media({ tripId: "TRIP-JAPAN", takenAt: "2026-04-01T07:00:00Z" });
  const parisPhoto = media({ placeId: "PL-PARIS", takenAt: "2025-06-01T09:00:00Z" });
  const otherTripPhoto = media({ tripId: "TRIP-OTHER", takenAt: "2026-04-05T12:00:00Z" });

  const playlist = playlistForTrip(
    [parisPhoto, osakaClip, kyotoPhoto, journeyPhoto, tokyoPhoto, otherTripPhoto],
    japan,
    allPlaces,
    allVisits,
  );

  // Everything of the trip's, chronological across places — and nothing of
  // Paris's or the other trip's.
  assert.deepEqual(
    playlist.map((item) => item.id),
    [journeyPhoto.id, tokyoPhoto.id, kyotoPhoto.id, osakaClip.id],
  );
});

test("media reachable both from the trip and through its place plays once", () => {
  // A visit import stamps place, visit and trip — three routes, one record.
  const both = media({ placeId: "PL-KYOTO", visitId: "VIS-KYOTO", tripId: "TRIP-JAPAN", takenAt: "2026-04-05T09:00:00Z" });
  const playlist = playlistForTrip([both], japan, allPlaces, allVisits);
  assert.equal(playlist.length, 1);
  assert.equal(playlist[0].id, both.id);
});

test("trip playlists never copy a record — the place's own row is what plays", () => {
  const kyotoPhoto = media({ placeId: "PL-KYOTO", takenAt: "2026-04-05T09:00:00Z" });
  const playlist = playlistForTrip([kyotoPhoto], japan, allPlaces, allVisits);
  // Same object, not a clone: the trip player is a view over the same records.
  assert.equal(playlist[0], kyotoPhoto);
  assert.equal(playlist[0].placeId, "PL-KYOTO");
});

/* ------------------------------------------------------------------ *
 * Playback order
 * ------------------------------------------------------------------ */

test("playback runs in capture order, with the media id settling ties", () => {
  const second = media({ placeId: "P", takenAt: "2026-04-02T10:00:00Z" });
  const first = media({ placeId: "P", takenAt: "2026-04-01T10:00:00Z" });
  const twinB = media({ id: "TPHOTO-TIE-B", placeId: "P", takenAt: "2026-04-03T10:00:00Z" });
  const twinA = media({ id: "TPHOTO-TIE-A", placeId: "P", takenAt: "2026-04-03T10:00:00Z" });
  assert.deepEqual(
    playbackOrder([second, twinB, first, twinA]).map((item) => item.id),
    [first.id, second.id, "TPHOTO-TIE-A", "TPHOTO-TIE-B"],
  );
});

test("media with no capture date follows the chronology in saved order", () => {
  const dated = media({ placeId: "P", takenAt: "2026-04-01T10:00:00Z", createdAt: "2026-05-09T00:00:00Z" });
  const savedFirst = media({ placeId: "P", createdAt: "2026-05-01T00:00:00Z" });
  const savedSecond = media({ placeId: "P", createdAt: "2026-05-02T00:00:00Z" });
  assert.deepEqual(
    playbackOrder([savedSecond, dated, savedFirst]).map((item) => item.id),
    [dated.id, savedFirst.id, savedSecond.id],
  );
});

test("a saved custom order outranks the chronology once any item carries one", () => {
  const early = media({ placeId: "P", takenAt: "2026-04-01T10:00:00Z" });
  const late = media({ placeId: "P", takenAt: "2026-04-09T10:00:00Z", sortOrder: 1 });
  const middle = media({ placeId: "P", takenAt: "2026-04-05T10:00:00Z", sortOrder: 2 });
  // The two arranged items lead in their arranged order; the untouched one
  // follows — the seam a future "arrange playlist" screen writes into.
  assert.deepEqual(
    playbackOrder([early, middle, late]).map((item) => item.id),
    [late.id, middle.id, early.id],
  );
});

/* ------------------------------------------------------------------ *
 * Kinds and counts
 * ------------------------------------------------------------------ */

test("what plays as what: photos, stored clips, and posters for unstored clips", () => {
  assert.equal(playbackKind(media({})), "photo");
  assert.equal(playbackKind(video({})), "video");
  // A video too large for the script to store keeps its poster frames and
  // shows as a timed slide, honestly labelled — never a stalled player.
  assert.equal(playbackKind(media({ mimeType: "video/mp4" })), "poster");
});

test("the counts line reads like a person wrote it", () => {
  const set = [
    media({ placeId: "P" }),
    media({ placeId: "P" }),
    video({ placeId: "P" }),
    media({ placeId: "P", mimeType: "video/quicktime" }),
    media({ placeId: "P", deletedAt: NOW }),
  ];
  assert.deepEqual(mediaCounts(set), { photos: 2, videos: 2 });
  assert.equal(formatMediaCounts({ photos: 65, videos: 7 }), "65 photos · 7 videos");
  assert.equal(formatMediaCounts({ photos: 1, videos: 0 }), "1 photo");
  assert.equal(formatMediaCounts({ photos: 0, videos: 1 }), "1 video");
  assert.equal(formatMediaCounts({ photos: 0, videos: 0 }), "");
});

/* ------------------------------------------------------------------ *
 * The player state machine — photos and the clock
 * ------------------------------------------------------------------ */

/** Shorthand: run a list of events through the reducer. */
function run(state, events) {
  return events.reduce((current, event) => reducePlayer(current, event), state);
}

test("a photo holds for its four seconds, then the next item takes the screen", () => {
  let state = createPlayerState(["photo", "photo"]);
  assert.equal(state.status, "playing");
  assert.equal(DEFAULT_PHOTO_DURATION_MS, 4000);

  state = run(state, [{ type: "tick", deltaMs: 3900 }]);
  assert.equal(state.index, 0, "not yet — 3.9s in");
  state = run(state, [{ type: "tick", deltaMs: 100 }]);
  assert.equal(state.index, 1, "4.0s advances");
  assert.equal(state.photoElapsedMs, 0, "the next photo starts its own clock");
});

test("pause stops the photo clock; resume continues from the same position", () => {
  let state = createPlayerState(["photo", "photo"]);
  state = run(state, [{ type: "tick", deltaMs: 3000 }, { type: "pause" }]);
  assert.equal(state.status, "paused");
  assert.equal(state.photoElapsedMs, 3000);

  // A tick that arrives while paused counts for nothing.
  state = run(state, [{ type: "tick", deltaMs: 5000 }]);
  assert.equal(state.index, 0);
  assert.equal(state.photoElapsedMs, 3000, "paused time never accrues");

  // Resume: only the single remaining second is left to serve.
  state = run(state, [{ type: "play" }, { type: "tick", deltaMs: 999 }]);
  assert.equal(state.index, 0);
  state = run(state, [{ type: "tick", deltaMs: 1 }]);
  assert.equal(state.index, 1);
});

/* ------------------------------------------------------------------ *
 * The player state machine — videos
 * ------------------------------------------------------------------ */

test("a video ignores the clock and advances only on its own ended event", () => {
  let state = createPlayerState(["video", "photo"]);
  state = run(state, [
    { type: "tick", deltaMs: 60_000 },
    { type: "tick", deltaMs: 60_000 },
  ]);
  assert.equal(state.index, 0, "a minute of ticks moves a video nowhere");

  state = run(state, [{ type: "videoEnded" }]);
  assert.equal(state.index, 1, "ended is what advances");
});

test("a stray ended event from a photo slide is noise", () => {
  const state = run(createPlayerState(["photo", "photo"]), [{ type: "videoEnded" }]);
  assert.equal(state.index, 0);
});

test("pause and resume hold a video exactly where it is", () => {
  let state = createPlayerState(["video", "photo"]);
  state = run(state, [{ type: "pause" }]);
  assert.equal(state.status, "paused");
  state = run(state, [{ type: "play" }]);
  assert.equal(state.status, "playing");
  assert.equal(state.index, 0, "pausing never skips");
});

test("iOS refusing to continue with audio becomes Tap to continue, not a freeze", () => {
  let state = createPlayerState(["photo", "video"]);
  state = run(state, [{ type: "tick", deltaMs: 4000 }]);
  assert.equal(state.index, 1, "the playlist reached the video");

  // Safari rejects the programmatic play() — the player says so and waits.
  state = run(state, [{ type: "videoBlocked" }]);
  assert.equal(state.status, "blocked");
  state = run(state, [{ type: "tick", deltaMs: 10_000 }]);
  assert.equal(state.index, 1, "blocked never silently advances");

  // The tap resumes.
  state = run(state, [{ type: "play" }]);
  assert.equal(state.status, "playing");
});

test("a clip that cannot play becomes a timed poster and the show goes on", () => {
  let state = createPlayerState(["video", "photo"]);
  state = run(state, [{ type: "videoFailed" }]);
  assert.equal(state.status, "playing");
  assert.equal(isTimedItem(state), true, "the clock takes over the broken clip");

  state = run(state, [{ type: "tick", deltaMs: 4000 }]);
  assert.equal(state.index, 1, "the playlist flows past it");

  // Its ended event, arriving late from a dead element, is no longer trusted.
  const failedState = run(createPlayerState(["video", "photo"]), [{ type: "videoFailed" }]);
  assert.equal(run(failedState, [{ type: "videoEnded" }]).index, 0);
});

/* ------------------------------------------------------------------ *
 * The player state machine — navigation and completion
 * ------------------------------------------------------------------ */

test("previous and next step across photos and videos alike", () => {
  let state = createPlayerState(["photo", "video", "photo"]);
  state = run(state, [{ type: "next" }]);
  assert.equal(state.index, 1);
  state = run(state, [{ type: "next" }]);
  assert.equal(state.index, 2);
  state = run(state, [{ type: "previous" }]);
  assert.equal(state.index, 1);
  state = run(state, [{ type: "previous" }, { type: "previous" }]);
  assert.equal(state.index, 0, "previous at the start stays put");
});

test("a mixed playlist plays through in order and ends on the completion screen", () => {
  // The acceptance example: Photo A, Photo B, Video A, Photo C, Video B.
  let state = createPlayerState(["photo", "photo", "video", "photo", "video"]);
  const visited = [state.index];

  const script = [
    { type: "tick", deltaMs: 4000 },
    { type: "tick", deltaMs: 4000 },
    { type: "videoEnded" },
    { type: "tick", deltaMs: 4000 },
    { type: "videoEnded" },
  ];
  for (const event of script) {
    state = reducePlayer(state, event);
    visited.push(state.index);
  }

  assert.deepEqual(visited, [0, 1, 2, 3, 4, 4], "every item, in playlist order");
  assert.equal(state.status, "done", "then the completion screen");
  assert.deepEqual(playerPosition(state), { current: 5, total: 5 });
});

test("Play Again starts the whole show over; Close is the caller's", () => {
  let state = createPlayerState(["photo", "video"]);
  state = run(state, [
    { type: "tick", deltaMs: 4000 },
    { type: "videoFailed" },
    { type: "tick", deltaMs: 4000 },
  ]);
  assert.equal(state.status, "done");

  // Done is inert to everything except replay and previous.
  assert.equal(run(state, [{ type: "tick", deltaMs: 4000 }]).status, "done");
  assert.equal(run(state, [{ type: "next" }]).status, "done");
  assert.equal(run(state, [{ type: "toggle" }]).status, "done");

  state = run(state, [{ type: "replay" }]);
  assert.equal(state.index, 0);
  assert.equal(state.status, "playing");
  assert.deepEqual(state.failed, [false, false], "replay retries failed clips");
});

test("one photo, one video, photos-only and videos-only playlists all complete", () => {
  const onePhoto = run(createPlayerState(["photo"]), [{ type: "tick", deltaMs: 4000 }]);
  assert.equal(onePhoto.status, "done");

  const oneVideo = run(createPlayerState(["video"]), [{ type: "videoEnded" }]);
  assert.equal(oneVideo.status, "done");

  const photosOnly = run(createPlayerState(["photo", "photo", "photo"]), [
    { type: "tick", deltaMs: 4000 },
    { type: "tick", deltaMs: 4000 },
    { type: "tick", deltaMs: 4000 },
  ]);
  assert.equal(photosOnly.status, "done");

  const videosOnly = run(createPlayerState(["video", "video"]), [
    { type: "videoEnded" },
    { type: "videoEnded" },
  ]);
  assert.equal(videosOnly.status, "done");

  assert.equal(createPlayerState([]).status, "done", "nothing to play is already over");
});

test("the progress readout walks 0..1 through the playlist", () => {
  let state = createPlayerState(["photo", "photo", "photo", "photo"]);
  assert.equal(playlistProgress(state), 0);
  state = run(state, [{ type: "tick", deltaMs: 2000 }]);
  assert.equal(playlistProgress(state), 0.125, "half of the first quarter");
  state = run(state, [
    { type: "tick", deltaMs: 2000 },
    { type: "tick", deltaMs: 4000 },
    { type: "tick", deltaMs: 4000 },
    { type: "tick", deltaMs: 4000 },
  ]);
  assert.equal(playlistProgress(state), 1);
});

test("a custom photo duration is honoured — the seam for a future setting", () => {
  let state = createPlayerState(["photo", "photo"], { photoDurationMs: 6000 });
  state = run(state, [{ type: "tick", deltaMs: 4000 }]);
  assert.equal(state.index, 0, "4s is not enough at 6s per photo");
  state = run(state, [{ type: "tick", deltaMs: 2000 }]);
  assert.equal(state.index, 1);
});

/* ------------------------------------------------------------------ *
 * Google Photos stays read-only
 *
 * Playback and removal work entirely on the app's own records and Drive
 * copies. These are tripwires on the source itself: the day someone wires
 * a Google Photos mutation — or quietly drops a cleanup — a test names it.
 * ------------------------------------------------------------------ */

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the Apps Script holds only the read-only picker scope, never the Library API", () => {
  const script = readSource("../apps-script/Code.gs");
  assert.ok(
    script.includes("photospicker.mediaitems.readonly"),
    "the one Photos scope is the picker's read-only one",
  );
  assert.ok(!/photoslibrary/i.test(script), "the mutable Library API is never named");
  for (const verb of ["batchRemove", "batchAddMediaItems", "batchCreate", "setArchived"]) {
    assert.ok(!script.includes(verb), `no Photos mutation verb: ${verb}`);
  }
});

test("removing media is a sheet tombstone — no delete the client can send names Google", () => {
  const client = readSource("../lib/sheets/sheetsClient.ts");
  assert.ok(
    !/https:\/\/[a-z0-9.-]*googleapis\.com/i.test(client),
    "the browser talks to the Apps Script, never to a Google API endpoint",
  );
  const actions = [...client.matchAll(/action: "([A-Za-z]+)"/g)].map((match) => match[1]);
  const destructive = actions.filter((action) => /delete|remove|archive|trash|move/i.test(action));
  assert.deepEqual(
    [...new Set(destructive)].sort(),
    ["deletePhotoPickerSession", "deleteRow", "deleteTravelPhoto"],
    "every destructive action targets the app's own rows or a picker session",
  );
});

test("playback is read-only: the player and its playlists cannot write anything", () => {
  const sources = [
    readSource("../components/photos/TravelMediaPlayer.tsx"),
    readSource("../lib/photos/mediaPlaylist.ts"),
    readSource("../lib/photos/playerCore.ts"),
  ].join("\n");
  for (const forbidden of [
    "deleteTravelPhoto",
    "removeTravelPhoto",
    "upsertRow",
    "postToSheet",
    "importPickedPhotos",
    "googleapis.com",
  ]) {
    assert.ok(!sources.includes(forbidden), `playback never reaches ${forbidden}`);
  }
});

test("the video rendition can actually be asked for — and only by photo id", () => {
  const params = travelPhotoRequestParams("TPHOTO-0001", "video", "secret");
  assert.equal(params.size, "video");
  assert.deepEqual(Object.keys(params).sort(), ["action", "media", "photoId", "size"]);
  // Unknown sizes still collapse to thumb rather than passing through.
  assert.equal(travelPhotoRequestParams("x", "original", "s").size, "thumb");
});

test("the player cleans up what it opens: every timer, listener and URL has an exit", () => {
  const player = readSource("../components/photos/TravelMediaPlayer.tsx");
  const count = (needle) => player.split(needle).length - 1;
  assert.equal(
    count("URL.createObjectURL"),
    count("URL.revokeObjectURL"),
    "object URLs are revoked as they are replaced or the player closes",
  );
  assert.equal(count("setInterval"), count("clearInterval"), "the photo clock is cleared");
  assert.equal(
    count("addEventListener"),
    count("removeEventListener"),
    "window and document listeners are removed",
  );
});

test("iPhone Safari gets inline video and an honest tap when autoplay is refused", () => {
  const player = readSource("../components/photos/TravelMediaPlayer.tsx");
  assert.ok(player.includes("playsInline"), "video plays inline on iPhone");
  assert.ok(player.includes("Tap to continue"), "a blocked continuation asks for a tap");
  assert.ok(player.includes("NotAllowedError"), "the rejected play() promise is caught");
});

if (failures > 0) {
  console.error(`\n${failures} media player test(s) failed.`);
  process.exit(1);
}
console.log("  all media player tests passed\n");
