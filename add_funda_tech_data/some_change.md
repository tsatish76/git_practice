npm view reports the registry latest (4.0.0), not what's installed. Your package.json pins ^3.11.2, which caps at <4.0.0 — so npm install resolves to 3.15.x, not 4.0.0, unless you change the spec. Either is fine: the service uses the v4-style constructor (new YahooFinance({...})), quoteSummary, fundamentalsTimeSeries, and chart — all present and identical in 3.15+ and 4.0. To actually run on 4.0, bump the spec to ^4.0.0; otherwise you stay on 3.15.x. No code change either way.

Proceeding with the frontend. Delivering the presentational indicators component now (self-contained, safe), plus the stockService.js additions and the surgical stocklist.jsx edits.Continuing the frontend delivery — the indicators component, plus the stockService.js additions and surgical stocklist.jsx edits.All frontend pieces below. Place StockIndicatorsTable.jsx in src/components/stocks/.1.jsx

1. stockService.js — additions + one removal

Remove the dead updateScripCodes (writes to the retired /stockscurrentdata/:id path). Add these three:

// ============================================================================
// CURRENT DATA + INDICATORS
// ============================================================================

/**
 * Fetch the current-data snapshot (thesis + fundamental/technical indicators),
 * one row per symbol. Read path → returns [] on failure.
 */
export const fetchStockCurrentData = async () => {
  try {
    const response = await fetch(`${BASE_URL}/stockscurrentdata`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) await handleError(response, "Failed to fetch stock current data");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`fetchStockCurrentData failed: ${error.message}`);
    return [];
  }
};

/**
 * Trigger indicator refresh. Write path → throws on failure.
 * @param {string[]} [symbols]  omit/empty = all held symbols (server resolves)
 * @param {("fundamentals"|"technicals")[]} [classes] omit = both
 */
export const refreshStockIndicators = async (symbols, classes) => {
  const body = {};
  if (Array.isArray(symbols) && symbols.length) body.symbols = symbols;
  if (Array.isArray(classes) && classes.length) body.classes = classes;
  const response = await fetch(`${BASE_URL}/stockscurrentdata/refresh-indicators`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) await handleError(response, "Failed to refresh indicators");
  return await response.json();
};

/**
 * Manual analyst-target override. Pass null to clear + re-enable auto-fill.
 */
export const setAnalystTarget = async (symbol, analyst_target) => {
  const response = await fetch(
    `${BASE_URL}/stockscurrentdata/analyst-target/${encodeURIComponent(symbol)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analyst_target }),
    }
  );
  if (!response.ok) await handleError(response, "Failed to set analyst target");
  return await response.json();
};

2. stocklist.jsx — surgical edits

a. Import (with the other stock imports):

import StockIndicatorsTable from "./stocks/StockIndicatorsTable";


b. Add prop onRefreshIndicators to the component signature (near onThesisSaved):

onOrdersEdit, onThesisSaved, onRefreshIndicators,


c. Local refresh state (near the other useStates):

const [refreshingSymbol, setRefreshingSymbol] = useState(null);


d. nse_scrip_code → symbol — the two references keyed off the renamed column:

handleSaveThesis:

// BEFORE
const selectedStock = stockThesisData.find(rec => rec.nse_scrip_code === stockSymbol);
// AFTER
const selectedStock = stockThesisData.find(rec => rec.symbol === stockSymbol);


thesisBySymbol memo:

// BEFORE
if (rec?.nse_scrip_code) map[rec.nse_scrip_code] = rec;
// AFTER
if (rec?.symbol) map[rec.symbol] = rec;


e. Refresh handler (near handleSaveThesis):

const handleRefreshIndicators = async (symbol) => {
  if (!onRefreshIndicators) return;
  try {
    setRefreshingSymbol(symbol);
    await onRefreshIndicators(symbol); // parent: service call + re-fetch current data
  } catch (e) {
    console.error("Indicator refresh failed:", e);
  } finally {
    setRefreshingSymbol(null);
  }
};


f. Third tab in the expanded row. Add the tab button after the "Orders" button:

<button
  onClick={() => setExpandedTab("indicators")}
  className={`pb-2 text-sm font-medium transition-colors ${
    expandedTab === "indicators"
      ? "text-blue-600"
      : "text-(--text-muted) hover:text-(--text-primary)"
  }`}
>
  Indicators
</button>


(the sliding underline <span> widths are cosmetic — adjust or drop once 3 tabs are present.)

g. Render the panel — after the expandedTab === "orders" block:

{expandedTab === "indicators" && (
  <StockIndicatorsTable
    indicators={thesisBySymbol[stock.symbol]}
    onRefresh={onRefreshIndicators ? () => handleRefreshIndicators(stock.symbol) : undefined}
    refreshing={refreshingSymbol === stock.symbol}
  />
)}


thesisBySymbol[stock.symbol] already carries the full stockscurrentdata row (thesis and indicators) since the backend GET now returns them together — no extra prop plumbing needed.

3. One dependency I need — tabs.jsx

The refresh side-effect (service call → re-fetch current data → update state) is owned by the state layer, not stocklist.jsx, per your stockService architecture doc. To wire onRefreshIndicators correctly I need tabs.jsx to:

confirm no other nse_scrip_code references survive the rename,
add the handler: refreshStockIndicators([symbol]) → fetchStockCurrentData() → setStockThesisData(...).

Paste tabs.jsx (plain text) and I'll emit the exact handler + prop wiring. Until then, the component and service are drop-in; the tab renders read-only if onRefreshIndicators isn't passed.
