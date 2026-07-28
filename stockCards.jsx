// ----------------------------------------------------------------------------
import React, { useState, useMemo, useRef, useCallback } from "react";
import { FaTrash, FaChartBar, FaSyncAlt, FaDownload, FaListUl } from "react-icons/fa";

import xirr from "xirr";
// ============================================================================
// computeStockXIRR
// Negates cashFlow to convert from portfolio sign to investor (XIRR) sign.
// ============================================================================
const computeStockXIRR = (series, currentValue) => {
  if (!Array.isArray(series) || series.length < 2 || currentValue <= 0) return null;
  try {
    const tx = series
      .filter(r => r.cashFlow && r.cashFlow !== 0)
      .map(r => ({ amount: r.cashFlow, when: new Date(r.date) }));
    if (!tx.length) return null;

    const asOf = series[series.length - 1]?.date;
    tx.push({ amount: currentValue, when: new Date(asOf) });
    const rate = xirr(tx);

    if (!isFinite(rate) || isNaN(rate)) return null;
    return parseFloat((rate * 100).toFixed(2));
  } catch { return null; }
};
// ============================================================================
// StockSummaryCard
//
// Props:
//   summary          – { totalInvested, totalCurrent, totalGain, totalReturns,
//                        numStocks, positive, negative,
//                        todayPositive, todayNegative }
//   portfolioSeries  – [{ date, value, gain, returnPct, cashFlow }]
//   showAllocation   – boolean (controls chart visibility)
//   onToggle         – () => void
// ============================================================================
export const StockSummaryCard = ({ summary,  portfolioSeries = [],
  showAllocation, onToggle, onViewAllOrders
}) => {
  const {
    totalInvested    = 0,
    totalCurrent     = 0,
    totalGain        = 0,
    totalReturns     = 0,
    totalRealizedPnL = 0,
    positive         = 0,
    negative         = 0,
    todayPositive    = 0,
    todayNegative    = 0,
  } = summary ?? {};

  const totalStocks     = positive + negative;
  const totalToday      = todayPositive + todayNegative;

  const lastPoint       = portfolioSeries?.[portfolioSeries.length - 1];
  // Daily move stays series-based (it is inherently day-over-day).
  const dailyGain       = lastPoint?.gain      ?? 0;
  const dailyRetPct     = lastPoint?.returnPct ?? 0;

  // ── FIX: single holdings-based source of truth ──────────────────────────
  // Previously the card mixed pipelines: current value came from the daily
  // portfolioSeries last point while invested came from the holdings-derived
  // `summary`. The two are built independently (different price dates / position
  // sets), so unrealised gain (seriesValue − holdingsInvested) and XIRR (series
  // terminal) diverged from the holdings table below. Derive value, gain, return
  // and the XIRR terminal from `summary`, which reflects the LATEST holdings.
  // Fall back to the series value only when holdings value is unavailable.
  const currentValue    = totalCurrent > 0
    ? totalCurrent
    : (lastPoint?.value ?? 0);
  const unrealisedGain  = totalCurrent > 0
    ? totalGain
    : (currentValue - totalInvested);
  const unrealisedRet   = totalInvested > 0
    ? (unrealisedGain / totalInvested) * 100
    : (totalReturns || 0);
  const realisedPnL     = Number(totalRealizedPnL) || 0;

  // Net invested: -(Σ cashFlow). cashFlow BUY=+ve SELL=-ve → negate for deployed ₹
  const netInvested     = portfolioSeries?.length
    ? -portfolioSeries.reduce((s, r) => s + (r.cashFlow ?? 0), 0)
    : totalInvested;

  // XIRR terminal = current holdings value (not the series last point).
  const xirrVal         = computeStockXIRR(portfolioSeries, currentValue);
  // FIX #8 — gate on calendar-day span, not row count (~250 trading days/yr,
  // so `.length >= 365` silently demanded ~1.5y, contradicting the ≥1Y label).
  const seriesSpanDays  = (portfolioSeries?.length ?? 0) >= 2
    ? (new Date(portfolioSeries[portfolioSeries.length - 1].date)
        - new Date(portfolioSeries[0].date)) / 86_400_000
    : 0;
  const hasXIRR         = xirrVal !== null && seriesSpanDays >= 365;
  const isDailyUp       = dailyGain >= 0;
  const isGain          = unrealisedGain >= 0;
  const isRealisedUp    = realisedPnL >= 0;

  const fmtINR  = v => "₹" + Math.abs(Math.round(v || 0)).toLocaleString("en-IN");
  const gc      = v => v >= 0 ? "text-(--gain)" : "text-(--loss)";
  const gcBg    = v => v >= 0
    ? "bg-(--bubble-gain-bg) border-(--bubble-gain-border)"
    : "bg-(--bubble-loss-bg) border-(--bubble-loss-border)";
  const fmtPct  = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + "%";

  return (
    <div className="mb-4 max-w-5xl mx-auto">
      <div className="rounded-2xl border bg-(--card) border-(--border)
                      overflow-hidden shadow-sm p-5">

        {/* ── Header: value + net invested ────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest
                          text-(--text-muted) mb-1">
              Stock Portfolio Value
            </p>
            <p className="text-4xl font-extrabold text-(--text) leading-none tracking-tight">
              {fmtINR(currentValue)}
            </p>

            {/* TODAY pills */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">

              {/* Daily portfolio move */}
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5
                                text-xs font-semibold rounded-full border ${gcBg(dailyGain)}`}>
                <span className={gc(dailyGain)}>
                  {isDailyUp ? "▲" : "▼"}&nbsp;{fmtINR(dailyGain)}&nbsp;
                  ({fmtPct(dailyRetPct)}) today
                </span>
              </span>

              {/* Stocks up today */}
              {totalToday > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5
                                 text-xs font-semibold rounded-full border
                                 bg-(--bubble-gain-bg)
                                 border-(--bubble-gain-border)">
                  <span className="text-(--gain)">▲ {todayPositive}</span>
                  <span className="text-(--text-muted) font-normal">/{totalToday}</span>
                </span>
              )}

              {/* Stocks down today */}
              {totalToday > 0 && (
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5
                                  text-xs font-semibold rounded-full border
                                  ${todayNegative > 0
                                    ? "bg-(--bubble-loss-bg) border-(--bubble-loss-border)"
                                    : "bg-(--bubble-neutral-bg) border-(--bubble-neutral-border)"}`}>
                  <span className={todayNegative > 0 ? "text-(--loss)" : "text-(--text-muted)"}>
                    ▼ {todayNegative}
                  </span>
                  <span className="text-(--text-muted) font-normal">/{totalToday}</span>
                </span>
              )}
            </div>
          </div>

          {/* Net invested */}
          <div className="text-right self-center">
            <p className="text-[9px] font-bold uppercase tracking-widest
                          text-(--text-muted) mb-0.5">Net Invested</p>
            <p className="text-xl font-bold text-(--text)">{fmtINR(netInvested)}</p>
            <p className="text-[9px] text-(--text-muted) mt-0.5">BUY − SELL at price</p>
          </div>
        </div>

        {/* ── Divider ─────────────────────────────────────────────────── */}
        <div className="border-t border-(--border-light) mx-0 mb-0" />

        {/* ── OVERALL snapshot ────────────────────────────────────────── */}
        <div className="px-5 py-4">
          <p className="text-[9px] font-bold uppercase tracking-widest
                        text-(--text-muted) mb-3">Overall</p>

          {/* Row 1: 4 metric bubbles (Unrealised / Absolute Return / Realised / XIRR) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">

            {/* Unrealised Gain */}
            <div className={`rounded-2xl border px-3 py-2.5 text-center
                             ${isGain
                               ? "bg-(--bubble-gain-bg) border-(--bubble-gain-border)"
                               : "bg-(--bubble-loss-bg) border-(--bubble-loss-border)"}`}>
              <p className="text-[9px] uppercase tracking-widest
                            text-(--text-muted) mb-0.5">Unrealised Gain</p>
              <p className={`text-base font-extrabold leading-tight ${gc(unrealisedGain)}`}>
                {isGain ? "+" : "−"}{fmtINR(unrealisedGain)}
              </p>
              <p className={`text-[9px] font-medium mt-0.5 ${gc(unrealisedGain)}`}>
                {fmtPct(unrealisedRet)}
              </p>
            </div>

            {/* Absolute Return */}
            <div className={`rounded-2xl border px-3 py-2.5 text-center
                             ${isGain
                               ? "bg-(--bubble-gain-bg) border-(--bubble-gain-border)"
                               : "bg-(--bubble-loss-bg) border-(--bubble-loss-border)"}`}>
              <p className="text-[9px] uppercase tracking-widest
                            text-(--text-muted) mb-0.5">Absolute Return</p>
              <p className={`text-base font-extrabold leading-tight ${gc(unrealisedGain)}`}>
                {fmtPct(unrealisedRet)}
              </p>
              <p className="text-[9px] text-(--text-muted) mt-0.5">on holdings</p>
            </div>

            {/* Realised P&L — booked profit/loss from closed lots (ledger-derived) */}
            <div className={`rounded-2xl border px-3 py-2.5 text-center
                             ${isRealisedUp
                               ? "bg-(--bubble-gain-bg) border-(--bubble-gain-border)"
                               : "bg-(--bubble-loss-bg) border-(--bubble-loss-border)"}`}>
              <p className="text-[9px] uppercase tracking-widest
                            text-(--text-muted) mb-0.5">Realised P&amp;L</p>
              <p className={`text-base font-extrabold leading-tight ${gc(realisedPnL)}`}>
                {isRealisedUp ? "+" : "−"}{fmtINR(realisedPnL)}
              </p>
              <p className="text-[9px] text-(--text-muted) mt-0.5">booked</p>
            </div>

            {/* XIRR */}
            {hasXIRR ? (
              <div className="rounded-2xl border px-3 py-2.5 text-center
                              bg-(--bubble-blue-bg) border-(--bubble-blue-border)">
                <p className="text-[9px] uppercase tracking-widest
                              text-blue-400 dark:text-blue-300 mb-0.5">XIRR p.a.</p>
                <p className={`text-base font-extrabold leading-tight ${gc(xirrVal ?? 0)}`}>
                  {fmtPct(xirrVal ?? 0)}
                </p>
                <p className="text-[9px] text-(--text-muted) mt-0.5">annualised</p>
              </div>
            ) : (
              <div className="rounded-2xl border px-3 py-2.5 text-center
                              bg-(--bubble-neutral-bg)
                              border-(--bubble-neutral-border)">
                <p className="text-[9px] uppercase tracking-widest
                              text-blue-400 dark:text-blue-300 mb-0.5">XIRR p.a.</p>
                <p className="text-sm font-semibold text-(--text-muted)">—</p>
                <p className="text-[9px] text-(--text-muted) italic mt-0.5">
                  {xirrVal !== null ? "Needs ≥1Y" : "No data"}
                </p>
              </div>
            )}
          </div>

          {/* Row 2: stock count pills */}
          <div className="flex gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5
                             text-xs font-semibold rounded-full border
                             bg-(--bubble-neutral-bg)
                             border-(--bubble-neutral-border)">
              <span className="text-(--text)">{totalStocks} stocks held</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5
                             text-xs font-semibold rounded-full border
                             bg-(--bubble-gain-bg)
                             border-(--bubble-gain-border)">
              <span className="text-(--gain)">▲ {positive} profit</span>
              <span className="text-(--text-muted) font-normal">/{totalStocks}</span>
            </span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5
                              text-xs font-semibold rounded-full border
                              ${negative > 0
                                ? "bg-(--bubble-loss-bg) border-(--bubble-loss-border)"
                                : "bg-(--bubble-neutral-bg) border-(--bubble-neutral-border)"}`}>
              <span className={negative > 0 ? "text-(--loss)" : "text-(--text-muted)"}>
                ▼ {negative} loss
              </span>
              <span className="text-(--text-muted) font-normal">/{totalStocks}</span>
            </span>
          </div>
        </div>

        {/* ── Toggle ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onToggle}
            className="nav-btn flex items-center gap-2 text-sm px-4 py-1.5 rounded-lg"
          >
            <FaChartBar />
            {showAllocation ? "Hide Charts" : "Show Charts"}
          </button>

          {onViewAllOrders && (
            <button
              onClick={onViewAllOrders}
              className="nav-btn flex items-center gap-2 text-sm px-4 py-1.5 rounded-lg"
            >
              <FaListUl />
              View All Orders
            </button>
          )}

        </div>

      </div>
    </div>
  );
};
// ============================================================================

const stockCards = {
    StockSummaryCard,
    computeStockXIRR
}

export default stockCards;
