# Connecting the app to your Google Sheet

Your travel data lives in one Google Sheet. The app reads it on open and writes
back to it as you make changes, so any browser on any device shows the same
thing.

The connection is built into the published site, so it works on any device with
nothing to set up. That means the address and access code are **public** — see
[what this costs you](#what-this-costs-you) below, and the alternative if you'd
rather not.

---

## Your access code

```
2dHoDYeD-XLTSecCG-qcZVCM5d
```

Keep this somewhere you can find it. You will type it once per browser, and
once into the Apps Script project in step 4 below.

---

## Part 1 — Publish the script (do this once)

1. Open your sheet.
2. **Extensions → Apps Script**. A code editor opens in a new tab.
3. Delete whatever is in `Code.gs`, then paste the entire contents of
   [`apps-script/Code.gs`](../apps-script/Code.gs) from this repository.
4. Click the disk icon to save the script. **There is nothing to configure** —
   the access code is already in the file you just pasted.
5. *(Optional but worth it.)* In the function dropdown pick **selfTest** and
   click **Run**. The first run asks you to authorise it — see step 7. The
   execution log should list each tab with its column and row counts. If a tab
   name is wrong, this is where you find out.
6. **Deploy → New deployment**. Click the gear next to "Select type" and choose
   **Web app**.
   - Description: anything, e.g. `travel app`
   - **Execute as: Me**
   - **Who has access: Anyone**
   - **Deploy**
7. Google asks for authorisation. Click **Authorize access**, choose your
   account, then **Advanced → Go to (project name) (unsafe) → Allow**. The
   "unsafe" warning is Google's standard wording for a script that has not been
   through its review process; it is your own script, running only on your own
   sheet.
8. Copy the **Web app URL**. It ends in `/exec`. That is the "Sheet connection
   address".

### What those two settings mean

**Execute as: Me** — the script runs with your own Google permissions. That is
what lets your sheet stay private: you never share it, and the script reaches
it on your behalf.

**Who has access: Anyone** — anyone who knows the exact `/exec` address can
send a request to it. A browser cannot sign in to Google without shipping a
credential, so this is the only workable setting. The address is long and
random, but treat it as *unlisted, not secret*. The access code is what
actually keeps strangers out.

---

## Part 2 — Bake the connection into the site (do this once)

The app is built to work on any device with nothing to type. That takes one
edit:

1. Open [`lib/sheets/defaultConnection.ts`](../lib/sheets/defaultConnection.ts).
2. Put the `/exec` URL from step 8 between the quotes:

   ```ts
   export const DEFAULT_WEB_APP_URL = "https://script.google.com/macros/s/…/exec";
   ```

   The access code below it is already filled in.
3. Commit and push to `main`. GitHub Actions rebuilds and republishes; a minute
   later every device opens straight into the app.

`npm test` validates that URL — a `/dev` address, a missing `/exec`, or a
mangled paste fails the build rather than shipping a site that cannot reach
anything.

> ### What this costs you
>
> **Both values are public.** They are compiled into the JavaScript every
> visitor downloads, so anyone who opens the site — or this repository — can
> read them and send requests to the web app themselves. Making the repo
> private would not change that: the built bundle is served publicly either way.
>
> There is no way around this on a static site with no server. A browser cannot
> keep a secret. The choice is between typing the code once per device and
> accepting that the code is public.
>
> What still limits the damage: the script never deletes a row, every write is
> recorded in `Sync_Log`, the spreadsheet itself stays private (this is a door
> into it, not a share link), and rotating the code takes seconds.

### If you'd rather not bake it in

Leave `DEFAULT_WEB_APP_URL` as `""`. The app then shows a setup screen on first
open asking for both values, and keeps them in that browser alone. You type them
once per device and nothing secret is ever published.

### Changing it on one device

The sync chip on the Places screen opens settings, where a different address and
code override the built-in pair on that device only — useful for pointing a
phone at a copy of the sheet. **Reset connection** removes the override and
returns to the built-in one.

---

## ⚠️ The re-deploy trap

**Every time `Code.gs` changes, saving is not enough.** The previously deployed
version keeps serving until you publish a new one:

> **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**

Using **New deployment** instead creates a *second, different* address, and the
app carries on talking to the old one. If a change to the script seems to have
had no effect, this is almost always why.

---

## How it works

- **On open** — one request pulls every data tab at once. That becomes the
  app's in-memory copy, and a copy in localStorage as a cache.
- **On change** — the record is written back immediately. There is no Save
  button.
- **Offline** — the cached copy is shown, changes queue up, and the queue
  drains as soon as the connection returns. The chip on the Places screen says
  **Not saved yet** while anything is waiting.
- **The sheet always wins.** A successful load overwrites the cache wholesale.
  The only exception is a record with a write still queued, which keeps the
  local version until that write lands.

### What the app touches

| Tab | App behaviour |
|---|---|
| `Places` | Read and written. The main table. A place joins a trip through its existing `Trip ID / Collection` column; `Favorite` and `Status` back the favourites and want-to-go lists. |
| `Trips` | Read and written. One row per trip. **Created by the script on first run** if it isn't there. |
| `Dates_Visits` | Read only — multiple visits on one place fold into a single date range. |
| `Notes_Reviews`, `Media_Links`, `Lists_Tags`, `Trips_Itinerary` | Read into memory, never written. |
| `Lookups` | Read at startup for dropdown values. |
| `App_Settings`, `Sync_Log` | Created by the script on first run. |
| *(no tab)* | `searchPlaces` proxies Google Places when a `GOOGLE_MAPS_API_KEY` script property is set — see [Google Maps search](#optional-google-maps-search). |
| `Search_View`, `Dashboard`, `Guide` | **Never touched.** The script refuses to write to them by name. |

### Rules the script enforces

These live in the Apps Script rather than in the browser, so they hold even if
an old copy of the app is open in some other tab:

- **Rows are never deleted.** Deleting sets `Deleted?` to `Yes` and the row
  stays where it is. Removing rows would shift everything below and break the
  formulas on `Search_View` and `Dashboard`.
- **Columns are found by header text, never by position.** `Places` is 78
  columns wide; inserting one is safe.
- **Only the fields you changed are sent.** Every other cell in the row is read
  from the sheet and written straight back, so the ~60 columns the app has no
  screen for survive untouched. Fill in `Must Do` or `Visa / Entry Notes` by
  hand and the app will never overwrite them.
- **The script owns the derived columns** — `Created At` (first write only),
  `Updated At`, `Last Synced At`, `Sync Version` (incremented), `Coordinate
  Key`, `Map URL`, and `Search Text` (rebuilt on every change, lowercase and
  space-joined in the same field order as the existing rows).
- **IDs are stable and never reused.** The next one is the highest existing
  number plus one.
- **Existing spellings are matched** — `"Been"` and `"Want to go"` from the
  `Lookups` tab, `"Yes"`/`"No"` rather than true/false.
- **`Status` is only written when it changes.** The app knows two of the
  `Lookups` words, and every other one — `Lived there`, `Passed through`,
  `Booked` — also means *been*. Comparing before writing is what lets those
  survive: a place marked `Lived there` keeps saying so unless you actually
  move it to the want-to-go list and back.
- **One `setValues` per row**, never one call per cell.

---

## Trips

Trips group places into the journeys they belonged to. They need **one new tab**
and **no change at all** to `Places`.

### The `Trips` tab

The script creates it the first time it runs after this change, laid out like
every other tab here — a title on row 1, a description on row 2, headers on
row 3:

| Trip ID | Trip Name | Start Date | End Date | Description | Cover Place ID | Created At | Updated At | Last Synced At | Sync Version | Archived? | Deleted? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `TRIP-0001` | Japan 2026 | 2026-05-04 | 2026-05-16 | Spring trip to Japan | | 2026-08-21T07:00:00 | 2026-08-21T07:00:00 | … | 1 | No | No |

Ids follow the same rule as everywhere else: the highest existing number plus
one, assigned by the script, never reused, and stable if rows are reordered.

If you would rather make it by hand, add a tab named exactly `Trips`, put those
twelve headers in **row 3**, and leave rows 1 and 2 for a title and a note. The
script will then use it as it is.

### How a place joins a trip

Through the **`Trip ID / Collection`** column that `Places` already has. No new
column, no reordering, nothing renamed.

- A **blank** cell means the place belongs to no trip. That is what every
  existing row already says, and it stays completely valid.
- Removing a place from a trip **clears that one cell**. The row, and the place,
  are untouched.
- Deleting a trip clears the cell on each of its places first, then sets
  `Deleted?` to `Yes` on the trip row. **No place is ever deleted with a trip**,
  and the trip row itself stays where it is, like every other row here.

Renaming a trip changes one cell on one row. Nothing points at a trip by name —
only by id — so the places never need touching.

### What is *not* stored

A trip's length, how many places are in it, and which countries and cities it
covers are all counted from the rows at the moment they are shown. There is no
`Number Of Places` column to go stale when you add a place to a trip.

`Dates_Visits` has a `Trip ID` column of its own. This version does not read or
write it: the app's unit is a place with its dates, so that is where the trip
id lives. It is left exactly as it is, and is where a future per-visit model
would go.

> ### ⚠️ This needs a re-deploy
>
> The `Trips` tab appears the first time the **new** script runs. Until you
> publish a new version (Deploy → Manage deployments → pencil → Version: New
> version → Deploy), the old code keeps serving, the app sees no trips, and
> creating one fails with a message saying the tab is missing. See
> [the re-deploy trap](#️-the-re-deploy-trap) above.

---

## Optional: Google Maps search

Out of the box, searching for a place uses OpenStreetMap, which needs no
account and no key. It is good at cities, countries and famous landmarks, and
weaker at ordinary businesses — searching for a coffee shop gets you the right
name and a rough address rather than the polish you would get in Google Maps.

If you want Google's results instead, this takes about ten minutes and needs a
Google Cloud account. **It is entirely optional.** Without it the app works
exactly as it does now.

### Why the key goes in the script, not in the app

The website is a public static site: anything built into it is downloaded by
every visitor and readable from the page source. A Google Maps key put there
would be a key anyone could take and run up a bill with.

The script you already deployed runs on Google's servers under your account, so
the key lives there instead. The app asks the script to search; the script asks
Google; the key never leaves Google's side. Same reason your spreadsheet
credentials never reach the browser.

### 1 — Get a key

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. Create a project (any name).
3. **APIs & Services → Library**, search for **Places API (New)**, click
   **Enable**. Google will ask you to turn on billing — Places has a monthly
   free allowance that personal use stays well inside, but a card is required.
4. **APIs & Services → Credentials → Create credentials → API key**. Copy it.

### 2 — Lock the key down

Do this. It is what keeps a stray bill from being possible.

1. Click the key you just made → **Edit API key**.
2. Under **API restrictions**, choose **Restrict key** and tick **Places API
   (New)** only.
3. Leave **Application restrictions** set to **None**. The requests come from
   Google's own servers running your script, not from a browser, so an HTTP
   referrer restriction would block them.
4. Then set a spending cap: **APIs & Services → Places API (New) → Quotas**,
   and lower the daily request limit to something you would not mind paying
   for — a few hundred a day is far more than this app can use.

### 3 — Give it to the script

1. Open your sheet → **Extensions → Apps Script**.
2. **Project Settings** (the gear on the left) → scroll to **Script
   Properties** → **Add script property**.
3. Property: `GOOGLE_MAPS_API_KEY`. Value: the key you copied. **Save**.

No re-deploy is needed — script properties are read on every request. Reload
the app and search for something; results now say **Results from Google Maps**
underneath.

To turn it off again, delete the property. The app goes back to OpenStreetMap
on the next reload.

### What it costs

One search is one request, sent after you stop typing rather than on every
keystroke, and identical searches are cached on the script for half an hour.
Adding a few hundred places a year does not come close to the free allowance.

### If it does not work

The app never breaks over this — a key that is missing, restricted, unbilled or
simply having a bad minute falls back to OpenStreetMap, and searching keeps
working. To see *why*, open the Apps Script editor and run **selfTest**: the log
says whether it can see a key. Google's own refusal message (wrong API enabled,
billing off, key restricted) is passed straight through to the browser console.

---

## Answers to the things you asked

### If you think the access code has leaked

Because the code is in both the published site and the script, treat it as
public already — "leaked" here means you want to shut out whoever has it.

1. Apps Script editor → **Project Settings → Script Properties** → add
   `ACCESS_CODE` with a new value and save. A property set here **overrides**
   the one built into the file, takes effect immediately, and needs no
   re-deploy of the script. Every existing copy of the site stops working at
   this moment.
2. Put the same new value in `DEFAULT_ACCESS_CODE` in
   `lib/sheets/defaultConnection.ts`, commit, and push. The site republishes
   with the new code and starts working again.

If you want to be thorough, also **Deploy → Manage deployments → Archive** the
old deployment and create a new one. That changes the `/exec` address too, so
anyone holding the old one has nothing to send to — then update
`DEFAULT_WEB_APP_URL` as well.

Check `Sync_Log` to see whether anything was actually written while the old code
was out. Every write is there with a timestamp.

Worth knowing: the code only grants what the script does — read and write your
travel tabs. It is not your Google password and gives no access to your account,
your Drive, or any other file.

### If you edit the sheet by hand while the app is open

The app will not notice until it reloads. It holds the collection in memory
from the moment it started.

- **Your typing is safe.** Because a save only sends the fields you changed in
  the app, it cannot flatten a cell you edited by hand — even in the same row.
- **To see your edits**, tap the sync chip and then the refresh button, or just
  reload the page.
- **The one thing to avoid** is editing the *same field of the same place* in
  both places at once. The last write wins, and there is no warning.
- Adding rows by hand is fine. Give new rows an ID in the usual format
  (`PL-0042`); the app picks them up on the next load. A row with no name or no
  coordinates is skipped rather than treated as an error.

### How many places before it slows down

The startup read is the limit — it pulls every tab in one request.

| Places | What you'd notice |
|---|---|
| Up to ~500 | Instant. |
| ~1,000 | A second or two on open. Saving is unaffected. |
| ~2,500 | Startup gets slow enough to be annoying. |
| ~5,000+ | Apps Script's execution limits start to be a real risk. |

Saving does not degrade — one row is one write regardless of how many rows
exist. If you ever get near the top of that table, the fix is to load `Places`
alone at startup and fetch the other tabs on demand.

### If you move the site to a different address

**Nothing in the script or the sheet changes.** The web app is not tied to the
site's address — "Who has access: Anyone" means it accepts requests from
wherever they come from, so there is no allowed-origins list to update.

What you would do:

1. Update `NEXT_PUBLIC_BASE_PATH` in `.github/workflows/deploy.yml` if the new
   home is at a different sub-path (it is derived from the Pages config
   automatically, so usually this is nothing).
2. Nothing else. The connection is compiled into the site, so it travels with
   it — there is no per-browser state to re-enter.

If you had *overridden* the connection on a device through the settings screen,
that override is per-origin and would not follow. **Reset connection** on that
device puts it back on the built-in one.

---

## Checking it works

- Add a place in Chrome, open the site in Safari — it is there.
- Edit a place, then look at the row: only the fields you changed differ, plus
  `Updated At`, `Last Synced At`, `Sync Version`, and `Search Text`.
- Delete a place: `Deleted?` reads `Yes`, the row is still there, the app hides it.
- `Dashboard` counts still calculate; `Search_View` still filters.
- Nothing has been written to `Search_View`, `Dashboard` or `Guide`.
- Turn off wifi, make a change (the chip says **Not saved yet**), turn wifi back
  on — it saves by itself.
- Two visits attached to one place in `Dates_Visits` both survive a reload; the
  place shows the earliest start and the latest end.
- Open **Trips**, create one, reload the page — it is still there, and a `Trips`
  tab now exists in the spreadsheet.
- Put a place in a trip: only its `Trip ID / Collection` cell changes.
- Set that place back to **No Trip**: the cell empties, the place is still on the
  globe, the timeline and in Places.
- Delete a trip: its row reads `Deleted?` `Yes`, every place it held is still
  there with an empty trip cell.
