# Travel Globe

A personal, visual history of everywhere you’ve been — pinned to an interactive
Earth. Built iPhone-first.

Six ways to look at the same travel history:

- **Globe** — a full-screen 3D Earth you can spin and zoom from whole-planet
  down to street level, with every saved place pinned and nearby pins clustered.
- **Timeline** — the same history as a chronology, oldest first, with a
  scrubber whose bars are the years themselves: as tall as that year was busy,
  so the shape of the control shows where the travelling happened before you
  touch it. Each year is one bar wide however much happened in it, and dragging
  inside a bar walks that year's places one at a time — a nine-stop year is
  somewhere you can move around in, not just somewhere to be dropped at the top
  of. The list keeps up with your thumb rather than gliding after it, the
  readout above the track names the place under it, and scrolling by hand drags
  the handle back.
- **Places** — a searchable, sortable collection of the same records, as a
  travel journal rather than a table.
- **Trips** — the same places grouped into the journeys they belonged to, laid
  out day by day. Day numbers are counted from the trip's start date rather
  than stored, so nothing goes stale when a date moves. A trip is a label on
  visits, never a container for them: a place belongs to at most one, most
  places belong to none, and deleting a trip leaves every place exactly where
  it was. **Select** in Places ticks several at once and files the lot into a
  trip — or into one made on the spot — which is how a trip actually gets
  built: you come home, add everywhere you went, and only then decide they
  belonged together.
- **Player** — every trip and place with photos or videos attached, in one
  list, newest memories first. Tap an entry and it opens in place: a Play
  button for the full-screen show, the same gallery strip the cards use for
  browsing one photo or video at a time, and a link through to the full card.
  Nothing with an empty gallery appears, so everything here is watchable.
- **Stats** — the journal as a scoreboard. *Your regulars* ranks the places
  been to more than once — the theme park that keeps winning; *where you keep
  going* reads the same stays a country or a continent at a time; and a
  years-by-countries matrix crosses your busiest countries with the calendar,
  a contribution graph for travel. Every row and every cell drills down to
  the places behind the number, and each of those opens its own card — it is
  a way through the collection, not a trophy shelf. Only stays that actually
  happened count: wishlist entries, upcoming bookings and years spent living
  somewhere never inflate a visit tally.

A saved place is one of two things, and the app keeps them apart: somewhere
you have **been**, or somewhere you **want to go**. A wishlist entry has no
visit date, stays off the timeline, does not count towards the countries you
have seen, and shows on the globe in its own colour. Either kind can be marked
a **favourite** — one tap from the card, the pin or the detail sheet — and
Places filters to favourites, been, or still to go without opening a menu.

A place you keep going back to stays **one place with many visits**. Its card
opens on the numbers — visits, days total, first visited, last visit — above
the stays themselves, each with its dates, its length and the kind of trip it
was, and **Add visit** logs another. Adding a place you have already been to —
same name in the same country, or a pin on the same spot — doesn't grow a
duplicate: the existing place gains a visit, and the card opens to show it.

Adding, pinning, editing, moving and deleting a place are the core of the app,
and every change lands in all four views on the same frame.

---

## Running it

```bash
npm install
npm run mock-sheet   # in one terminal
npm run dev          # in another
```

Open <http://localhost:3000> — and open it in a phone-sized viewport, that’s
what it’s designed for.

The app reads everything from a Google Sheet, so it needs something to talk to.
`npm run mock-sheet` serves the same protocol the Apps Script does, against an
in-memory fixture — connect the app to `http://localhost:8787/` with the access
code the script prints, and every screen works without touching real data. To
develop against your own sheet instead, use its `/exec` address.

