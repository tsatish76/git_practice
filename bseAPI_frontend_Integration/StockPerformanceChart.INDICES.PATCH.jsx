// ============================================================================
// stocks/StockPerformanceChart.jsx — INDICES PATCH REFERENCE
// Move from a hardcoded 2-index BENCHMARKS array to the shared 3-index config.
// Also make the benchmark line dash pattern config-driven (was midcap-hardcoded).
// ============================================================================


// ----------------------------------------------------------------------------
// CHANGE 1 — ADD import near the top (with the other imports).
// ----------------------------------------------------------------------------
import { BENCHMARKS } from "../../config/indices";


// ----------------------------------------------------------------------------
// CHANGE 2 — DELETE the local hardcoded BENCHMARKS constant.
//
//   // REMOVE this block entirely:
//   const BENCHMARKS = [
//     { key: "nifty50", label: "Nifty 50",   color: "#22c55e" },
//     { key: "midcap",  label: "Midcap 150", color: "#f59e0b" },
//   ];
//
// BENCHMARKS now comes from the import in CHANGE 1 and carries { key, label,
// color, dash }. Nothing else about how BENCHMARKS is consumed changes —
// indexMaps still keys by b.key, mergedSeries still reads point[b.key], etc.
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// CHANGE 3 — In the benchmark <Line> render, make the dash config-driven.
//
//   // BEFORE:
//   strokeDasharray={b === "midcap" ? "5 3" : undefined}
//
//   // AFTER:
//   strokeDasharray={BENCHMARKS.find((x) => x.key === b)?.dash}
//
// (You already compute `const meta = BENCHMARKS.find(x => x.key === b);` right
//  above this line — you can just use `meta?.dash` instead of re-finding.)
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// NOTE
// - Smallcap 250 will show a "(no data)" disabled pill until the first index
//   update populates it (its hasData = indexMaps["smallcap250"]?.size > 0).
// - DB symbol "SMALLCAP250" lowercases to "smallcap250" = its config key, so
//   indexMaps lookups line up automatically. Same for "MIDCAP150"->"midcap150".
// - Old "MIDCAP" (Midcap-50) rows in index_price_history are now orphaned and
//   simply ignored (no config key maps to them). Optionally delete them:
//     DELETE FROM index_price_history WHERE symbol = 'MIDCAP';
// ----------------------------------------------------------------------------
