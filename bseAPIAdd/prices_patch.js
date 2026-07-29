// ============================================================================
// prices.js — PATCH REFERENCE
// Apply the 4 changes below to your existing routes/prices.js.
// Nothing else in the file changes.
// ============================================================================


// ----------------------------------------------------------------------------
// CHANGE 1 — ADD near the top, next to NSE_HEADERS / axios import.
// BSE historical daily-close by scrip code (main-board equity).
// StockPriceCSVDownload accepts a date range (unlike GetStockReachGraphData,
// which is latest/chart-only). Params are dd/mm/yyyy. Returns CSV.
// ----------------------------------------------------------------------------
const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/csv,application/json,text/plain,*/*",
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
};

// yyyy-mm-dd  ->  dd/mm/yyyy (BSE param format)
function toBseDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Fetch historical daily closes from BSE by scrip code.
 * @param {string} symbol      NSE symbol (for logging only)
 * @param {string} from        yyyy-mm-dd
 * @param {string} to          yyyy-mm-dd
 * @param {string} scripCode   BSE numeric scrip code (e.g. "500325")
 * @returns {Promise<Array<{date:string, close:number}>>}
 */
async function fetchFromBSE(symbol, from, to, scripCode) {
  if (!scripCode) {
    // No BSE mapping for this symbol -> signal "skip me", let chain fall to Yahoo.
    throw new Error(`No BSE scrip_code for ${symbol}`);
  }

  const url =
    "https://api.bseindia.com/BseIndiaAPI/api/StockPriceCSVDownload/w" +
    `?scripcode=${encodeURIComponent(scripCode)}` +
    `&flag=0&fromdate=${encodeURIComponent(toBseDate(from))}` +
    `&todate=${encodeURIComponent(toBseDate(to))}` +
    "&seriesid=";

  const resp = await axios.get(url, {
    headers: BSE_HEADERS,
    responseType: "text",
    timeout: 30000,
  });

  const text = typeof resp.data === "string" ? resp.data : "";
  if (!text.trim() || text.trim().startsWith("<")) {
    throw new Error(`BSE returned no CSV for ${symbol} (${scripCode})`);
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error(`BSE empty series for ${symbol}`);

  // Header carries: Date, Open, High, Low, Close, ... (column names vary in case/space).
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const dateIdx = header.findIndex((h) => h.includes("date"));
  const closeIdx = header.findIndex((h) => h === "close" || h.includes("close"));
  if (dateIdx === -1 || closeIdx === -1) {
    throw new Error(`BSE CSV missing Date/Close columns for ${symbol}`);
  }

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const rawDate = cols[dateIdx];
    const close = parseFloat(cols[closeIdx]);
    if (!rawDate || !isFinite(close)) continue;

    // BSE dates arrive as "DD MMM YYYY" or "DD/MM/YYYY" — normalise to yyyy-mm-dd (IST).
    const parsed = new Date(rawDate);
    if (isNaN(parsed)) continue;
    out.push({ date: toISTDateKey(parsed), close });
  }

  if (out.length === 0) throw new Error(`BSE parsed 0 rows for ${symbol}`);
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}


// ----------------------------------------------------------------------------
// CHANGE 2 — FIX the pre-existing bug in fetchFromYahoo.
// `parsed` was undefined -> the Yahoo fallback always threw.
// Replace the push line inside fetchFromYahoo's row loop:
//
//   // BEFORE (broken):
//   result.push({ date: toISTDateKey(parsed), close: row.close });
//
//   // AFTER (fixed):
//   result.push({ date: toISTDateKey(row.date), close: row.close });
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// CHANGE 3 — REPLACE fetchOneSymbol with the version below.
// New order: NSE -> BSE(scrip_code) -> Yahoo(.NS) -> Yahoo(.BO).
// Now accepts scripCode (passed through from the request payload).
// ----------------------------------------------------------------------------
async function fetchOneSymbol(symbol, from, to, scripCode) {
  // 1) NSE (primary)
  try {
    const nse = await fetchFromNSE(symbol, from, to);
    if (nse && nse.length) return { symbol, source: "NSE", data: nse };
  } catch (e) {
    console.warn(`[prices] NSE failed for ${symbol}: ${e.message}`);
  }

  // 2) BSE by scrip code (second choice)
  try {
    const bse = await fetchFromBSE(symbol, from, to, scripCode);
    if (bse && bse.length) return { symbol, source: "BSE", data: bse };
  } catch (e) {
    console.warn(`[prices] BSE failed for ${symbol}: ${e.message}`);
  }

  // 3) Yahoo .NS (backup)
  try {
    const ns = await fetchFromYahoo(`${symbol}.NS`, from, to);
    if (ns && ns.length) return { symbol, source: "YAHOO_NS", data: ns };
  } catch (e) {
    console.warn(`[prices] Yahoo .NS failed for ${symbol}: ${e.message}`);
  }

  // 4) Yahoo .BO (last resort)
  try {
    const bo = await fetchFromYahoo(`${symbol}.BO`, from, to);
    if (bo && bo.length) return { symbol, source: "YAHOO_BO", data: bo };
  } catch (e) {
    console.warn(`[prices] Yahoo .BO failed for ${symbol}: ${e.message}`);
  }

  return { symbol, source: null, data: [] };
}


// ----------------------------------------------------------------------------
// CHANGE 4 — In the POST /update_stocks handler, pass scrip_code through.
// The frontend now sends [{ symbol, from, to, scrip_code }].
// Update the loop/map that calls fetchOneSymbol:
//
//   // BEFORE:
//   const results = await Promise.all(
//     ranges.map((r) => fetchOneSymbol(r.symbol, r.from, r.to))
//   );
//
//   // AFTER:
//   const results = await Promise.all(
//     ranges.map((r) => fetchOneSymbol(r.symbol, r.from, r.to, r.scrip_code))
//   );
//
// (If you fetch sequentially instead of Promise.all, just add r.scrip_code
//  as the 4th argument to the fetchOneSymbol call.)
// ----------------------------------------------------------------------------
