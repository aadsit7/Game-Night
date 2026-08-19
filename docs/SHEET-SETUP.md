# Connecting the app to your Google Sheet

Your travel data lives in one Google Sheet. The app reads it on open and writes
back to it as you make changes, so any browser on any device shows the same
thing.

Nothing secret is in this repository. The site is published from a public repo,
so anything committed here is readable by anyone — which is why the sheet
address and access code are typed into each browser once and kept there.

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
4. In the left sidebar click the gear, **Project Settings**. Scroll to
   **Script Properties → Add script property**:
   - Property: `ACCESS_CODE`
   - Value: `2dHoDYeD-XLTSecCG-qcZVCM5d`

   Click **Save script properties**. The code lives here rather than in the
   file so it is not sitting in the code, and so you can change it without
   editing anything.
5. Click the disk icon to save the script.
6. *(Optional but worth it.)* In the function dropdown pick **selfTest** and
   click **Run**. The first run asks you to authorise it — see step 8. The
   execution log should list each tab with its column and row counts. If a tab
   name is wrong, this is where you find out.
7. **Deploy → New deployment**. Click the gear next to "Select type" and choose
   **Web app**.
   - Description: anything, e.g. `travel app`
   - **Execute as: Me**
   - **Who has access: Anyone**
   - **Deploy**
8. Google asks for authorisation. Click **Authorize access**, choose your
   account, then **Advanced → Go to (project name) (unsafe) → Allow**. The
   "unsafe" warning is Google's standard wording for a script that has not been
   through its review process; it is your own script, running only on your own
   sheet.
9. Copy the **Web app URL**. It ends in `/exec`. That is the "Sheet connection
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

## Part 2 — Connect a browser (do this on each device)

1. Open the site.
2. The setup screen asks for two things:
   - **Sheet connection address** — the `/exec` URL from step 9.
   - **Access code** — the code above.
3. Press **Connect**. The app checks both before saving them, so a typo is
   caught here rather than becoming a screen of data that silently never saves.

To change or clear them later: the sync chip on the Places screen → **Reset
connection**.

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
| `Places` | Read and written. The main table. |
| `Dates_Visits` | Read only — multiple visits on one place fold into a single date range. |
| `Notes_Reviews`, `Media_Links`, `Lists_Tags`, `Trips_Itinerary` | Read into memory, never written. |
| `Lookups` | Read at startup for dropdown values. |
| `App_Settings`, `Sync_Log` | Created by the script on first run. |
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
- **One `setValues` per row**, never one call per cell.

---

## Answers to the things you asked

### If you think the access code has leaked

1. Apps Script editor → **Project Settings → Script Properties**.
2. Edit `ACCESS_CODE` to a new value and save.

That is all — no re-deploy needed, because Script Properties are read at
request time rather than baked into the deployment. Every browser then shows
the setup screen again and needs the new code.

If you want to be thorough, also **Deploy → Manage deployments → Archive** the
old deployment and create a new one. That changes the `/exec` address too, so
anyone holding the old address has nothing to send to.

Worth knowing: the code only grants what the script does — read and write your
travel tabs. It is not your Google password and gives no access to your account
or to Drive.

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
2. Re-enter the address and access code once in each browser, because
   localStorage is per-origin and a new address is a new origin.

That second point is the only real cost, and it is the same two fields as
first-time setup.

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
