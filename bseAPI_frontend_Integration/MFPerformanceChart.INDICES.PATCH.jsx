// ============================================================================
// mutualFunds/MFPerformanceChart.jsx — INDICES PATCH REFERENCE
// Identical treatment to the stock chart: shared 3-index config + config-driven
// dash. Both charts read the SAME indexHistory state from tabs.jsx, so no MF-
// side fetch is needed — indices are populated from the Stocks tab's update.
// ============================================================================


// ----------------------------------------------------------------------------
// CHANGE 1 — ADD import near the top.
// ----------------------------------------------------------------------------
import { BENCHMARKS } from "../../config/indices";


// ----------------------------------------------------------------------------
// CHANGE 2 — DELETE the local hardcoded BENCHMARKS constant.
//
//   // REMOVE:
//   const BENCHMARKS = [
//     { key: "nifty50", label: "Nifty 50",   color: "#22c55e" },
//     { key: "midcap",  label: "Midcap 150", color: "#f59e0b" },
//   ];
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// CHANGE 3 — Benchmark <Line>: config-driven dash.
//
//   // BEFORE:
//   strokeDasharray={b === "midcap" ? "5 3" : undefined}
//
//   // AFTER (meta is already found just above):
//   strokeDasharray={meta?.dash}
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// CHANGE 4 — Legend dashed border check (this file styles the legend swatch
// with a borderTop for midcap). Make it config-driven.
//
//   // BEFORE:
//   style={{ background: meta?.color, borderTop: b === "midcap" ? `2px dashed ${meta?.color}` : undefined }}
//
//   // AFTER:
//   style={{ background: meta?.color, borderTop: meta?.dash ? `2px dashed ${meta?.color}` : undefined }}
// ----------------------------------------------------------------------------
