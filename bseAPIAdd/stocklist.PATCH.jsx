// ============================================================================
// stocklist.jsx — PATCH REFERENCE
// Pass instrumentsMap into computeMissingPriceRanges so scrip_code rides along
// in the payload sent to POST /prices/update_stocks.
// ============================================================================


// ----------------------------------------------------------------------------
// CHANGE — the call site where missing ranges are computed.
// stocklist.jsx already has instrumentsMap (built from stockInstruments, which
// now carries scrip_code from the instrument master sync).
//
// BEFORE:
//   const missingStockRanges = computeMissingPriceRanges(
//     stocks,
//     priceHistory,
//     allocations
//   );
//
// AFTER:
//   const missingStockRanges = computeMissingPriceRanges(
//     stocks,
//     priceHistory,
//     allocations,
//     instrumentsMap            // NEW: forwards scrip_code per symbol
//   );
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// NO other change needed here.
// The existing fetch/POST to /prices/update_stocks already sends
// `missingStockRanges` as the body — each element now simply includes
// scrip_code, which the backend reads in CHANGE 4 of prices.PATCH.js.
//
// If instrumentsMap is keyed case-sensitively, ensure the key matches the
// stock `symbol` casing used in computeMissingPriceRanges (both should be the
// canonical uppercase NSE symbol, consistent with the instrument sync).
// ----------------------------------------------------------------------------
