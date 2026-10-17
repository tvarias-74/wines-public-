# Cellar Book

A personal wine cellar catalog for the web and your phone. It answers the questions a collector actually asks:

- **What do I own?** Bottles per producer, per bottling and per vintage, with the grape varieties of each bottling.
- **What did I buy, when, and for how much?** Every purchase is kept with its date, price and merchant.
- **When should I drink it?** Each vintage has a drinking window, and the app shows what is ready, what is at its peak, what is closing soon, and what you have missed.

<p>
  <img src="docs/screenshots/dashboard.png" alt="Dashboard on a desktop browser" width="62%">
  <img src="docs/screenshots/dashboard-mobile.png" alt="Dashboard on a phone" width="24%">
</p>

<p>
  <img src="docs/screenshots/timeline.png" alt="Drinking-window timeline" width="62%">
  <img src="docs/screenshots/wine-mobile.png" alt="A wine's page on a phone" width="24%">
</p>

_The screenshots show the built-in sample wines (made-up producers, invented prices)._

## Using it

### Open it and install it

Cellar Book is a web app that installs like a native one, so there is nothing to download from an app store.

1. Open the site once it is published (see [Publishing](#publishing-the-site)).
2. **iPhone / iPad (Safari):** Share → **Add to Home Screen**.
   **Android (Chrome):** menu → **Install app**.
   **Desktop (Chrome or Edge):** the install icon in the address bar.
3. After the first visit it works **offline**, which is handy in a cellar with no signal.

### Add your wines

- **One by one:** tap **+**. Start with the producer and the bottling (the cuvée or label name). Anything you have typed before is filled in for you, including the grape varieties, so you enter them once per bottling, not once per vintage.
- **Same wine again?** Typing a producer, bottling and vintage you already have (any capitalisation, with or without accents) adds the bottles to it instead of creating a duplicate.
- **From a spreadsheet:** *Settings → Spreadsheet → Import a CSV*. You see a preview, including any rows that will be skipped and why, before anything is imported. See [CSV format](#csv-format).
- **Try it first:** the welcome screen offers sample wines, removable at any time without touching your own.

### Drinking windows

A drinking window is the range of years in which a vintage is good to drink, **both ends included** (`2024–2030` means from 1 January 2024 to 31 December 2030). Optionally add a **peak** inside it.

| Status | Meaning |
| --- | --- |
| **Not ready yet** | The window has not opened. |
| **Ready** | Inside the window. |
| **At peak** | Inside the window and inside the peak years you gave. |
| **Drink soon** | The window closes this year, or within the next *N* years (you choose *N* in Settings; the default is 1). This outranks "peak": a wine at its peak in its last year is the one to open. |
| **Past its window** | The window has closed. |
| **No window set** | Nothing entered yet. The dashboard counts these so they don't go unnoticed. |

**Estimates are not tasting advice.** When you add a wine you can start from a rule of thumb by aging potential (*Drink young* to *Very long-lived*). These only count forward from the vintage year, they are always marked **est.** in lists, and the mark disappears the moment you change a year yourself. Prefer your own notes or a critic's guidance where you have them.

### Taking bottles out

Tap **Drink** on any wine (or in the *Drink these first* list). You can record that you drank it, gave it away, sold it, or that it was spoiled, with a date and a note. Everything can be undone from the toast that appears, or later from the wine's page. Bottles in stock are always *bought minus taken out*, so the history and the count can never disagree, and you cannot take out more bottles than you have.

### Where the numbers come from

- **Cost of what's in stock** values the bottles you still have at the average price you paid for that wine. Bottles with no recorded price are left out and the card says how many.
- **Prices** are in one currency, chosen in Settings. Changing it relabels amounts; it does not convert them.
- **How your cellar matures** shows, for each of the next ten years, how many bottles would be in each status *if you opened none of them*.

## Your data

**Everything stays on the device you use.** There is no server and no account; the wines are stored in your browser (IndexedDB). This repository and the published site contain none of your data, so it is safe that the repository is public.

That has two consequences you should know about:

1. **It is not synced between your phone and your computer.** Each device has its own cellar. To move or copy it, use *Settings → Back up and restore*: download a backup on one device, restore it on the other. This is manual and replaces the cellar on the receiving device.
2. **Clearing browser data, or losing the device, loses the cellar** unless you have a backup. The app asks the browser to keep its data, and reminds you if you have not backed up in 30 days, but a backup file is the only real safety net. Keep it somewhere that is itself backed up.

### Backup file vs. CSV

| | Backup (`.json`) | CSV |
| --- | --- | --- |
| Purpose | Complete copy: wines, purchases, history, settings | Opening your wines in Excel/Sheets, or importing a list |
| Restoring | Replaces the whole cellar (after you confirm) | Adds to the cellar; nothing is removed |
| Includes purchase history and what you drank | Yes | No — one row per wine in stock |

### CSV format

The first row names the columns. Only **Producer** and **Bottling** (or *Wine*, *Cuvée*) are required; the rest are used when present:

`Producer, Bottling, Vintage, Type, Size, Country, Region, Appellation, Varieties, Bottles, Price, Purchase date, Merchant, Drink from, Drink to, Peak from, Peak to, Location, Notes`

- Each row adds that many bottles. Rows for the same producer, bottling and vintage are combined.
- `NV` for non-vintage. `Varieties` can read `Merlot 60%; Cabernet Franc 40%`. `Type` understands red/white/rosé/orange/sparkling/sweet/fortified, and common words such as *rouge*, *blanc*, *champagne* and *port*.
- Dates: `YYYY-MM-DD` or `DD/MM/YYYY` (**day first**), or just a year. Prices accept `12.50` and `12,50`.
- Commas, semicolons and tabs all work as separators; use semicolons when exporting for Excel set to a European language.
- A row the importer cannot use is skipped and listed with the reason; it never guesses silently. A missing *Type* is imported as "Other" and flagged.

## Publishing the site

The site is a static build, hosted for free on GitHub Pages. The included workflow (`.github/workflows/ci.yml`) runs every check on each push, and publishes from `main`.

One-time setup, in the GitHub repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. After the next push to `main` the site appears at `https://<your-user>.github.io/wines-public-/`.

The build uses relative URLs, so it also works from any other static host or sub-folder.

## For developers

Vite + React + TypeScript, no backend. Node 22 or newer.

```sh
npm install
npm run dev          # local dev server
npm run check        # typecheck + unit tests + production build
npm run e2e          # end-to-end tests (see below)
```

### End-to-end tests

`npx playwright install chromium` once, then `npm run build && npm run e2e`. They run the real production build in a browser and cover the flows that protect your data: adding and merging wines, drinking and undoing, backup and restore, CSV import, corrupt-storage handling, two tabs, offline use from a sub-path, and layout at 320–390 px wide. Set `PW_CHROMIUM_PATH` to use an existing Chromium instead of Playwright's.

### How it is organised

```
src/domain/    Pure logic with no UI: the data model, drinking-window rules, stock and
               spend maths, the add/edit/delete rules, CSV and backup handling. Unit-tested.
src/storage/   IndexedDB persistence (with a localStorage fallback) and the app-wide store.
src/ui/        React pages and components, including the charts, which are plain HTML and CSS.
e2e/           Playwright tests.
```

The cellar is one JSON document. A wine is described on three levels, matching how collectors speak:

```
Producer ─┬─ Bottling (the label / cuvée: type, origin, grape varieties)
          └─ Vintage  (a year in a bottle size: drinking window, location, notes)
                 ├─ Purchases     (date, quantity, price per bottle, merchant)
                 └─ Consumptions  (date, quantity, drank / gave away / sold / spoiled)
```

Stock is never stored, only derived (`purchases − consumptions`), and every action that changes data is a pure function in `src/domain/actions.ts` that either returns the new data or explains what is wrong.

Design decisions worth knowing:

- **Years, not dates, for windows.** Nobody knows a window to the month, and whole years keep the rules honest and explainable.
- **Dates may be partial** (`2019`, `2019-05`) because that is often all you remember about an old purchase.
- **Unreadable stored data is never overwritten.** If the stored cellar fails validation, the app stops saving, offers the raw data for download, and waits for you to decide.
- **Charts** use a status palette that was validated for colour-blind separation and contrast in both light and dark mode. Colour is never the only signal: every status has a text label, and each chart has a legend with counts and a "View as table".

## Limitations and ideas

Not built yet:

- **Syncing between devices.** The biggest gap. Options include a small hosted database with a login, or saving the backup file into a cloud folder automatically. Each has trade-offs around accounts and privacy, so it needs a decision before building.
- Label photos, barcode scanning, and tasting scores.
- Several currencies in one cellar.
- Importing wine details (varieties, critic windows) from an online database.
