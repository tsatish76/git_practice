You're right — I misattributed it. The data came from **NSE** (primary source), so the Yahoo mapper was never in play. The mechanism I described (UTC `toISOString` shift) is correct, but it fires in `fetchFromNSE`, not Yahoo, and for a different reason.

**Issue**
Friday **24-Jul** candle was fetched from NSE and stored under key **`2026-07-23`**. One candle, shifted back one day. (25th Sat correctly absent.)

**Root Cause**
In `fetchFromNSE`: [\[aam-my.sha...epoint.com\]](https://aam-my.sharepoint.com/personal/satish_thorat_aam_com/Documents/Microsoft%20Copilot%20Chat%20Files/prices.js)

```js
const dateRaw = r.mtimestamp;          // NSE mTIMESTAMP → "24-Jul-2026" (DD-MMM-YYYY)
const parsed  = new Date(dateRaw);
date: parsed.toISOString().split("T")[0],
```

Two facts combine:

1. `"24-Jul-2026"` is a **non-ISO** string. V8 parses non-ISO date strings in **server-local time**, not UTC. Your server/runtime is **IST** (GMT+5:30, per current session), so `parsed = 2026-07-24 00:00 IST = 2026-07-23 18:30 UTC`.
2. `.toISOString()` renders that instant in **UTC** → `"2026-07-23T18:30:00Z"` → `.split("T")[0]` = **`2026-07-23`**.

So every NSE row keyed via `mtimestamp` shifts back one calendar day whenever the runtime TZ is east of UTC. (Note: the ISO field `CH_TIMESTAMP`/`chTimestamp` = `"2026-07-24"` would *not* shift, because ISO date-only strings parse as UTC — but the code uses `mtimestamp`, which does.)

This is why 24 → stored as 23, and 24 appears "missing."

**Fix**
Never round-trip an exchange trading day through UTC `toISOString`. Derive the key in the exchange timezone. This is robust whether the runtime is IST or UTC.

**Code**

Add helper (top of `prices.js`):

```js
// Exchange-local (IST) date key. TZ-safe regardless of server timezone.
const toISTDateKey = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(dt); // → "YYYY-MM-DD"
};
```

`fetchFromNSE` — replace the key line:

```js
const parsed = new Date(dateRaw);
if (isNaN(parsed.getTime())) return;
rows.push({
  date: toISTDateKey(parsed),                          // was: parsed.toISOString().split("T")[0]
  close: Math.round(Number(closeRaw) * 1000) / 1000,
});
```

Apply the same to `fetchFromYahoo` and `/update_indices` for consistency (same `.toISOString().split("T")[0]` pattern; harmless where the source is already UTC-midnight, but eliminates the class of bug):

```js
// fetchFromYahoo
date: toISTDateKey(row.date),
// update_indices
date: toISTDateKey(d.date),
```

**Cleanup — already-misdated rows**
`ON CONFLICT DO NOTHING` means a corrected re-fetch won't overwrite the wrong key. Purge the shifted NSE rows you ingested with the buggy code, then re-fetch:

```sql
-- inspect first
SELECT symbol, date, close FROM stock_price_history WHERE date = '2026-07-23';
-- delete only the range you ingested buggy, then re-run /update_stocks
DELETE FROM stock_price_history WHERE date = '2026-07-23' AND symbol = ANY($1);
```

**Verify (deterministic)**
Re-fetch `from=2026-07-24 to=2026-07-24` for one symbol. Post-fix it stores `2026-07-24`; pre-fix it stored `2026-07-23`. If you want to confirm the source before purging, the log line `fetched … from nse|yahoo-ns|yahoo-bo` tells you which path served it — it will read `nse`.
