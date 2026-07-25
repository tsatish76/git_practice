**Issue**
`computeMissingPriceRanges` in `HelperFunctions.jsx` builds its fetch list from **every symbol that has ever traded**, including fully-exited positions.

**Root Cause**

```js
stocks.forEach(trade => {
  const symbol = trade.symbol;
  ...
  tradeMap[symbol] = date;   // no holdings filter — includes sold-out symbols
});
```

It never consults allocations/remaining qty, so any symbol with a BUY in the ledger keeps getting its price history fetched and stored, even after `remainingQty` hits 0. On Neon free tier this grows `stock_price_history` with rows the app never displays.

**Fix**
Filter the fetch list to symbols with remaining BUY qty > 0 using the existing `getHoldingOrders`. Two-part: (1) stop fetching exited symbols going forward, (2) optional one-time prune to reclaim rows already stored.

**Code**

**1 — `HelperFunctions.jsx`: gate `computeMissingPriceRanges` to held symbols**

```js
export const computeMissingPriceRanges = (stocks, priceHistory, stockTradeAllocations = []) => {
  const lastMarketDay = getLastMarketDay();

  // Only symbols still held (remaining BUY qty > 0). Fully-exited positions are
  // skipped so price_history doesn't grow for stocks the app no longer shows.
  const heldSymbols = new Set(
    getHoldingOrders(stocks, stockTradeAllocations).map(h => h.symbol)
  );

  // 1️⃣ Earliest trade per HELD symbol
  const tradeMap = {};
  stocks.forEach(trade => {
    if (!heldSymbols.has(trade.symbol)) return;   // ⬅ skip exited positions
    const symbol = trade.symbol;
    const date = trade.date;
    if (!tradeMap[symbol] || date < tradeMap[symbol]) {
      tradeMap[symbol] = date;
    }
  });

  // 2️⃣ … rest of the function unchanged …
```

**2 — `stocklist.jsx`: pass allocations to the call**

```js
const missingStockRanges = helpers.computeMissingPriceRanges(
  stocks, priceHistory, stockTradeAllocations
);
```

**3 — (optional) `prices.js`: prune already-stored exited rows to reclaim space**

```js
// Deletes price history for any symbol NOT in the current holdings list.
// Body: { keepSymbols: ["INFY", "TCS", ...] }
router.post("/prune_stocks", async (req, res) => {
  const { keepSymbols } = req.body;
  if (!Array.isArray(keepSymbols) || keepSymbols.length === 0) {
    return res.status(400).json({ error: "keepSymbols must be a non-empty array." });
  }
  try {
    const result = await pool.query(
      `DELETE FROM stock_price_history WHERE symbol <> ALL($1) RETURNING symbol`,
      [keepSymbols]
    );
    res.json({ status: "pruned", deletedRows: result.rowCount });
  } catch (err) {
    console.error("[prices] prune_stocks failed:", err);
    res.status(500).json({ error: "prune failed" });
  }
});
```

**4 — (optional) trigger prune from `stocklist.jsx` inside `updatePriceHistory`, after fetch**

```js
const heldSymbols = helpers.getHoldingOrders(stocks, stockTradeAllocations).map(h => h.symbol);
if (heldSymbols.length > 0) {
  await fetch(`${BASE_URL}/prices/prune_stocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keepSymbols: heldSymbols }),
  });
}
```

**Trade-off — must decide before enabling prune (#3/#4)**
This directly conflicts with your "historical state must be reproducible" principle. `buildStockPortfolioSeries` reconstructs daily NAV from `stock_price_history`. If you **delete** price rows for a stock you once held, the portfolio performance/NAV series for the period you *did* hold it can no longer be rebuilt — those days lose that position's valuation.

Recommendation:

* **Change #1 + #2 alone** (stop fetching exited symbols) is safe *only if* you never need historical NAV before an exit. It still leaves a gap: a symbol bought and sold entirely between two refreshes may never get its held-period prices.
* If you want both storage savings **and** correct history: keep prices only for `date >= earliest unsold lot`, i.e. prune rows **older than the position's own trade window**, not whole symbols. Safer variant:

```sql
DELETE FROM stock_price_history
WHERE symbol = $1 AND date < $2;   -- $2 = earliest still-held BUY date for that symbol
```

* **Do not run #3/#4** if the performance chart's "ALL" range over past (now-exited) positions matters to you.

Confirm which guarantee you're trading away and I'll lock the prune to match (whole-symbol vs. date-window).
