Building as a self-contained service module + a trimmed `prices.js` that delegates all index work to it.Now the trimmed `prices.js` that delegates all index work to the service.Two files delivered.

## 1. New —`backend/services/indexService.js`

&#x20;— self-contained index module.[1.js](https://us-prod.asyncgw.teams.microsoft.com/v1/objects/0-cus-d10-fbfee408d63b65f9022df3df778394e6/views/original/1.js)

* **`INDICES`** config (single source of truth): `NIFTY50→NIFTY 50`, `MIDCAP150→NIFTY MIDCAP 150`, `SMALLCAP250→NIFTY SMALLCAP 250`.
* **`fetchFromNifty`** — niftyindices `getHistoricaldatatabletoString`, cookie-primed, yearly-chunked, retried, deduped/sorted.
* **`fetchFromYahooIndex`** — fallback, ticker-gated (Nifty 50 `^NSEI` only).
* **Exports**: `fetchIndexHistory(symbol, from, to)` (by DB symbol) + `fetchIndexHistoryByName(...)` + `INDICES`.

## 2. Updated —`backend/routes/prices.js`

&#x20;— index section now **delegates** to the service:[2.js](https://us-prod.asyncgw.teams.microsoft.com/v1/objects/0-cus-d2-e98087351b2de7910ae0f3699d2e660b/views/original/2.js)

* Added `const { INDICES, fetchIndexHistory } = require("../services/indexService");`.
* Removed the old inline `INDICES` array + Yahoo index loop.
* `/update_indices` → single `fetchIndexHistory(symbol, from, to)` call per range; bulk insert unchanged.
* `/get_indices` default now derived from `INDICES` (no hardcoded list).
* **Stock chain (NSE→BSE→Yahoo) untouched.**

## Path check

Service is at `backend/services/indexService.js`; route imports `../services/indexService` from `backend/routes/`. Create the `services/` folder if it doesn't exist. No other imports move.

## Verify (isolated, before UI)

```js
const { fetchIndexHistory } = require("./services/indexService");
fetchIndexHistory("SMALLCAP250", "2026-07-01", "2026-07-28").then(r => console.log(r.slice(0,3), r.length));
```

Expect non-empty `{date, close}` rows. Then hit `POST /prices/update_indices` with `[{symbol:"NIFTY50",from,to},{symbol:"MIDCAP150",...},{symbol:"SMALLCAP250",...}]` and confirm logs:

```
[indices] NIFTY 50: N row(s) from niftyindices
[indices] NIFTY MIDCAP 150: N row(s) from niftyindices
[indices] NIFTY SMALLCAP 250: N row(s) from niftyindices
```

## Two response-shape assumptions to confirm on first live call

1. **`resp.data.d`** is a JSON-string array — parser also handles plain-array and `EOD_*` fallbacks, but verify Smallcap returns rows.
2. **Field names** `CLOSE` / `HistoricalDate` — if niftyindices uses a variant in your region, log one `recs[0]` and adjust the pick list in `niftyPost` (one line).

Backend indices are now self-contained. Frontend wiring (3-index config + chart lines for midcap150/smallcap250) is the next step whenever you want it — that's a separate change and I'll confirm the latest chart files before touching them.
