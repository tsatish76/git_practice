// ============================================================================
//
// REPLACES: PerformanceChart.jsx (old version had no gain/returnPct/cashFlow)
//
// DATA SOURCE: portfolioSeries from buildStockPortfolioSeries()
//   Shape: [{ date, value, gain, returnPct, cashFlow }]
//   - value:     true ₹ portfolio value (chart line)
//   - gain:      market-only daily gain ₹ (cash-flow-adjusted)
//   - returnPct: market-only daily % return
//   - cashFlow:  XIRR sign — BUY = negative, SELL = positive
//
// RETURN METHODOLOGY (single engine):
//   Both SOLO and COMPARISON modes use ONE daily return: returnPct from
//   buildStockPortfolioSeries. The solo header TWR% and the comparison-mode
//   base-100 portfolio line are BOTH chain-linked from this same returnPct,
//   so they can never diverge. Cash flow NEVER enters the return calculation —
//   it is used only as marker (dot/tooltip) metadata. This is a true
//   time-weighted return, directly comparable to the normalized benchmarks.
//
// FEATURES:
//   ✅ StockSummaryCard: current value, net invested, daily move, XIRR
//      + today up/down stock counts + overall gain/loss stock counts
//   ✅ Rich tooltip: portfolio value, invested, cumulative gain, cash flow events
//   ✅ Reference dots on BUY/SELL days (solo + comparison modes)
//   ✅ Correct TWR % via chain-linked daily returns (not absGain/firstPV)
//   ✅ XIRR via negated cashFlow (investor perspective sign convention)
//   ✅ Benchmark normalization (base-100)
//   ✅ All time ranges: 1W 1M 6M 1Y 2Y 5Y ALL
//
// ASSUMPTIONS:
//   - indexHistory shape: either array [{symbol, history:[{date,close}]}]
//     or object { nifty50: [{date,close}], midcap: [...] }
//   - portfolioSeries is pre-computed in tabs.jsx via buildStockPortfolioSeries
//     and passed down to stocklist.jsx → here via props
//   - XIRR uses `xirr` npm package; cashFlow is negated inside computeStockXIRR
//   - "Today" counts use priceHistory second-to-last date per symbol
// ============================================================================
import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot,
} from "recharts";
import {FaChartBar, FaListUl,} from "react-icons/fa";
import xirr from "xirr";
import { formatNumber } from "../../utils/formats";
import utils from "../../utils/utils";
// ── Constants ─────────────────────────────────────────────────────────────────
const BENCHMARKS = [
  { key: "nifty50", label: "Nifty 50",   color: "#22c55e" },
  { key: "midcap",  label: "Midcap 150", color: "#f59e0b" },
];
const RANGES       = ["1W", "1M", "6M", "1Y", "2Y", "5Y", "ALL"];
const PORTFOLIO_COLOR = "#4F46E5";
// ── Helpers ───────────────────────────────────────────────────────────────────
const normDate = (v) => {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const p = new Date(v);
  return isNaN(p.getTime()) ? null : p.toISOString().split("T")[0];
};
const fmtPct  = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + "%";
const gc      = v => v >= 0 ? "text-(--gain)" : "text-(--loss)";
// ============================================================================
// StockPerformanceChart
//
// Props:
//   portfolioSeries  – [{ date, value, gain, returnPct, cashFlow }]
//   indexHistory     – array or object of index price series
// ============================================================================
const StockPerformanceChart = ({
  portfolioSeries = [],
  indexHistory    = [],
}) => {
  const [range,            setRange]            = useState("1Y");
  const [activeBenchmarks, setActiveBenchmarks] = useState([]);
  const lastTickRef = useRef(null);
  const toggleBenchmark = useCallback((key) => {
    setActiveBenchmarks(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }, []);
  const fmtINR  = v => "₹" + Math.abs(Math.round(v || 0)).toLocaleString("en-IN");
  const gc      = v => v >= 0 ? "text-(--gain)" : "text-(--loss)";
  const gcBg    = v => v >= 0
    ? "bg-(--bubble-gain-bg) border-(--bubble-gain-border)"
    : "bg-(--bubble-loss-bg) border-(--bubble-loss-border)";
  const fmtPct  = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + "%";
  // --------------------------------------------------------------------------
  // Build index maps — supports both array and object shapes of indexHistory
  // --------------------------------------------------------------------------
  const indexMaps = useMemo(() => {
    const maps = {};
    if (Array.isArray(indexHistory)) {
      indexHistory.forEach(entry => {
        if (!entry.symbol || !Array.isArray(entry.history)) return;
        const m = new Map();
        entry.history.forEach(r => {
          const d = normDate(r.date);
          if (d && r.close != null) m.set(d, Number(r.close));
        });
        maps[entry.symbol.toLowerCase()] = m;
      });
    } else if (indexHistory && typeof indexHistory === "object") {
      Object.entries(indexHistory).forEach(([sym, series]) => {
        const m = new Map();
        (Array.isArray(series) ? series : []).forEach(r => {
          const d = normDate(r.date);
          if (d && r.close != null) m.set(d, Number(r.close));
        });
        maps[sym.toLowerCase()] = m;
      });
    }
    return maps;
  }, [indexHistory]);
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Merge portfolioSeries with index carry-forwarded values
  // --------------------------------------------------------------------------
  const mergedSeries = useMemo(() => {
    if (!portfolioSeries.length) return [];
    const lastIndexVal = {};
    return portfolioSeries.map(row => {
      const point = {
        date:      row.date,
        portfolio: row.value,
        gain:      row.gain      ?? 0,
        returns:   row.returnPct ?? 0,
        cashFlow:  row.cashFlow  ?? 0,
      };
      BENCHMARKS.forEach(b => {
        const v = indexMaps[b.key]?.get(row.date);
        if (v != null) lastIndexVal[b.key] = v;
        point[b.key] = lastIndexVal[b.key] ?? null;
      });
      return point;
    });
  }, [portfolioSeries, indexMaps]);
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Time range filter
  // --------------------------------------------------------------------------
  const filteredSeries = useMemo(() => {
    if (!mergedSeries.length) return [];
    if (range === "ALL") return mergedSeries;
    const last    = new Date(mergedSeries[mergedSeries.length - 1].date);
    const daysMap = { "1W": 7, "1M": 30, "6M": 180, "1Y": 365, "2Y": 730, "5Y": 1825 };
    const cutoff  = new Date(last.getTime() - (daysMap[range] ?? 365) * 86_400_000);
    return mergedSeries.filter(d => new Date(d.date) >= cutoff);
  }, [mergedSeries, range]);
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // summaryStats: absGain (Σ daily market gains) + TWR % (chain-linked)
  // --------------------------------------------------------------------------
  const summaryStats = useMemo(() => {
    if (!filteredSeries.length) return null;
    const last = filteredSeries[filteredSeries.length - 1];
    const absGain = filteredSeries
      .filter(r => r.portfolio > 0)
      .reduce((s, r) => s + (r.gain ?? 0), 0);
    const twr = filteredSeries.slice(1).reduce((prod, r) => {
      if (r.portfolio <= 0) return prod;
      return prod * (1 + (r.returns ?? 0) / 100);
    }, 1);
    const pctGain = (twr - 1) * 100;
    const netInvestedWindow = filteredSeries.reduce((s, r) => s + (r.cashFlow ?? 0), 0);
    return { absGain, pctGain, currentValue: last.portfolio, netInvestedWindow };
  }, [filteredSeries]);
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // chartData: solo (raw ₹) or comparison (TWR base-100 + normalized indices)
  // --------------------------------------------------------------------------
  const chartData = useMemo(() => {
    if (!filteredSeries.length) return [];
    // ── SOLO MODE ────────────────────────────────────────────────────────────
    if (activeBenchmarks.length === 0) {
      let cumulativeCashFlow = 0;
      let cumulativeGain     = 0;
      return filteredSeries.map((row, idx) => {
        cumulativeCashFlow += (row.cashFlow ?? 0);
        if (idx > 0 && row.portfolio > 0) cumulativeGain += (row.gain ?? 0);
        return {
          date:        row.date,
          portfolio:   row.portfolio,
          cashFlow:    -(row.cashFlow ?? 0),
          netInvested: -cumulativeCashFlow,   // positive = net deployed
          totalGain:   idx === 0 ? 0 : cumulativeGain,
          gain:        row.gain ?? 0,
          returns:   row.returns ?? 0,
        };
      });
    }
    // ── COMPARISON MODE ──────────────────────────────────────────────────────
    // FIX #3 — SINGLE RETURN ENGINE.
    // The portfolio line is chain-linked from the SAME daily market return
    // (row.returns === returnPct from buildStockPortfolioSeries) that the
    // solo-mode summaryStats.twr uses. This guarantees the plotted comparison
    // line == the header TWR%, and removes the previous, separate inline
    // Modified-Dietz calculation that re-derived returns from NAV + cashFlow.
    //
    // Cash flow does NOT enter the return here — it only moved shares inside
    // the engine. cashFlow is carried purely as marker metadata for the
    // BUY/SELL dots. The skip-on-nonpositive-PV branch mirrors summaryStats.twr
    // exactly so the two stay identical.
    const benchmarkBase = {};
    activeBenchmarks.forEach(b => {
      const first = filteredSeries.find(r => r[b] != null);
      benchmarkBase[b] = first ? first[b] : null;
    });
    let twrIndex = 100;
    return filteredSeries.map((row, i) => {
      const point = { date: row.date };
      // Portfolio TWR (base-100) — chain-linked daily returnPct.
      if (i === 0) {
        point.portfolio = 100;
      } else if (row.portfolio > 0) {
        twrIndex *= (1 + (row.returns ?? 0) / 100);
        point.portfolio = parseFloat(twrIndex.toFixed(4));
      } else {
        // Non-positive PV day: carry index forward (matches summaryStats.twr skip).
        point.portfolio = parseFloat(twrIndex.toFixed(4));
      }
      // Cash-flow marker metadata only (display sign: + = invested/BUY, − = sold/SELL).
      point.cashFlow = -(row.cashFlow ?? 0);
      // Benchmark normalization (base-100).
      activeBenchmarks.forEach(b => {
        if (row[b] != null && benchmarkBase[b] != null) {
          point[b] = parseFloat(((row[b] / benchmarkBase[b]) * 100).toFixed(4));
        } else {
          point[b] = null;
        }
      });
      return point;
    });
  }, [filteredSeries, activeBenchmarks]);
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // X-axis tick formatter (deduplicated via ref)
  // --------------------------------------------------------------------------
  const formatXAxis = (date) => {
    const d = new Date(date);
    let label;
    switch (range) {
      case "1W": label = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }); break;
      case "1M": label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); break;
      case "6M":
      case "1Y": label = d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }); break;
      default:   label = d.getFullYear().toString();
    }
    if (lastTickRef.current === label) return "";
    lastTickRef.current = label;
    return label;
  };
  const tickInterval = { "1W": 0, "1M": 2, "6M": 10, "1Y": 18, "2Y": 35, "5Y": 60, "ALL": 80 };
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Custom tooltip
  // --------------------------------------------------------------------------
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const isSolo = activeBenchmarks.length === 0;
    const pfRow  = payload.find(p => p.dataKey === "portfolio");
    const d      = new Date(label).toLocaleDateString("en-IN",
      { day: "numeric", month: "short", year: "numeric" });
    return (
      <div className="bg-(--card) border border-(--border-light)
                      rounded-xl shadow-xl p-3 text-xs min-w-50">
        <p className="font-semibold text-(--text) mb-2 border-b
                      border-(--border-light) pb-1">{d}</p>
        {isSolo && pfRow && (
          <>
            <div className="flex justify-between gap-4 mb-1">
              <span className="text-(--text-muted)">Portfolio Value</span>
              <span className="font-semibold">{fmtINR(pfRow.value)}</span>
            </div>
            {pfRow.payload.netInvested != null && (
              <div className="flex justify-between gap-4 mb-1">
                <span className="text-(--text-muted)">Net Invested</span>
                <span className="font-medium">{fmtINR(pfRow.payload.netInvested)}</span>
              </div>
            )}
            {pfRow.payload.totalGain != null && (
              <div className="flex justify-between gap-4 mb-1">
                <span className="text-(--text-muted)">Cumulative Gain</span>
                <span className={`font-semibold ${gc(pfRow.payload.totalGain)}`}>
                  {pfRow.payload.totalGain >= 0 ? "+" : ""}
                  {fmtINR(pfRow.payload.totalGain)}
                </span>
              </div>
            )}
            {pfRow.payload.gain != null && pfRow.payload.returns != null &&(
              <div className="flex justify-between gap-4 mb-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                  ${pfRow.payload.gain >= 0
                    ? "bg-(--bubble-gain-bg) text-(--gain)"
                    : "bg-(--bubble-loss-bg) text-(--loss)"}`}>
                  {fmtINR(pfRow.payload.gain)}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                  ${pfRow.payload.returns >= 0
                    ? "bg-(--bubble-gain-bg) text-(--gain)"
                    : "bg-(--bubble-loss-bg) text-(--loss)"}`}>
                  {fmtPct(pfRow.payload.returns)}
                </span>
              </div>
            )}
            {pfRow.payload.cashFlow !== 0 && (
              <div className="flex justify-between gap-4 mt-1 pt-1
                              border-t border-(--border-light)">
                <span className="text-(--text-muted)">
                  {pfRow.payload.cashFlow > 0 ? "💰 Invested" : "💸 Sold"}
                </span>
                <span className={`font-medium
                  ${pfRow.payload.cashFlow > 0 ? "text-blue-400" : "text-orange-400"}`}>
                  {fmtINR(Math.abs(pfRow.payload.cashFlow))}
                </span>
              </div>
            )}
          </>
        )}
        {!isSolo && payload.map(entry => {
          if (entry.value == null) return null;
          const bMeta   = BENCHMARKS.find(b => b.key === entry.dataKey);
          const lbl     = entry.dataKey === "portfolio" ? "Portfolio" : bMeta?.label;
          const color   = entry.dataKey === "portfolio" ? PORTFOLIO_COLOR : bMeta?.color;
          const pfVal   = pfRow?.value ?? 0;
          const spread  = entry.dataKey !== "portfolio" ? pfVal - entry.value : null;
          return (
            <div key={entry.dataKey} className="mb-1">
              <div className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block"
                        style={{ background: color }} />
                  <span className="text-(--text-muted)">{lbl}</span>
                </span>
                <span className="font-semibold" style={{ color }}>
                  {entry.value.toFixed(2)}
                </span>
              </div>
              {spread != null && (
                <div className="flex justify-between gap-4 ml-3.5">
                  <span className="text-(--text-muted) italic">alpha</span>
                  <span className={`text-[10px] font-medium ${
                    spread >= 0 ? "text-(--gain)" : "text-(--loss)"
                  }`}>
                    {spread >= 0 ? "+" : ""}{spread.toFixed(2)} pts
                  </span>
                </div>
              )}
              {entry.dataKey === "portfolio" &&
                entry.payload?.cashFlow !== 0 &&
                entry.payload?.cashFlow != null && (
                  <div className="flex justify-between gap-4 ml-3.5 mt-0.5">
                    <span
                      className={
                        entry.payload.cashFlow > 0 ? "text-green-500" : "text-orange-500"
                      }
                    >
                      {entry.payload.cashFlow > 0 ? "● Invested" : "● Sold"}
                    </span>
                    <span
                      className={
                        entry.payload.cashFlow > 0 ? "text-green-500" : "text-orange-500"
                      }
                    >
                      ₹
                      {Math.abs(Math.round(entry.payload.cashFlow)).toLocaleString("en-IN")}
                    </span>
                  </div>
                )}
            </div>
          );
        })}
      </div>
    );
  };
  // --------------------------------------------------------------------------
  if (!portfolioSeries.length) {
    return (
      <div className="mb-6 w-full max-w-5xl mx-auto">
        <div className="bg-(--card) border border-(--border) rounded-xl
                        p-6 text-center text-(--text-muted) text-sm">
          No price history available. Click <strong>Update Price History</strong> to fetch data.
        </div>
      </div>
    );
  }
  const isGain = (summaryStats?.absGain ?? 0) >= 0;
  return (
    <div className="mb-6 w-full max-w-5xl mx-auto">
      <div className="bg-(--card) border border-(--border)
                      rounded-2xl shadow-sm p-5">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-(--text) mb-0.5">
              📈 Stock Portfolio Performance
            </h3>
            {summaryStats && activeBenchmarks.length === 0 && (
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-xl font-bold text-(--text)">
                  {fmtINR(summaryStats.currentValue)}
                </span>
                <span className={`text-sm font-semibold ${gc(summaryStats.absGain)}`}>
                  {summaryStats.absGain >= 0 ? "+" : ""}{fmtINR(summaryStats.absGain)}
                  &nbsp;(TWR: {fmtPct(summaryStats.pctGain)})
                </span>
                <span className="text-xs text-(--text-muted)">
                  {filteredSeries[0]?.date} - {filteredSeries[filteredSeries.length - 1]?.date}
                </span>
              </div>
            )}
            {summaryStats && activeBenchmarks.length > 0 && (
              <p className="text-xs text-(--text-muted) mt-1">
                Normalized to 100 · higher = outperformed
              </p>
            )}
          </div>
          {/* Range buttons */}
          <div className="flex gap-1 flex-wrap">
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => { lastTickRef.current = null; setRange(r); }}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors
                  ${range === r
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-(--card) border-(--border) text-(--text-muted)"
                  }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {/* ── Benchmark pills ─────────────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap mb-4">
          <span className="text-xs text-(--text-muted) self-center mr-1">
            Compare vs:
          </span>
          {BENCHMARKS.map(b => {
            const active  = activeBenchmarks.includes(b.key);
            const hasData = (indexMaps[b.key]?.size ?? 0) > 0;
            return (
              <button
                key={b.key}
                onClick={() => hasData && toggleBenchmark(b.key)}
                title={!hasData ? "No data available" : ""}
                className={`px-3 py-1 text-xs rounded-full border transition-all
                  ${active ? "text-white border-transparent" : "bg-(--card) border-(--border) text-(--text-muted)"}
                  ${hasData ? "cursor-pointer hover:opacity-90" : "opacity-40 cursor-not-allowed"}`}
                style={active ? { background: b.color } : {}}
              >
                {b.label}{!hasData ? " (no data)" : ""}
              </button>
            );
          })}
        </div>
        {/* ── Chart ───────────────────────────────────────────────────── */}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="var(--text-3)"
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickFormatter={formatXAxis}
                interval={tickInterval[range] ?? 18}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[d => Math.floor(d * 0.993), d => Math.ceil(d * 1.007)]}
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                stroke="var(--text-3)"
                axisLine={false}
                tickLine={false}
                tickFormatter={v =>
                  activeBenchmarks.length === 0
                    ? v >= 10_00_000 ? `₹${(v / 10_00_000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}k`
                    : v.toFixed(0)
                }
                width={55}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: "var(--border-light)", strokeWidth: 1 }}
              />
              {/* Portfolio line */}
              <Line
                type="monotone"
                dataKey="portfolio"
                name="Portfolio"
                stroke={PORTFOLIO_COLOR}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
              />
              {/* BUY/SELL reference dots in solo mode */}
              {activeBenchmarks.length === 0 &&
                chartData
                  .filter(r => r.cashFlow !== 0)
                  .map(r => (
                    <ReferenceDot
                      key={r.date}
                      x={r.date}
                      y={r.portfolio}
                      r={4}
                      fill={r.cashFlow > 0 ? "#30c550" : "#f97316"}
                      stroke="none"
                      isFront
                    />
                  ))
              }
              {/* Benchmark lines */}
              {activeBenchmarks.map(b => {
                const meta = BENCHMARKS.find(x => x.key === b);
                return (
                  <Line
                    key={b}
                    type="monotone"
                    dataKey={b}
                    name={meta?.label}
                    stroke={meta?.color}
                    strokeWidth={1.8}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    strokeDasharray={b === "midcap" ? "5 3" : undefined}
                    connectNulls
                  />
                );
              })}
              {
                /* BUY/SELL reference dots — COMPARISON mode (plotted on TWR index) */
              }
              {activeBenchmarks.length > 0 &&
                chartData
                  .filter((r) => r.cashFlow !== 0)
                  .map((r) => (
                    <ReferenceDot
                      key={`cf-cmp-${r.date}`}
                      x={r.date}
                      y={r.portfolio}
                      r={4}
                      fill={r.cashFlow > 0 ? "#30c550" : "#f97316"}
                      stroke="none"
                      isFront
                    />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* ── Legend ──────────────────────────────────────────────────── */}
        <div className="flex gap-4 flex-wrap mt-3 pt-3
                        border-t border-(--border-light)">
          <div className="flex items-center gap-1.5 text-xs text-(--text-muted)">
            <span className="w-5 h-0.5 inline-block rounded"
                  style={{ background: PORTFOLIO_COLOR }} />
            Portfolio
          </div>
          {activeBenchmarks.map(b => {
            const meta = BENCHMARKS.find(x => x.key === b);
            return (
              <div key={b} className="flex items-center gap-1.5 text-xs text-(--text-muted)">
                <span className="w-5 h-0.5 inline-block rounded"
                      style={{ background: meta?.color }} />
                {meta?.label}
              </div>
            );
          })}
          {activeBenchmarks.length === 0 && (
            <div className="flex items-center gap-3 text-xs text-(--text-muted)">
              <span className="flex items-center gap-1">
                <span className="w-3 h-px border-t border-dashed border-indigo-400 inline-block" />
                BUY
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-px border-t border-dashed border-orange-400 inline-block" />
                SELL
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
// ============================================================================
export default StockPerformanceChart;
