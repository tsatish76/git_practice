// ============================================================================
// stocks/HelperFunctions.jsx — INDICES PATCH REFERENCE
// Fix: bootstrap missing ranges for ALL configured indices, not just those
// already present in indexHistory. Without this, a brand-new index (Smallcap
// 250, with zero rows in DB) is never a key in indexHistory → no range is
// computed → it is never fetched.
// ============================================================================


// ----------------------------------------------------------------------------
// CHANGE 1 — ADD import at top of the file.
// ----------------------------------------------------------------------------
import { INDEX_SYMBOLS } from "../../config/indices";


// ----------------------------------------------------------------------------
// CHANGE 2 — REPLACE computeMissingIndexRanges.
// Old version iterated Object.entries(indexHistory) (only existing indices).
// New version iterates the canonical INDEX_SYMBOLS so missing indices seed a
// full range from global inception. indexHistory is the object returned by
// GET /prices/get_indices, keyed by DB symbol (uppercase).
// ----------------------------------------------------------------------------
export const computeMissingIndexRanges = (stocks, indexHistory) => {
  const lastMarketDay = getLastMarketDay();

  // 1) Global earliest trade date (indices have no trades → portfolio inception)
  let globalStart = null;
  stocks.forEach((trade) => {
    if (!globalStart || trade.date < globalStart) globalStart = trade.date;
  });
  if (!globalStart) return []; // no trades → nothing to benchmark

  const ranges = [];

  // 2) Iterate the CONFIGURED index set (not just what already has history).
  INDEX_SYMBOLS.forEach((symbol) => {
    const history = indexHistory?.[symbol];

    // NEW / EMPTY index → fetch full window from inception.
    if (!Array.isArray(history) || history.length === 0) {
      ranges.push({ symbol, from: globalStart, to: lastMarketDay });
      return;
    }

    let min = null;
    let max = null;
    history.forEach((row) => {
      if (!row.date) return;
      if (!min || row.date < min) min = row.date;
      if (!max || row.date > max) max = row.date;
    });

    // Missing before history
    if (globalStart < min) {
      const beforeEnd = new Date(min);
      beforeEnd.setDate(beforeEnd.getDate() - 1);
      ranges.push({
        symbol,
        from: globalStart,
        to: beforeEnd.toISOString().slice(0, 10),
      });
    }

    // Missing after history
    const afterStart = new Date(max);
    afterStart.setDate(afterStart.getDate() + 1);
    const afterStr = afterStart.toISOString().slice(0, 10);
    if (afterStr <= lastMarketDay) {
      ranges.push({ symbol, from: afterStr, to: lastMarketDay });
    }
  });

  return ranges;
};


// ----------------------------------------------------------------------------
// NOTE — no call-site change in stocklist.jsx.
// helpers.computeMissingIndexRanges(stocks, indexHistory) signature is
// unchanged; it now simply consults INDEX_SYMBOLS internally.
// ----------------------------------------------------------------------------