**There are no API keys to set up.** The map, the place search and the country
outlines are all keyless — the only thing to point the app at is a sheet, real
or mocked.

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Development server                              |
| `npm run build`     | Production build                                |
| `npm run typecheck` | `tsc --noEmit`                                  |
| `npm run lint`      | ESLint                                          |
| `npm run test`      | Paint expressions, sheet mapping, write queue, connection, timeline |
| `npm run check`     | All four, in order                              |
| `npm run icons`     | Regenerates the app icons from `scripts/`       |
| `npm run countries` | Rebuilds `public/geo/countries.json` from Natural Earth |
| `npm run map-worker` | Copies MapLibre's worker into `public/` (runs automatically) |
| `npm run mock-sheet` | Local stand-in for the Apps Script, for development |

### Where the map comes from

| Service                                                | Used for                             | Key needed |
| ------------------------------------------------------ | ------------------------------------ | ---------- |
| [OpenFreeMap](https://openfreemap.org/)                 | Vector basemap tiles (light and dark) | No |
| [Photon](https://photon.komoot.io/)                     | Place search and reverse geocoding    | No |
| [Natural Earth](https://www.naturalearthdata.com/) 110m | Country outlines, bundled as a 164 KB asset | No |

All three are open and free to use without an account, so the globe works on a
fresh clone and on the deployed site with nothing to configure. The country
outlines are checked in — `npm run countries` regenerates them, and only needs
running if you want a different resolution.

### Environment

Nothing to configure. The map services need no key, and the Google Sheet
connection is deliberately *not* an environment variable — a static site has no
server to read one on. It lives in `lib/sheets/defaultConnection.ts` instead,
which is honest about the fact that anything there is public. See
[docs/SHEET-SETUP.md](docs/SHEET-SETUP.md).

**If the map can't be reached at all** — an offline device, a blocked network —
the globe shows a designed explanation instead of a crash, and Places, search,
adding, editing, moving and deleting all keep working. A place can always be
entered by hand, coordinates included.

---

## Deployment

Live at **<https://aadsit7.github.io/Game-Night/>**.

Every push to `main` runs `.github/workflows/deploy.yml`, which type-checks,
lints, builds a static export and publishes it to GitHub Pages. The app is
entirely client-side, so there is nothing to run on a server.

Two environment variables drive the build, both set by the workflow:

- `STATIC_EXPORT=true` turns on `output: "export"`.
- `NEXT_PUBLIC_BASE_PATH` is taken from the Pages configuration (`/Game-Night`
  for a project site) so assets resolve under the subpath. Both are opt-in, so
  `npm run dev` and a plain `npm run build` still serve from `/`.

No secrets are configured for the deploy, and none would help if they were:
anything prefixed `NEXT_PUBLIC_` is compiled into the JavaScript that ships to
every visitor, and so is everything else in the bundle. The map side of that is
solved by having no key at all. The sheet side is not solvable — see
[Where your data lives](#where-your-data-lives) — so it is stated plainly in
`lib/sheets/defaultConnection.ts` rather than dressed up as a secret.

---

## Where your data lives

Your places live in a **Google Sheet**, reached through a Google Apps Script web
app. That sheet is the single source of truth: the app loads from it on open,
writes back to it on every change, and any browser on any device sees the same
data.

The web app address and access code live in
[`lib/sheets/defaultConnection.ts`](lib/sheets/defaultConnection.ts), so the
published site works on any device with nothing to set up. Leave them blank and
the app asks for them instead, once per browser, keeping them in localStorage.
[**docs/SHEET-SETUP.md**](docs/SHEET-SETUP.md) covers publishing the script,
what the deployment settings mean, the re-deploy trap, and the trade-off between
those two modes.

> **Why Apps Script and not the Sheets API directly?** Because this is a static
> site: any credential compiled into it is delivered to every visitor's browser
> and can be read straight out of the page source. Apps Script runs on Google's
> servers under the sheet owner's own account, so no *Google* credential ever
> reaches the browser and the spreadsheet itself stays private — what the site
> carries is a door into one script, not access to the file, Drive or the
> account. Baking the code in makes that door public; typing it per-browser
> does not. Neither option can hide it once it is in the bundle, because a
> browser cannot keep a secret.

**On open**, one request pulls every data tab at once. **On change**, the record
is written back immediately — there is no Save button. A localStorage copy is
kept purely as a cache so the app shows something offline; a successful load
overwrites it wholesale, because the sheet always wins.

**A write that fails is queued, not lost.** It is retried with backoff, on
regaining focus, and the moment the browser reports itself back online. The chip
beside "My Places" reads *Not saved yet* until the queue drains, and edits to
one record coalesce into a single write rather than one per keystroke.

Deleting never removes a row — it sets `Deleted?` to `Yes`. Removing rows would
shift everything beneath them and break the live formulas on `Search_View` and
`Dashboard`. For the same reason, the script refuses by name to write to
`Search_View`, `Dashboard` or `Guide`.

Only the fields you actually changed are sent. The Apps Script reads the rest of
the row from the sheet and writes it straight back, so the ~60 `Places` columns
the app has no screen for survive untouched — and columns are addressed by
header text, never by position, so inserting one is safe across all 78.

**Favourites and the wishlist were already in the sheet.** `Favorite` is a
`Yes`/`No` column and `Status` holds the sheet's own words, so neither needed a
schema change. `Status` is written only when the answer to "have I been?"
actually changes, which is what stops a place marked `Lived there` or
`Passed through` being flattened to `Been` by an unrelated save.

**Trips live in their own tab.** A `Trips` row holds a trip's name, dates and
description; a place joins one through the `Trip ID / Collection` column that
was already on `Places`. Nothing about a trip is stored twice — its length, the
places in it and the countries it covers are all counted from the rows
themselves at render time. A blank trip cell means "no trip", which is what
every row written before this feature already says, and clearing the cell is
how a place leaves a trip without being deleted. The `Trips` tab is created by
the Apps Script on first run, so there is nothing to add by hand.

**Visits live in their own tab too.** Each stay at a place is a row on
`Dates_Visits` — the tab the spreadsheet always had for exactly this — keyed
by `Place ID`, with the row's own `Days`, `Year`, `Month` and `Season` filled
in from the dates and `Trip Type` drawn from the sheet's own Lookups. The
place's `First/Last Visited Date`, `Visit Count` and `Days Spent Total` are
re-derived from its visit rows on every change, so the timeline and the sort
orders keep working on one date range however many stays it folds. A place
recorded before visits existed shows its old dates as its first visit, and
that visit is written down for real the first time another is logged.

**Photos follow your account, when the script allows it.** A photo lands in
this browser's IndexedDB first, so nothing waits on the network. A deployment
that advertises `photoUpload` then gets each one once — the script files it in
a **Travel Globe Photos** folder in the sheet owner's Drive and answers with a
link, the cover link goes into `Photo URL`, and every upload becomes a `Photo`
row on `Media_Links`, which is how the same pictures appear on every device.
An older deployment changes nothing: photos simply stay local, exactly as
before.

---

## Architecture

### One collection, two views

`PlacesProvider` holds the only copy of the travel data. The globe, the
timeline and the list all read from it; none keeps its own. That is what makes
"rename it in the list and the pin's label changes" true by construction rather
than by remembering to sync. The timeline's chronology is derived in
`lib/timeline/buildTimeline.ts` — a pure function over that same array, so the
date reasoning is testable without a browser. The scrubber's track is built
there too: which places it can land on, and where each of them sits on it.

```
lib/store/PlacesProvider.tsx   ← the single source of truth
lib/store/draft.ts             ← the shape a place takes while being written
```

`PlacesProvider` keeps no copy of its own: the repository *is* the store, and
React subscribes to it with `useSyncExternalStore`. Two copies could disagree;
one cannot. Writes land in the repository's memory synchronously and go to the
sheet immediately after, so the UI updates on the same frame as the tap and a
failed request becomes a queued retry rather than a lost edit.

### Persistence behind one seam

```ts
placeRepository.getAll();
placeRepository.getById(id);
placeRepository.create(place);
placeRepository.update(id, changes);
placeRepository.delete(id); // soft: sets Deleted? to Yes
placeRepository.updateCoordinates(id, latitude, longitude);
placeRepository.restore(place); // undo
```

No component touches storage directly. That seam is what made moving the
collection out of localStorage and into a Google Sheet a matter of writing a
second implementation — `lib/storage/sheetPlaceRepository.ts` — without changing
a single screen.

Below it, `lib/sheets/sheetsClient.ts` is the *only* module in the app that
makes a network call, and every write in it goes through one `postToSheet`
helper.

Photos are deliberately *not* in that collection. A place record is a few
hundred bytes and a photo is a few hundred kilobytes, so images land in
IndexedDB (`lib/storage/photoStore.ts`), downscaled to 1600px on the way in.
The travel data never bumps into the 5 MB localStorage ceiling, and the split
is why a photo cannot go into a spreadsheet cell: a `Photo URL` is text every
device can resolve, a blob reference is not. When the deployed script offers
`uploadPhoto`, a background sweep turns each blob into exactly that — a Drive
link written into the sheet — and deletes the local copy it replaced.

### Two ways to read the map

A **Countries / Cities** toggle sits above the tab bar. Countries paints every
visited country and answers "how much of the world have I seen"; tapping one
frames its places and drops you into Cities, which shows the individual pins and
answers "where exactly was I". Search sits over the map itself, covering saved
places, so finding somewhere you've been never means leaving the globe.

City pins are small circles rather than large teardrops: at a hundred places a
map should still read as a constellation instead of a pile of overlapping
markers.

### Colour

One rule decides everything: **the basemap is ground, your travel is figure.**
The map you have not been to should be the quietest thing on the screen.

OpenFreeMap's styles are built for general browsing, so they start in the
opposite place, and `lib/maps/theme.ts` re-colours them layer by layer:

- **The relief photograph is off.** At world scale Natural Earth II's shaded
  terrain was the most saturated, most textured thing on the globe — and the
  part of the picture you have no relationship with. Without it, the planet's
  shape comes from the land/water edge, which is what a map is.
- **Land is lighter than sea in dark mode.** The shipped dark style puts them
  1.14:1 apart, which at globe zoom is a featureless black disc with no
  coastlines. Graphite land over a blue-black ocean takes that to 1.43:1.
- **Roads are not orange.** OpenFreeMap draws motorways in `hsl(26,87%,62%)` —
  the pin's own hue — so at city zoom the road network and your places competed
  as the same kind of mark. Light roads are white on warm grey; dark roads sit
  *above* land rather than below it, the way every night map ships.
- **Labels wait.** The dark style draws suburbs, villages and administrative
  subdivisions from zoom 0, so a view of Africa arrived captioned SOUSS-MASSA
  and LIKOUALA. Country names return at zoom 2.6, cities at 4, towns at 7. The
  sprite dot each style draws beside every city name is hidden outright: on the
  new land it measured 17.8:1 where your own pin measures 4.4:1.
- **No borders across open ocean.** Maritime boundaries live in the same layer
  as land borders, so lifting borders enough to read at globe zoom ruled pale
  lines across empty sea.

Visited countries are **teal**, not blue, because the ocean is blue and at globe
zoom most of a country's perimeter is coastline rather than border. Pins are a
deep vermilion. Both are split per scheme — a single hex cannot be the salient
thing on two grounds seventy L\* apart — and the rules are asserted in
`tests/paint-expressions.test.mjs` rather than left to taste.

### The globe

`components/globe/TravelGlobe.tsx` creates the MapLibre instance exactly once
and never tears it down — switching to Places slides that view *over* the globe
rather than unmounting it. Callbacks and layout values are read through refs so
a parent re-render can never restart the map.

- OpenFreeMap's `liberty` / `dark` styles with MapLibre's globe projection; the
  style follows the system colour scheme.
- Layers are installed by one idempotent function bound to `style.load`, so a
  light/dark swap — which replaces the entire style — rebuilds pins, clusters
  and country fills automatically instead of losing them. A `styleEpoch` counter
  ticks on each load so everything *applied* to those layers since — which
  countries are painted, which pin is selected, which layers the Countries view
  hides — is re-applied too.
- MapLibre's worker is served from `public/maplibre/` and pointed at with
  `setWorkerUrl`. MapLibre locates it from `import.meta.url`, which a bundler
  rewrites, leaving `new Worker("")` — and since every vector tile, GeoJSON
  source and glyph is parsed in that worker, the map silently drew nothing but
  its raster layer. `scripts/copy-map-worker.mjs` keeps the copy in step.
- Pins are circle layers rather than sprites: at a hundred places the map should
  read as a constellation, and circles stay crisp at every pixel ratio.
- A clustered GeoJSON source; tapping a cluster asks MapLibre for its expansion
  zoom (a promise, not a callback — MapLibre differs from Mapbox here) and eases
  there.
- Visited countries are painted from a bundled Natural Earth asset, strong in
  Countries view and a whisper in Cities so pins always win.
- Bearing and pitch are locked. Free rotation on a sphere is disorienting and
  easy to trigger by accident; this globe spins and zooms.
- Zoom out far enough and the map becomes a place in space: the planet hangs
  against a fixed starfield with a faint Milky Way, four slowly twinkling
  stars, a cratered Moon, a ringed Saturn and a small Mars. All of it is CSS
  behind the transparent canvas, so the Earth eclipses each body naturally as
  you zoom — no thresholds, just occlusion — and none of it costs the map a
  frame. The atmosphere is the renderer's own: a full blue limb at globe zoom
  that thins as the planet becomes a map and is gone before street level.

### Finding real places

Search runs through OpenStreetMap by default — no key, no account, nothing to
set up. Add a `GOOGLE_MAPS_API_KEY` script property to the Apps Script and it
uses Google Places instead, which is markedly better at ordinary businesses:
four branches of the same coffee shop come back as four rows with four
addresses rather than four identical ones.

The key lives on the script, never in the bundle, for exactly the reason the
sheet credentials do — this is a public static site. Google is never a hard
dependency either: a key that is missing, restricted, unbilled or briefly
unhappy falls through to the keyless geocoder rather than leaving anyone unable
to add a place.

Every saved place also links out to Google Maps: **Google Maps** and
**Directions** buttons on the place card, and a directions shortcut on the
pin preview over the globe. The links are the official cross-platform URLs —
they open the Google Maps app on a phone, need no key, and work for every
place. A place added from a Google search result remembers its listing id (the
sheet's `Google Place ID` column), so its links open the actual listing —
hours, photos, reviews — while any other place opens as a pin on the exact
spot.

With the key set, the card goes further: a **Google Maps** section shows the
listing itself — the star rating and how many people gave it, whether it is
open right now and today's hours, what Google calls it, the local time there,
the address, and tappable website and phone rows. A place that closed for good
since you visited says so. Places saved before any of this existed link
themselves up on first open: one search biased to the saved pin, taken only on
a confident match, then remembered in the sheet. Only the listing *id* is ever
stored — the content is fetched fresh and cached for six hours, which is what
Google's terms ask. One card open is one Place Details call (1,000 free a
month, and the cache absorbs reopens), so a personal journal stays inside the
free allowance. See
[Google Maps search](docs/SHEET-SETUP.md#optional-google-maps-search) for the
key setup.


`lib/maps/geocoding.ts` uses **Photon**, an open geocoder over OpenStreetMap
data. Raw OSM results lean heavily towards street addresses, so results are
re-ranked to put cities and points of interest first — "Sagrada Família"
resolves to the basilica in Barcelona, not to a street near it. Searches are
biased towards where the map is currently looking. Choosing a result fills in
name, city, region, country, country code and coordinates.

### Layout

```
app/                     layout, page, manifest, generated icons
components/
  AppShell.tsx           the one place that knows what is on screen
  AppTabBar.tsx          Globe | Timeline | Places | Trips | Player + add
  globe/                 TravelGlobe, overlays, preview sheet, fallback
  timeline/              chronology view and its scrubber
  places/                list, cards, search, filters, stats
  trips/                 trip list, trip detail by day, trip form
  sync/                  setup screen, connection form, settings sheet
  place/                 detail, form, location search, photos, pin bar
  photos/                cloud gallery, Google Photos flow, memories player, Player tab
  ui/                    BottomSheet, SegmentedControl, dialogs, imagery
lib/
  maps/                  basemap config and layer ids, geocoding
  trips/                 day numbering, trip summaries and bulk tagging
  storage/               PlaceRepository seam, sheetPlaceRepository, photoStore
  store/                 PlacesProvider, draft
  sheets/                sheetsClient (all network), mapping, queue, cache,
                         defaultConnection (the built-in address and code)
  hooks/  utils/
types/place.ts           the VisitedPlace model
types/trip.ts            the Trip model
apps-script/Code.gs      the Google Apps Script web app, to paste into the sheet
public/geo/countries.json  country outlines (generated, checked in)
scripts/generate-icons.mjs
scripts/build-countries.mjs
```

---

## iPhone details worth knowing about

- **Safe areas.** `viewport-fit=cover` throughout. The tab bar and every sheet
  pad to `env(safe-area-inset-bottom)`; the Places title and its sticky search
  bar sit below `env(safe-area-inset-top)`, clear of the Dynamic Island.
- **The keyboard.** iOS Safari does not resize the layout viewport when the
  keyboard appears, so `useKeyboardInset` watches `visualViewport` and lifts
  sheets by exactly the overlap. Save buttons stay reachable and no field
  disappears behind the keys.
- **Sheets.** Presented sheets are opaque and dim what's behind them, the way
  iOS presents them; only floating chrome — the tab bar, the pin preview,
  action sheets — is translucent. Full sheets are dragged by their grabber and
  header so dragging never fights scrolling.
- **Touch targets** are 44px or larger throughout, and no important action is
  reachable only by hover or only by swipe.
- **Reduced motion** is respected by every animation, including the globe's
  entrance and camera flights.
- **Dark mode** follows the system with a purpose-built palette, not an
  inversion — including the globe's own lighting and the pin label halos.

## Photography

Attached photographs are downscaled and kept in IndexedDB, then uploaded to
the sheet owner's Drive when the deployed script supports it, so they follow
the account rather than the browser. A place without one still gets a picture
rather than a hole in the layout: a calm gradient keyed off the place name,
with a small pin mark. The gradient sits underneath the image at all times, so
a slow or failed load reveals something intentional — no card ever shows a
broken-image icon.

**Adding media asks where from.** The same Add button reaches both places
photos live: the Google Photos picker, and the files on the device itself —
the photo library, the Files app, a Drive folder. Both routes take photos
*and videos*, and both end in the same Travel_Photos rows, so a clip picked
from a Drive folder plays exactly like one imported from Google Photos. A
device file is rendered down to gallery sizes in the browser (the script
cannot decode an arbitrary video), a clip up to 25 MB travels whole, and a
larger one honestly becomes its labelled poster frame. The picker in the
place form takes videos too — they join the place's memories, held until a
brand-new place is saved so they have a record to attach to.

**Play Memories** turns any place's or trip's media into a full-screen show:
photos hold for four seconds and dissolve into each other, videos play inline
with their own sound and yield on their `ended` event, and one pause button
holds both kinds. A trip's show combines the trip's own media with every
member place's — selected, never copied, and deduplicated by the record's own
id — in capture order across the whole journey. The playlist logic and the
player's state machine are pure modules (`lib/photos/mediaPlaylist.ts`,
`lib/photos/playerCore.ts`), so both are tested without a browser in
`tests/media-player.test.mjs`. Playback reads the app's own stored copies
through the same cache the galleries use; Google Photos originals are never
touched, and a clip too large for the script to have stored plays as its
poster frame, honestly labelled, rather than stalling the show. When iOS
Safari declines to continue a later video's audio without a fresh gesture,
the player asks for one tap instead of freezing.

## Deliberately not built yet

No accounts, no sharing, no trip planning, no analytics dashboards. The model in
`types/place.ts` is designed to grow — trips, companions, favourites, ratings —
without migrating anything that already exists.
