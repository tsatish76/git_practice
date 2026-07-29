// ============================================================================
// HelperFunctions.jsx — PATCH REFERENCE
// Attach scrip_code to each missing range so the backend can use BSE as #2.
// ============================================================================


// ----------------------------------------------------------------------------
// CHANGE — computeMissingPriceRanges
// Add `instrumentsMap` as a parameter and stamp scrip_code onto each range.
// instrumentsMap is keyed by symbol and each value carries { scrip_code, ... }.
//
// BEFORE (signature + return shape):
//   export function computeMissingPriceRanges(stocks, priceHistory, allocations) {
//       ...
//       ranges.push({ symbol, from, to });
//       ...
//   }
//
// AFTER:
// ----------------------------------------------------------------------------
export function computeMissingPriceRanges(
  stocks,
  priceHistory,
  allocations,
  instrumentsMap = {}   // NEW: symbol -> instrument (has scrip_code)
) {
  const ranges = [];

  // ... keep your existing gap-detection logic exactly as-is ...
  // Wherever you currently build a range object, change ONLY the push:

  //   OLD:
  //   ranges.push({ symbol, from, to });
  //
  //   NEW:
  //   const scrip_code = instrumentsMap[symbol]?.scrip_code || null;
  //   ranges.push({ symbol, from, to, scrip_code });

  return ranges;
}


// ----------------------------------------------------------------------------
// NOTE
// scrip_code === null is fine: the backend's fetchFromBSE throws on a missing
// code and the chain falls through to Yahoo(.NS)/(.BO). No frontend guard needed.
// ----------------------------------------------------------------------------
