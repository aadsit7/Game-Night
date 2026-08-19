# Travel Globe

A personal, visual history of everywhere you’ve been — pinned to an interactive
Earth. Built iPhone-first.

Two ways to look at the same travel history:

- **Globe** — a full-screen 3D Earth you can spin and zoom from whole-planet
  down to street level, with every saved place pinned and nearby pins clustered.
- **Places** — a searchable, sortable collection of the same records, as a
  travel journal rather than a table.

Adding, pinning, editing, moving and deleting a place are the core of the app,
and every change lands in both views on the same frame.

---

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:3000> — and open it in a phone-sized viewport, that’s
what it’s designed for.

**There are no API keys to set up.** The map, the place search and the country
outlines are all keyless; `npm install && npm run dev` is the whole setup.

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Development server                              |
| `npm run build`     | Production build                                |
| `npm run typecheck` | `tsc --noEmit`                                  |
| `npm run lint`      | ESLint                                          |
| `npm run test`      | Paint expressions and sync merge rules          |
| `npm run check`     | All four, in order                              |
| `npm run icons`     | Regenerates the app icons from `scripts/`       |
| `npm run countries` | Rebuilds `public/geo/countries.json` from Natural Earth |
| `npm run map-worker` | Copies MapLibre's worker into `public/` (runs automatically) |

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

| Variable                       | Required | Purpose                                              |
| ------------------------------ | -------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_SEED_SAMPLE_DATA` | No       | `false` starts with an empty history. Anything else seeds fourteen sample places once, on first run. |

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

No secrets are configured for the deploy, and none are needed: the map has no
key to leak. That is the point of the keyless stack — anything prefixed
`NEXT_PUBLIC_` is compiled into the JavaScript that ships to every visitor, so
the safest credential is the one that doesn't exist.

---

## Syncing across devices

Your places live in `data/places.json` **in this repository**. That file is the
shared copy, and it is what makes the same URL show the same travel history on
a phone, a laptop and a tablet.

**Reading takes no setup.** The repository is public, so opening the site on any
device pulls the current file — no sign-in, nothing to configure. The app pulls
on load, whenever the tab regains focus, and on a slow timer while it's open.
Token-less devices read through `raw.githubusercontent.com` rather than the
API: the unauthenticated Contents API allows only 60 requests an hour per IP,
which two read-only devices polling for updates would exhaust between them. The
trade is that the CDN caches for five minutes, so a device that only reads can
be that far behind; a device with a token goes through the API and sees writes
immediately.

**Saving needs a token, once per device.** Open Sync (the ⚙ next to the map
search, or the chip beside "My Places") and paste a
[fine-grained token](https://github.com/settings/personal-access-tokens/new)
scoped to this repository with **Contents: read and write**. Edits are then
debounced and committed for you — a burst of typing becomes one commit, not one
per keystroke.

> **Why isn't the token just built in?** Because this is a static site: any
> value compiled into it is delivered to every visitor's browser and can be read
> straight out of the page source. A token in the bundle would hand write access
> to the repository to anyone who opened the URL, and GitHub would revoke it on
> sight. Keeping it per-device is the only version of this that is actually safe.

Devices reconcile by last-write-wins per record. Deletions are tombstones rather
than removals, so deleting on one device doesn't get undone by another device
that still had the row; tombstones are pruned after 90 days. A save that loses a
race is not dropped — the file is re-read, merged and written again.

Sample data is only laid down once the first sync has settled and the
repository has turned out to be genuinely empty — otherwise a new device would
merge fourteen sample places into a real travel history and push them back up.

Commits to `data/` are excluded from the deploy workflow, so saving a place
doesn't rebuild the site.

---

## Architecture

### One collection, two views

`PlacesProvider` holds the only copy of the travel data. The globe and the list
both read from it; neither keeps its own. That is what makes "rename it in the
list and the pin's label changes" true by construction rather than by
remembering to sync.

```
lib/store/PlacesProvider.tsx   ← the single source of truth
lib/store/draft.ts             ← the shape a place takes while being written
```

Writes are applied to state first and persisted immediately after. A
localStorage round-trip is sub-millisecond, so the UI updates on the same frame
as the tap; if a write fails, state is reconciled back to what is actually on
disk and the error is surfaced in plain language.

### Persistence behind one seam

```ts
placeRepository.getAll();
placeRepository.getById(id);
placeRepository.create(place);
placeRepository.update(id, changes);
placeRepository.delete(id);
placeRepository.updateCoordinates(id, latitude, longitude);
placeRepository.restore(place); // undo
```

No component touches storage directly. The current implementation is
localStorage; swapping in Supabase means writing a second implementation of
`PlaceRepository` and changing one export.

Photos are deliberately *not* in that collection. A place record is a few
hundred bytes and a photo is a few hundred kilobytes, so images live in
IndexedDB (`lib/storage/photoStore.ts`), downscaled to 1600px on the way in.
The travel data never bumps into the 5 MB localStorage ceiling, and the split
mirrors the shape a cloud backend would take.

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

### Finding real places

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
  AppTabBar.tsx          Globe | Places + the add button
  globe/                 TravelGlobe, overlays, preview sheet, fallback
  places/                list, cards, search, filters, stats
  sync/                  sync settings sheet
  place/                 detail, form, location search, photos, pin bar
  ui/                    BottomSheet, SegmentedControl, dialogs, imagery
lib/
  maps/                  basemap config and layer ids, geocoding
  storage/               placeRepository, photoStore
  store/                 PlacesProvider, draft
  sync/                  GitHub storage, merge rules, sync hook
  hooks/  utils/
types/place.ts           the VisitedPlace model
data/samplePlaces.ts     seed data, isolated so it can be deleted outright
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

Attached photographs are downscaled and kept in IndexedDB. A place without one
still gets a picture rather than a hole in the layout: a calm gradient keyed off
the place name, with a small pin mark. The gradient sits underneath the image at
all times, so a slow or failed load reveals something intentional — no card ever
shows a broken-image icon.

## Deliberately not built yet

No accounts, no sharing, no trip planning, no analytics dashboards. The model in
`types/place.ts` is designed to grow — trips, companions, favourites, ratings —
without migrating anything that already exists.
