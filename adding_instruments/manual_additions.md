All 12 files digested. Key facts confirmed:

* `instruments` DDL: `symbol TEXT PK, name TEXT, asset_type CHECK('EQ','MF')` — no `isin`/`scrip_code`.
* `database.js` uses `CREATE TABLE IF NOT EXISTS` → existing table needs `ALTER … ADD COLUMN IF NOT EXISTS` (create alone won't add columns).
* Route mounting: both `uploadRouter` and `instrumentsRouter` sit on `/instruments`; paths don't collide, so new `/instruments/sync/*` routes are safe.
* `tabs.jsx` is the state owner; `fetchInstruments()` already splits by `asset_type`. Adding columns won't break it. `tabNavigation.jsx`/`tabContent.jsx` are **dead legacy** (wrong import casing, not imported anywhere) — I will not touch them.
* Error pattern in app is `alert()` + console; `ToastContext.jsx` is a bare component, not a provider — I won't assume a toast context.

Building now\.Built. 3 new files + 2 surgical edits to your existing files (I did **not** regenerate `tabs.jsx`).

## New files (drop in as-is)

* **`backend/routes/instruments.js`** — replaces your 21-line file. Keeps `GET /` (now returns `isin` + `scrip_code`), adds `POST /sync/preview` (read-only diff) and `POST /sync/commit` (transactional upsert). [instruments.js](https://us-prod.asyncgw.teams.microsoft.com/v1/objects/0-cus-d7-2f0170eb7c5782b54d8e4c5796d52443/views/original/instruments.js)
* **`frontend/src/services/instrumentService.js`** — mirrors `stockService.js` pattern. [instrumentService.js](https://us-prod.asyncgw.teams.microsoft.com/v1/objects/0-cus-d13-121e1f0f599e839daa6ba1ae79aa87c1/views/original/instrumentService.js)
* **`frontend/src/components/instruments/InstrumentsTab.jsx`** — Fetch & Preview → selectable tables (New / Enrich) → Commit Selected. [InstrumentsTab.jsx](https://us-prod.asyncgw.teams.microsoft.com/v1/objects/0-cus-d4-542bf94524c1bb99b814357300493cc9/views/original/InstrumentsTab.jsx)

## Edit 1 — `database.js` (add 3 lines)

Right **after** the `CREATE TABLE IF NOT EXISTS instruments (...)` block, before the next `await client.query`:

```js
// instruments: minimal enrichment columns (EQ only; MF leaves these null)
await client.query(`ALTER TABLE instruments ADD COLUMN IF NOT EXISTS isin TEXT;`);
await client.query(`ALTER TABLE instruments ADD COLUMN IF NOT EXISTS scrip_code TEXT;`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_instruments_isin ON instruments(isin);`);
```

`CREATE TABLE IF NOT EXISTS` won't alter an existing table — these `ALTER`s are what actually add the columns on your live Neon DB.

## Edit 2 — `tabs.jsx` (3 tiny insertions)

**2a. Icon import** — add `FaDatabase`:

```js
import { FaPlus, FaChartLine, FaPiggyBank, FaChartPie, FaCoins, FaDatabase } from 'react-icons/fa';
```

**2b. Component import** — next to the other list imports (e.g. after `import OtherAssetList ...`):

```js
import InstrumentsTab from "./instruments/InstrumentsTab";
```

**2c. Nav item** — add one entry to the `navItems` array:

```js
{ id: "instruments", label: "Instruments", icon: <FaDatabase /> },
```

**2d. Render branch** — in the `AnimatePresence` block, insert immediately **before** the final `) : null}`:

```jsx
) : activeTab === "instruments" ? (
  <InstrumentsTab onCommitted={fetchInstruments} />
```

`fetchInstruments` already exists in `tabs.jsx` and re-splits into `stockInstruments`/`mutualFundInstruments`, so committing auto-refreshes the rest of the app. No server.js change — routes mount cleanly under the existing `/instruments`.

## Design decisions applied

* **EQ only.** NSE `SERIES==='EQ'` filter drops SME/BE/BZ. BSE `segment=Equity&status=Active` excludes SME by construction. MF untouched.
* **No delisted.** Active-only source feeds; commit only ever inserts/enriches — never deletes. Pre-existing DB rows are left alone regardless of match (protects your ledger FKs).
* **ISIN backfill now.** Two-pass: NSE fills `isin` by symbol → BSE fills `scrip_code` by ISIN. Bundled into the same preview/commit (`toEnrich` section), not a separate button.
* **Preview = addable + enrichable only.** `COALESCE` guards mean a sync never overwrites existing non-null values.
* **BSE non-fatal.** If BSE 403s, `scrip_code` stays null, add/backfill still proceed, and a warning shows — re-run later to fill codes.

## Test sequence

1. Restart backend → confirm `instruments` gained `isin`, `scrip_code`.
2. `POST /instruments/sync/preview` → inspect stats (`nseEqCount ~2000+`, `bseIsinCount > 0`).
3. Open Instruments tab → Fetch & Preview → Commit a small selection → verify rows in DB.

## Risks / assumptions

* **Symbol case:** matching uppercases both sides. If any existing DB symbols aren't uppercase, their enrich `UPDATE ... WHERE symbol=$1` won't match. NSE symbols are canonically uppercase, so verify your current rows are too.
* **BSE endpoint fragility:** unofficial `api.bseindia.com`; may need a Neon/Render egress that isn't WAF-blocked. Falls back gracefully.
* **`csv-parser`** is already a backend dep (used in `uploadCSV.js`) — no new install. `axios`, `stream` also already present.

Want me to add a lightweight `GET /instruments/sync/status` (last-sync timestamp) next, or wire BSE scrip-code into the actual price-fetch order (point #1 from our plan)?
