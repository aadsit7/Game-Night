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
   Give the manifest the same treatment: **Project Settings (⚙️) → tick
   "Show `appsscript.json` manifest file in editor"**, then back in the
   editor open `appsscript.json` and paste
   [`apps-script/appsscript.json`](../apps-script/appsscript.json) over it.
   The manifest's scope list is half of what lets [Google
   Photos](#google-photos) import work; the other half is one switch in a
   Cloud project, described in that section.
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
| `Places` | Read and written. The main table. A place joins a trip through its existing `Trip ID / Collection` column; `Favorite` and `Status` back the favourites and want-to-go lists. `Google Place ID` holds the listing id captured when a place was added from a Google search result — it is what makes the app's **Google Maps** buttons and the derived `Map URL` open the actual listing rather than a bare pin. The script appends this column if a sheet from an early copy of the template is missing it. |
| `Trips` | Read and written. One row per trip. **Created by the script on first run** if it isn't there. |
| `Dates_Visits` | Read and written. One row per stay — the place card lists them, and the Places row's `First/Last Visited Date`, `Visit Count` and `Days Spent Total` are kept in step. The script appends its bookkeeping columns (`Created At` … `Deleted?`) on first run of this version. |
| `Media_Links` | Read and written, for photos only. Each uploaded photo becomes a `Photo` row pointing at its place, which is how a photo added on one device appears on the others. Other row types are left alone. |
| `Travel_Photos` | Read and written. One row per photo/video imported from Google Photos — the metadata; the image files live in a private Drive folder. **Created by the script on first run** if it isn't there. See [Google Photos](#google-photos). |
| `Notes_Reviews`, `Lists_Tags`, `Trips_Itinerary` | Read into memory, never written. |
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

> ### ⚠️ This needs a re-deploy
>
> The `Trips` tab appears the first time the **new** script runs. Until you
> publish a new version (Deploy → Manage deployments → pencil → Version: New
> version → Deploy), the old code keeps serving, the app sees no trips, and
> creating one fails with a message saying the tab is missing. See
> [the re-deploy trap](#️-the-re-deploy-trap) above.

---

## Visits

A place is somewhere; a visit is a time you were there. Each stay is one row
on `Dates_Visits` — the tab's own description has said so all along ("Repeat
rows support multiple trips to the same place") — and the place card lists
them: dates, length, trip type, and the trip it belonged to through the tab's
own `Trip ID` column.

- **Adding a place you have already been to logs a visit instead.** Same name
  in the same country, or a pin within about 150 m, is recognised as the same
  place: no duplicate row appears on `Places`, and the dates you typed become
  a new `Dates_Visits` row.
- **A place recorded the old way** — dates on the Places row, no visit rows —
  still shows those dates as its one visit. The first time you log another,
  the original is written into `Dates_Visits` too, so the history the card
  showed is the history the sheet holds.
- **The summary stays on `Places`.** `First Visited Date`, `Last Visited Date`,
  `Visit Count` and `Days Spent Total` are recomputed from the visit rows on
  every change, so the timeline, the sort orders and the sheet's own columns
  all keep telling the same story. `Days`, `Year`, `Month` and `Season` on
  each visit row are filled in from its dates the same way.
- The app writes the sheet's own vocabulary: `Visit Status` gets `Been` or
  `Planned`, and `Trip Type` comes from the Lookups tab's list.

The script's generic row machinery already covers all of this, but the tab
needs its bookkeeping columns (`Created At`, `Updated At`, `Last Synced At`,
`Sync Version`, `Archived?`, `Deleted?`); the new script appends any that are
missing the first time it runs.

## Photos in Google Drive

Photos used to stay in the browser they were added in. With this version of
the script they follow your account instead:

- The app still stores a photo locally first, so nothing waits on the network.
- When the deployment supports it, each local photo is uploaded once through
  the script, which files it in a Drive folder called **Travel Globe Photos**
  under the sheet owner's account and hands back a link.
- The link replaces the local copy: the cover goes into `Photo URL` on the
  place's row, and every photo gets a `Photo` row on `Media_Links` — which is
  what the app on another device reads to show it.
- Uploaded files are shared **anyone with the link, view only**, because the
  link lives in a spreadsheet cell that every connected device must be able
  to render. Removing a photo in the app tombstones its `Media_Links` row;
  the file itself stays in Drive, yours to delete.

If the upload fails — offline, an older deployment — nothing breaks: the photo
stays local exactly as before, and the app retries on the next load.

> ### ⚠️ This needs a re-deploy, and a fresh authorization
>
> `uploadPhoto` exists only in the new script, and it is the script's first
> use of Drive. Publishing the new version (Deploy → Manage deployments →
> pencil → Version: New version → Deploy) will ask you to authorize the
> script again, this time including Drive access. Until then the app simply
> keeps photos local — the capability is advertised by the script, never
> assumed.

---

## Google Photos

Photos and videos can be imported straight from Google Photos into a specific
**visit**, **trip**, or **residence period**. What actually happens:

1. You pick items in Google's own picker (the app never scans your library).
2. The Apps Script downloads gallery-sized copies — a ~512px thumbnail and a
   ~2048px display image, plus the clip itself for a video when it fits — into
   a **private** Drive folder called `Travel App Photos`.
3. A row lands on the `Travel_Photos` tab with the visit/trip it belongs to.
4. From then on every device shows the photo **from Drive via the script** —
   Google Photos is never contacted again just to view.

Two authorisations are involved, and keeping them straight is the whole model:

- **Importing** — permission to read what you pick in Google Photos. The
  script's **own authorisation** covers this: the approval you give when
  deploying the web app now includes the Photos Picker scope, so there is
  no OAuth client, nothing to store in Script Properties, and no "connect"
  step on any device. Deploying the script *is* the connection, and it
  cannot lapse the way a stored refresh token can. Google asks one thing
  in return: every API call is accounted to a Cloud project, and the
  **Photos Picker API must be enabled** in the one this script runs in —
  a one-time switch covered in the setup below.
- **The media access code** — a *viewing* key. Because the photo files stay
  private in Drive, and the sheet's shared access code is public by design
  (it ships in the static bundle), the photo bytes sit behind this second
  code. Out of the box it is simply `2026` on both sides, so photos view
  with nothing to type on any device. For real secrecy, set your own long
  random `MEDIA_ACCESS_CODE` Script Property — the app then asks each
  device for it once.

### Setup — manifest and Cloud project, once

Two things, then a single re-authorisation that covers both. The manifest
tells Google which scopes the script's authorisation carries; the Cloud
project is where Google's **Photos Picker API** switch lives, because every
Google API call is accounted to some project — even a free one. Do them in
this order and you authorise exactly once.

**The manifest:**

1. Apps Script editor → **Project Settings (⚙️)** → tick **Show
   "appsscript.json" manifest file in editor**.
2. Open `appsscript.json` in the editor and make its `oauthScopes` match
   the copy in this repo at
   [`apps-script/appsscript.json`](../apps-script/appsscript.json) —
   replacing the whole file is fine (if yours has a different `timeZone`,
   keep it; data timestamps follow the *spreadsheet's* timezone either
   way). The scopes, for the record:

   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/spreadsheets",
     "https://www.googleapis.com/auth/drive",
     "https://www.googleapis.com/auth/script.external_request",
     "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"
   ]
   ```

   Listing scopes explicitly switches off Apps Script's automatic scope
   detection, which is why the first three — everything the script already
   uses — are spelled out alongside the new Picker scope. Leaving one out
   breaks that feature on the next authorisation, so copy the list whole.

**The Cloud project:**

3. Scripts start out on a hidden, Google-managed Cloud project — one with
   no console page of its own, so the Picker API can never be switched on
   there. Attach a standard project of your own instead:
   1. At [console.cloud.google.com](https://console.cloud.google.com/),
      create a project — or reuse one you already have, such as the one
      from [Maps search](#optional-google-maps-search). Everything here is
      free; the Picker API itself costs nothing.
   2. **APIs & Services → Library** → search **Photos Picker API** →
      **Enable**.
   3. **APIs & Services → OAuth consent screen** → configure it: User type
      **External**, an app name, your email — nothing more. Apps Script
      refuses to attach a project whose consent screen is bare. Then set
      the publishing status to **In production** (OAuth consent screen →
      Publish app): while it sits in **Testing**, Google expires the
      script's authorisation **every 7 days**, which would mean
      re-authorising weekly. The ⚠️ note in the OAuth section below is
      about this same screen; as there, follow whatever Google's screens
      actually demand of your configuration.
   4. Copy the project **number** (on the console's dashboard card), then
      in the Apps Script editor: **Project Settings (⚙️) → Google Cloud
      Platform (GCP) Project → Change project** → paste the number.
      Switching resets the script's existing authorisation — the next step
      grants it back.

**One authorisation:**

4. Paste the current `Code.gs` if you haven't already, then publish a new
   version — **Deploy → Manage deployments → pencil → Version: New version
   → Deploy** (the [re-deploy trap](#️-the-re-deploy-trap) applies here
   with real force: none of this exists until the new version is serving).
   Google asks you to authorise — the same consent ceremony as the very
   first deployment, "unverified app" interstitial included (**Advanced →
   Go to … (unsafe)**; it is your own script, reading only what you pick).
5. That's it. Tap **Add photos** on any visit, on any device — the picker
   opens with no connect step. Viewing needs nothing to type either — the
   standard code (`2026`) is built into both sides. Only if you set your
   own `MEDIA_ACCESS_CODE`: on each device, **Google Photos → Media access
   code**, paste it once.

If the app still says an authorisation is needed, the deployment is serving
an old version (the re-deploy trap again) or the consent screen was
dismissed halfway. Fix that, then **sync chip → Sync settings → Google
Photos → Re-check** asks the script again.

If **Add photos** instead answers *"Google Photos refused the request (403)
… the Photos Picker API is switched off in the Cloud project"* — or, from
an older copy of the script, Google's own wording, *"Photos Picker API has
not been used in project … before or it is disabled"* — that is step 3:
the API isn't enabled in the project the script is attached to. The error
links the exact enable-it page for that project; if that page says you
don't have permission to view it, the script is still on its hidden
default project — do the switch in step 3, then **Re-check**.

### Whose library the picker opens

The script runs as the sheet owner, so the picker opens **the sheet
owner's Google Photos library** — be signed into that account in the
browser when the picker window opens. For a one-account setup that is the
end of the story. For a two-account setup — your photos live in a
different Google account than the one that owns the sheet (the "App
account") — Partner Sharing brings the whole original library into the App
account:

1. In Google Photos, sign into the **original** account → Settings → Partner
   sharing → share with the App account (All photos).
2. Sign into the **App account** → Settings → Partner sharing → under your
   partner's name choose **Save to your account → All photos**.
3. Open the App account's Photos library and confirm old photos from the
   original account actually appear in it (saving can take a while to backfill).
4. After the manifest step above, tap Add photos on any visit and confirm
   you can select one of those partner-shared photos in the picker.

If the partner-saved photos show up in the picker, you are done —
everything (Sheet, Drive, Apps Script, Photos) lives behind one account. If
they don't, the optional OAuth-client mode below can point the picker at
the original account's library directly.

### Optional — a different account, via an OAuth client

Everything in this subsection exists for exactly one case: the picker must
open a Google account's library **other than the sheet owner's**, and
Partner Sharing above didn't cover it. Skip it otherwise — the default
mode stores no credentials at all, and when both are set up, a connected
OAuth client takes precedence.

#### Step 1 — Google Cloud project and the Picker API

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   create a project (or reuse the one from Maps search).
2. **APIs & Services → Library** → search **Photos Picker API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** is fine for a personal account.
   - Fill in the app name and your email; nothing else is required.
   - Add yourself (and the photos account, if different) as a **test user**.
4. Scopes: the app uses exactly one —
   `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
   You can add it on the consent screen, and the script requests only this.

> ### ⚠️ Publishing status and token lifetime
>
> While the consent screen is in **Testing**, Google expires refresh tokens
> after **7 days** — you would be reconnecting weekly. For the intended
> "connect once" behaviour, set the consent screen's publishing status to
> **In production** (OAuth consent screen → Publish app). For a personal app
> with only this sensitive-but-not-restricted Picker scope, Google currently
> allows production use without completing verification — users just see an
> "unverified app" interstitial (Advanced → Continue), and user counts are
> limited. That is your own account, so it is fine. Follow whatever Google's
> consent screen actually presents; if it demands verification steps for your
> configuration, they are not optional.

#### Step 2 — OAuth client and redirect URI

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: anything.
3. Under **Authorized redirect URIs**, add your Apps Script web app's own
   `/exec` URL — exactly the address the app already talks to. The app shows
   the precise value to copy under **Sync settings → Google Photos** ("OAuth
   redirect URI"), and `photosAuthStatus` returns it as `redirectUri`; use
   that rather than retyping it.
4. Create, then copy the **Client ID** and **Client secret**.

#### Step 3 — Script Properties

Apps Script editor → **Project Settings → Script Properties**. Add:

| Property | Value |
|---|---|
| `PHOTOS_OAUTH_CLIENT_ID` | The OAuth client ID from step 2. |
| `PHOTOS_OAUTH_CLIENT_SECRET` | The client secret from step 2. |
| `PHOTOS_ACCOUNT_HINT` *(optional)* | The email of the Google account to preselect on the consent screen — the account whose library the picker should open. |

**Never commit any of these values to the repository.** The client secret,
the refresh token and the media code live in Script Properties and nowhere
else; none of them are ever written to the sheet, to Drive, or into the
static site bundle.

#### Step 4 — Connect once

In the app: **sync chip → Sync settings → Google Photos → Connect**. A
Google window opens; sign in with the account whose library the picker
should show, and allow. The page says "Google Photos connected" and closes
itself. Imports still land in the App account's Drive, because the script
always runs as the sheet owner.

Reconnecting is only ever needed if you revoke access, Google invalidates the
refresh token, or you switch the connected account — the status row in
settings says so when it happens.

### Other Script Properties

`MEDIA_ACCESS_CODE` *(optional, both modes)* — the per-device viewing code.
Leave it unset and the code is simply `2026` — photos view with nothing to
type. For real secrecy, set a long random string (20+ characters; a
password manager's generator is perfect) and each device is asked for it
once.

`TRAVEL_PHOTOS_FOLDER_ID` is filled in automatically the first time an import
runs (the script creates the private `Travel App Photos` folder and remembers
it). You never need to set it by hand.

### Adding photos

- **A visit**: open the place → the visit's row → **Add** (photo tile). The
  sheet shows the visit's dates before the picker opens.
- **A trip**: open the trip → **Photos → Add from Google Photos**. The trip's
  dates are the context; after selection, each photo whose date falls inside
  exactly one member visit is filed under that visit automatically, and the
  rest stay at trip level.
- **A residence**: exactly like a visit — a residence is a `Dates_Visits` row
  whose Visit Status is `Lived there`.

After you pick and tap Done in Google Photos, the app shows the review
screen: how many photos fall inside the dates, which are outside (flagged
`Outside trip dates`, still selected — airport days and wrong camera clocks
are real life), which are already imported, and which are videos. Confirm,
and the import runs in small batches with progress; if some fail, the ones
that landed stay landed and a **Retry** button re-sends only the failures.

### What is stored where

| Thing | Where | Notes |
|---|---|---|
| Photo/video metadata + associations | `Travel_Photos` tab | Source of truth; soft-deleted like every other row. |
| Image bytes (thumb ~512px, display ~2048px, video clip when it fits) | Private Drive folder `Travel App Photos` | **Not** link-shared. Only the script can read them, and it serves them only through `getTravelPhoto`, only with the media code, and only for files its own rows point at. |
| Google Photos item id | `Travel_Photos` tab | The durable identity, used to skip duplicates and reuse existing Drive files instead of storing copies. |
| Google Photos `baseUrl` | **Nowhere** | Temporary by design; used server-side during import and discarded. |
| Media code; OAuth client secret + tokens (optional different-account mode only) | Script Properties | The default mode stores no credentials anywhere — the script's own authorisation is the permission. Never in the sheet, Drive, or the repository. |
| Viewed photo bytes | Each device's IndexedDB cache | So galleries are instant after the first look, and viewable offline. |

Deleting a photo in the app tombstones its row first, then moves the Drive
files to trash if no other photo still references them — recoverable from
Drive's trash for 30 days.

### Cross-device check

Import a few photos on one device, wait for the sync chip to settle, then
open the app on another device: the same visit shows the same gallery after
entering the media code once. Viewing on the second device must never ask
for Google Photos authorisation — if it seems to, you are looking at the
*import* flow, not the gallery.

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

Places added from these results also remember their Google listing — the id
goes into the sheet's `Google Place ID` column. From then on, the **Google
Maps** and **Directions** buttons on that place's card (and the sheet's own
derived `Map URL` cell) open the real listing, with its hours, photos and
reviews, rather than a pin at the coordinates. The buttons themselves work on
every place either way — they are ordinary Google Maps links and need no key —
a place without a listing id just opens as a pin on the exact spot.

To turn it off again, delete the property. The app goes back to OpenStreetMap
on the next reload; saved listing ids stay in the sheet and keep working.

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
  place card lists both, and the Places row shows the earliest start and the
  latest end.
- Open a place's card and **Add visit**: a new `Dates_Visits` row appears with
  `Days`, `Year`, `Month` and `Season` filled in, and the place's `Visit Count`
  and `Days Spent Total` update.
- Add a place you already have (same name, same country): no new `Places` row —
  the existing place gains a visit and its card opens to show it.
- Attach a photo, wait a moment, and look at **Travel Globe Photos** in Drive:
  the file is there, `Photo URL` holds a link rather than nothing, and a
  `Photo` row exists on `Media_Links`. Open the site on another device — the
  photo is there too.
- Open a place with two visits and add different Google Photos to each: each
  visit keeps its own gallery, and **All photos** shows both in date order.
- Add photos from a trip: the trip's dates show before the picker opens, and
  photos dated outside them come back flagged `Outside trip dates` — still
  importable.
- Import on one device, open another device, enter the media access code once:
  the same gallery appears, with no Google Photos sign-in anywhere.
- Look at `Travel_Photos` in the sheet: rows carry Visit ID/Trip ID and Drive
  file ids — and no Google URL of any kind.
- Open **Trips**, create one, reload the page — it is still there, and a `Trips`
  tab now exists in the spreadsheet.
- Put a place in a trip: only its `Trip ID / Collection` cell changes.
- Set that place back to **No Trip**: the cell empties, the place is still on the
  globe, the timeline and in Places.
- Delete a trip: its row reads `Deleted?` `Yes`, every place it held is still
  there with an empty trip cell.
