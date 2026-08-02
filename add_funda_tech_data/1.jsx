import React from "react";
import { FaSyncAlt, FaArrowUp, FaArrowDown, FaArrowRight } from "react-icons/fa";

// ============================================================================
// StockIndicatorsTable
// ----------------------------------------------------------------------------
// Presentational-only. Renders the fundamental + technical indicator snapshot
// for ONE held stock, grouped Valuation / Quality / Growth / Technical.
//
// PROPS
//   indicators : the stockscurrentdata row for this symbol (from
//                GET /stockscurrentdata, keyed by symbol). May be undefined
//                before first refresh.
//   onRefresh  : optional () => void, triggers parent refresh for this symbol.
//   refreshing : optional bool, spinner state owned by parent.
//
// DESIGN
//   - No fetching, no state mutation. Parent (Tabs.jsx via stockService) owns
//     the refresh side-effect and re-supplies `indicators`.
//   - Derived-on-read fields (pct_from_52w_*, price_vs_200dma, pct_to_target)
//     are computed here from stored scalars — never persisted.
//   - Missing values render "—" (null is meaningful: not fetched / unavailable),
//     never 0.
// ============================================================================

// ── format helpers ──────────────────────────────────────────────────────────
const isNum = (v) => v != null && Number.isFinite(Number(v));

const fmt = (v, dp = 2) => (isNum(v) ? Number(v).toFixed(dp) : "—");
const fmtPct = (v, dp = 1) => (isNum(v) ? `${Number(v).toFixed(dp)}%` : "—");
const fmtRatioPct = (v, dp = 1) =>
  // Yahoo margins/ROE/growth arrive as fractions (0.1834 -> 18.3%)
  isNum(v) ? `${(Number(v) * 100).toFixed(dp)}%` : "—";
const fmtInt = (v) => (isNum(v) ? Math.round(Number(v)).toLocaleString("en-IN") : "—");
const fmtCr = (v) =>
  isNum(v) ? `₹${Math.round(Number(v) / 1e7).toLocaleString("en-IN")} Cr` : "—";
const fmtINR = (v) => (isNum(v) ? `₹${Number(v).toFixed(2)}` : "—");

const trendIcon = (t) => {
  if (t === "up") return <FaArrowUp className="text-green-500" title="Improving" />;
  if (t === "down") return <FaArrowDown className="text-red-500" title="Deteriorating" />;
  if (t === "flat") return <FaArrowRight className="text-(--text-muted)" title="Flat" />;
  return <span className="text-(--text-muted)">—</span>;
};

const signClass = (v) =>
  !isNum(v) ? "" : Number(v) > 0 ? "text-green-500" : Number(v) < 0 ? "text-red-500" : "";

const freshness = (iso) => {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA");
};

// ── small building blocks ────────────────────────────────────────────────────
const Cell = ({ label, children, hint }) => (
  <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded-md bg-(--bg)">
    <span className="text-[10px] uppercase tracking-wide text-(--text-muted)" title={hint}>
      {label}
    </span>
    <span className="text-sm font-medium text-(--text)">{children}</span>
  </div>
);

const Group = ({ title, children }) => (
  <div className="mb-3">
    <h5 className="text-xs font-semibold text-(--text-strong) mb-1.5">{title}</h5>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
      {children}
    </div>
  </div>
);

