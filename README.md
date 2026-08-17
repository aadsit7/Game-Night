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
cp .env.example .env.local     # then paste your Mapbox token in
npm run dev
```

Open <http://localhost:3000> — and open it in a phone-sized viewport, that’s
what it’s designed for.

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Development server                              |
| `npm run build`     | Production build                                |
| `npm run typecheck` | `tsc --noEmit`                                  |
| `npm run lint`      | ESLint                                          |
| `npm run check`     | All three, in order                             |
| `npm run icons`     | Regenerates the app icons from `scripts/`       |

### Environment

| Variable                          | Required | Purpose                                              |
| --------------------------------- | -------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | For the globe | Globe rendering, location search, reverse geocoding, and the satellite imagery used when a place has no photo. Get one at [account.mapbox.com](https://account.mapbox.com/access-tokens/). |
| `NEXT_PUBLIC_SEED_SAMPLE_DATA`    | No       | `false` starts with an empty history. Anything else seeds fourteen sample places once, on first run. |

**Without a token the app still works.** The globe shows a designed explanation
instead of a crash, and Places, search, adding, editing, moving and deleting all
keep working — a place can be entered by hand, coordinates included.

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

### The globe

`components/globe/TravelGlobe.tsx` creates the Mapbox instance exactly once and
never tears it down — switching to Places slides that view *over* the globe
rather than unmounting it. Callbacks and layout values are read through refs so
a parent re-render can never restart the map.

- `mapbox://styles/mapbox/standard` with globe projection; the light preset
  follows the system colour scheme (`day` / `night`).
- Pins are drawn to a canvas at 2× and registered as style images, so the
  selected and unselected states stay in exact proportion.
- A clustered GeoJSON source; tapping a cluster asks Mapbox for its expansion
  zoom and eases there.
- Visited countries get a whisper of colour at globe scale that fades out
  entirely by zoom 6 — subordinate to the pins, never a choropleth.
- Bearing and pitch are locked. Free rotation on a sphere is disorienting and
  easy to trigger by accident; this globe spins and zooms.

### Finding real places

`lib/maps/geocoding.ts` uses the Mapbox **Search Box** API, which returns points
of interest alongside cities and countries — so "Sagrada Família" resolves to
the basilica in Barcelona, not just to Barcelona. The Geocoding v6 API is a
fallback for accounts or networks where Search Box is unavailable. Choosing a
result fills in name, city, region, country, country code and coordinates.

### Layout

```
app/                     layout, page, manifest, generated icons
components/
  AppShell.tsx           the one place that knows what is on screen
  AppTabBar.tsx          Globe | Places + the add button
  globe/                 TravelGlobe, overlays, preview sheet, fallback
  places/                list, cards, search, filters
  place/                 detail, form, location search, photos, pin bar
  ui/                    BottomSheet, SegmentedControl, dialogs, imagery
lib/
  maps/                  mapbox setup, pin sprites, geocoding
  storage/               placeRepository, photoStore
  store/                 PlacesProvider, draft
  hooks/  utils/
types/place.ts           the VisitedPlace model
data/samplePlaces.ts     seed data, isolated so it can be deleted outright
scripts/generate-icons.mjs
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

A place with no photograph still gets a picture: satellite imagery of its exact
coordinates, generated from data the app already has. If that is unavailable
too, a calm gradient keyed off the place name. No card ever shows a broken
image.

## Deliberately not built yet

No accounts, no sharing, no trip planning, no analytics dashboards. The model in
`types/place.ts` is designed to grow — trips, companions, favourites, ratings —
without migrating anything that already exists.
