// ============================================================================
// stockService.js — INDICATOR ADDITIONS
// ----------------------------------------------------------------------------
// Paste the three exports below into src/services/stockService.js
// (append under a new "CURRENT DATA + INDICATORS" section, alongside the
// existing exports). They reuse the file's existing BASE_URL + handleError.
//
// ALSO REMOVE the now-dead `updateScripCodes` export from stockService.js:
//   - it PUT to /stockscurrentdata/:id writing scrip codes
//   - that column/path no longer exists after the symbol migration
//   - nothing calls it anymore (tabs.jsx already dropped updateScripCodes)
//
// Contract (matches the rest of the service):
//   read  paths  -> return [] / data on success, [] on failure (non-throwing)
//   write paths  -> throw on failure (caller handles via try/catch in Tabs.jsx)
// ============================================================================

/**
 * Fetch the current-data snapshot (thesis + fundamental/technical indicators),
 * one row per symbol, from GET /stockscurrentdata. Read path → [] on failure.
 * @returns {Promise<Array>} rows: [{ id, symbol, thesis_*, ...indicators }]
 */
export const fetchStockCurrentData = async () => {
  try {
    const response = await fetch(`${BASE_URL}/stockscurrentdata`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      await handleError(response, "Failed to fetch stock current data");
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`fetchStockCurrentData failed: ${error.message}`);
    return [];
  }
};

/**
 * Trigger indicator refresh on the backend. Write path → throws on failure.
 * The server resolves held symbols itself when `symbols` is omitted/empty.
 * @param {string[]} [symbols]  omit/empty = all held symbols
 * @param {("fundamentals"|"technicals")[]} [classes] omit = both classes
 * @returns {Promise<Object>} { status, symbols, fundamentals, technicals, failed }
 */
export const refreshStockIndicators = async (symbols, classes) => {
  const body = {};
  if (Array.isArray(symbols) && symbols.length) body.symbols = symbols;
  if (Array.isArray(classes) && classes.length) body.classes = classes;

  const response = await fetch(
    `${BASE_URL}/stockscurrentdata/refresh-indicators`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    await handleError(response, "Failed to refresh indicators");
  }
  return await response.json();
};

/**
 * Manual analyst-target override. Write path → throws on failure.
 * Pass null to CLEAR the value and re-enable automatic Yahoo fill.
 * @param {string} symbol
 * @param {number|null} analyst_target
 * @returns {Promise<Object>} { message, row: { symbol, analyst_target, analyst_target_manual } }
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
  if (!response.ok) {
    await handleError(response, "Failed to set analyst target");
  }
  return await response.json();
};