// ============================================================================
const StockIndicatorsTable = ({ indicators, onRefresh, refreshing = false }) => {
  const d = indicators || {};

  // ── derived-on-read (not stored) ──────────────────────────────────────────
  const price = isNum(d.current_price) ? Number(d.current_price) : null;

  const pctFrom52High =
    price != null && isNum(d.week52_high) && Number(d.week52_high) > 0
      ? ((price - d.week52_high) / d.week52_high) * 100
      : null;
  const pctFrom52Low =
    price != null && isNum(d.week52_low) && Number(d.week52_low) > 0
      ? ((price - d.week52_low) / d.week52_low) * 100
      : null;
  const priceVs200 =
    price != null && isNum(d.dma_200)
      ? price >= Number(d.dma_200)
        ? "Above"
        : "Below"
      : null;
  const pctToTarget =
    price != null && isNum(d.analyst_target) && price > 0
      ? ((d.analyst_target - price) / price) * 100
      : null;

  const hasAny =
    indicators &&
    (d.fundamentals_updated_at || d.technicals_updated_at || price != null);

  return (
    <div className="border border-(--border-light) rounded-lg bg-(--card-light) p-3">
      {/* header + refresh */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex flex-col">
          <h4 className="text-(--text) font-semibold text-sm">Indicators</h4>
          <span className="text-[10px] text-(--text-muted) italic">
            Fundamentals: {freshness(d.fundamentals_updated_at)} · Technicals:{" "}
            {freshness(d.technicals_updated_at)}
          </span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md
              bg-(--order-save-bg) text-white hover:bg-(--order-save-bg-hover)
              transition-colors ${refreshing ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <FaSyncAlt className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {!hasAny ? (
        <p className="text-center text-(--text-muted) py-6 text-sm italic">
          No indicator data yet. Click “Refresh” to fetch valuation, quality,
          growth and technical metrics for this stock.
        </p>
      ) : (
        <>
          {/* VALUATION */}
          <Group title="Valuation">
            <Cell label="P/E" hint="Trailing P/E">{fmt(d.pe_ratio)}</Cell>
            <Cell label="Fwd P/E">{fmt(d.forward_pe)}</Cell>
            <Cell label="P/B">{fmt(d.pb_ratio)}</Cell>
            <Cell label="PEG">{fmt(d.peg_ratio)}</Cell>
            <Cell label="Mkt Cap">{fmtCr(d.market_cap)}</Cell>
            <Cell label="Cap Tier">{d.market_cap_category || "—"}</Cell>
          </Group>

          {/* QUALITY */}
          <Group title="Quality">
            <Cell label="ROE">{fmtRatioPct(d.roe)}</Cell>
            <Cell label="D/E" hint="Debt to Equity">{fmt(d.debt_to_equity)}</Cell>
            <Cell label="Op. Margin">
              <span className="inline-flex items-center gap-1">
                {fmtRatioPct(d.operating_margin)} {trendIcon(d.margin_trend)}
              </span>
            </Cell>
            <Cell label="Net Margin">{fmtRatioPct(d.profit_margin)}</Cell>
            <Cell label="EPS (TTM)">{fmt(d.eps_ttm)}</Cell>
          </Group>

          {/* GROWTH */}
          <Group title="Growth (YoY)">
            <Cell label="Revenue">{fmtRatioPct(d.revenue_growth_yoy)}</Cell>
            <Cell label="Profit">
              <span className="inline-flex items-center gap-1">
                {fmtRatioPct(d.profit_growth_yoy)} {trendIcon(d.profit_growth_trend)}
              </span>
            </Cell>
          </Group>

          {/* TECHNICAL */}
          <Group title="Technical">
            <Cell label="Price">{fmtINR(d.current_price)}</Cell>
            <Cell label="Day Δ">
              <span className={signClass(d.day_change_pct)}>{fmtPct(d.day_change_pct, 2)}</span>
            </Cell>
            <Cell label="52W High">{fmt(d.week52_high)}</Cell>
            <Cell label="52W Low">{fmt(d.week52_low)}</Cell>
            <Cell label="↓ from 52WH" hint="% below 52-week high">
              <span className={signClass(pctFrom52High)}>{fmtPct(pctFrom52High)}</span>
            </Cell>
            <Cell label="↑ from 52WL" hint="% above 52-week low">
              <span className={signClass(pctFrom52Low)}>{fmtPct(pctFrom52Low)}</span>
            </Cell>
            <Cell label="50 DMA">{fmt(d.dma_50)}</Cell>
            <Cell label="200 DMA">
              <span className="inline-flex items-center gap-1">
                {fmt(d.dma_200)}
                {priceVs200 && (
                  <span
                    className={priceVs200 === "Above" ? "text-green-500" : "text-red-500"}
                    title={`Price is ${priceVs200} 200 DMA`}
                  >
                    ({priceVs200})
                  </span>
                )}
              </span>
            </Cell>
            <Cell label="RSI-14" hint=">70 overbought · <30 oversold">
              <span
                className={
                  isNum(d.rsi_14)
                    ? Number(d.rsi_14) >= 70
                      ? "text-red-500"
                      : Number(d.rsi_14) <= 30
                      ? "text-green-500"
                      : ""
                    : ""
                }
              >
                {fmt(d.rsi_14, 1)}
              </span>
            </Cell>
            <Cell label="Beta">{fmt(d.beta)}</Cell>
            <Cell label="Avg Vol">{fmtInt(d.avg_volume)}</Cell>
            <Cell label="Target" hint={d.analyst_target_manual ? "Manual" : "Auto (Yahoo)"}>
              {fmtINR(d.analyst_target)}
            </Cell>
            <Cell label="To Target" hint="% upside to analyst target">
              <span className={signClass(pctToTarget)}>{fmtPct(pctToTarget)}</span>
            </Cell>
          </Group>
        </>
      )}
    </div>
  );
};

export default StockIndicatorsTable;
