// ============================================================================
// indices.js — single source of truth for benchmark indices.
// ----------------------------------------------------------------------------
// key   : lowercase; MUST equal DB symbol lowercased (charts lowercase indexMaps).
// symbol: DB symbol stored in index_price_history (uppercase, no spaces).
// nse   : exact NSE indicesHistory `indexType` string (backend uses this).
// label : chart display name.
// color : chart line color.
// dash  : recharts strokeDasharray (undefined = solid).
//
// Add/remove an index here and it propagates to: backend fetch config,
// missing-range bootstrap, both performance charts (pills + lines + legend).
// ============================================================================
export const INDICES = [
  { key: "nifty50",     symbol: "NIFTY50",     nse: "NIFTY 50",           label: "Nifty 50",      color: "#22c55e", dash: undefined },
  { key: "midcap150",   symbol: "MIDCAP150",   nse: "NIFTY MIDCAP 150",   label: "Midcap 150",    color: "#f59e0b", dash: "5 3" },
  { key: "smallcap250", symbol: "SMALLCAP250", nse: "NIFTY SMALLCAP 250", label: "Smallcap 250",  color: "#8b5cf6", dash: "2 3" },
];

// Chart benchmark shape: [{ key, label, color, dash }]
export const BENCHMARKS = INDICES.map(({ key, label, color, dash }) => ({
  key,
  label,
  color,
  dash,
}));

// DB symbols (uppercase) used for missing-range bootstrap + /get_indices default.
export const INDEX_SYMBOLS = INDICES.map((i) => i.symbol);

export default INDICES;
