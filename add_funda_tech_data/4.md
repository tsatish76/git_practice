# Indicator wiring patch — `stocklist.jsx` + `tabs.jsx`

Apply the edits in order. All are surgical (find → replace); nothing else changes.
`StockIndicatorsTable.jsx` must already be placed in `src/components/stocks/`.

---

## A. `src/components/stocklist.jsx`

### A1. Import the new component
Add alongside the other `./stocks/*` imports (after `StockComparisonChart`):

```jsx
import StockComparisonChart from "./stocks/StockComparisonChart";
import StockIndicatorsTable from "./stocks/StockIndicatorsTable";   // NEW
```

### A2. Accept the new prop
In the component signature, add `onRefreshIndicators` next to `onThesisSaved`:

```jsx
// BEFORE
  stockThesisData = [], holdingOrders, stockInstruments,
  onOrdersEdit, onThesisSaved,

// AFTER
  stockThesisData = [], holdingOrders, stockInstruments,
  onOrdersEdit, onThesisSaved, onRefreshIndicators,
```

### A3. Local refresh state
Add near the other `useState` hooks (e.g. right after `const [expandedTab, setExpandedTab] = useState("position");`):

```jsx
const [refreshingSymbol, setRefreshingSymbol] = useState(null);
```

### A4. Fix the two `nse_scrip_code` → `symbol` references
The migration renamed `nse_scrip_code` to `symbol`; `stockThesisData` rows now carry `symbol`.

**A4a — `handleSaveThesis`:**
```jsx
// BEFORE
const selectedStock = stockThesisData.find(rec => rec.nse_scrip_code === stockSymbol);

// AFTER
const selectedStock = stockThesisData.find(rec => rec.symbol === stockSymbol);
```

**A4b — `thesisBySymbol` memo:**
```jsx
// BEFORE
(Array.isArray(stockThesisData) ? stockThesisData : []).forEach(rec => {
  if (rec?.nse_scrip_code) map[rec.nse_scrip_code] = rec;
});

// AFTER
(Array.isArray(stockThesisData) ? stockThesisData : []).forEach(rec => {
  if (rec?.symbol) map[rec.symbol] = rec;
});
```

### A5. Refresh handler
Add near `handleSaveThesis`:

```jsx
// Refresh fundamental + technical indicators for a single stock.
// Parent (Tabs.jsx) performs the service call + re-fetch of current data.
const handleRefreshIndicators = async (symbol) => {
  if (!onRefreshIndicators) return;
  try {
    setRefreshingSymbol(symbol);
    await onRefreshIndicators(symbol);
  } catch (e) {
    console.error("Indicator refresh failed:", e);
  } finally {
    setRefreshingSymbol(null);
  }
};
```

### A6. Add the third tab button ("Indicators")
In `renderExpandedOrders`, after the "Orders" tab `<button>` and before the sliding-underline `<span>`, insert:

```jsx
<button
  onClick={() => setExpandedTab("indicators")}
  className={`pb-2 text-sm font-medium transition-colors
    ${
      expandedTab === "indicators"
        ? "text-blue-600"
        : "text-(--text-muted) hover:text-(--text-primary)"
    }`}
>
  Indicators
</button>
```

> Note: the existing underline `<span>` only encodes two positions (`position`/`orders`).
> With three tabs it will simply not slide under "Indicators" — cosmetic only.
> Optional: replace its className ternary with a 3-way, e.g.
> `expandedTab === "position" ? "left-0 w-18" : expandedTab === "orders" ? "left-25 w-17" : "left-45 w-20"`.

### A7. Render the indicators panel
After the `expandedTab === "orders" && (<StockOrdersTable ... />)` block, add:

```jsx
{expandedTab === "indicators" && (
  <StockIndicatorsTable
    indicators={thesisBySymbol[stock.symbol]}
    onRefresh={
      onRefreshIndicators
        ? () => handleRefreshIndicators(stock.symbol)
        : undefined
    }
    refreshing={refreshingSymbol === stock.symbol}
  />
)}
```

`thesisBySymbol[stock.symbol]` already holds the full `stockscurrentdata` row
(thesis **and** all indicator columns) because the backend `GET /stockscurrentdata`
now returns them together — no extra prop plumbing required.

---

## B. `src/components/tabs.jsx`

### B1. Add the refresh handler
Place near `handleThesisSaved` (both operate on `stockThesisData`):

```jsx
// Refresh indicators for one stock, then re-pull the current-data snapshot so
// stockThesisData carries fresh fundamentals/technicals + thesis.
const handleRefreshIndicators = async (symbol) => {
  await stockService.refreshStockIndicators([symbol]);
  await fetchStockThesisData(); // re-loads thesis + indicators into stockThesisData
};
```

`stockService` is already imported as `import * as stockService from "../services/stockService";`
and `fetchStockThesisData()` already GETs `/stockscurrentdata`, so it will now
include the indicator columns automatically after the migration.

### B2. Pass the prop to `<StockList>`
```jsx
// BEFORE
  stockThesisData={stockThesisData}
  onThesisSaved={handleThesisSaved}

// AFTER
  stockThesisData={stockThesisData}
  onThesisSaved={handleThesisSaved}
  onRefreshIndicators={handleRefreshIndicators}
```

---

## Verify after applying
1. Open a stock row → **Indicators** tab renders (empty-state until first refresh).
2. Click **Refresh** → `POST /stockscurrentdata/refresh-indicators` fires for that
   symbol, then `GET /stockscurrentdata` re-loads; values populate.
3. Freshness line shows `Fundamentals: <date> · Technicals: <date>`.
4. Thesis tab still saves (confirms the `symbol` rename didn't break `handleSaveThesis`).
