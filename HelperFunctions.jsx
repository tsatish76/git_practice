// --------------------------------------------------------------
import React from "react";
// ============================================================================
// These mirror the MF versions (buildFundReturnsMatrix, buildFundComparisonSeries)
// but adapted for stock price_history (close price instead of NAV) and stock
// order shape (price instead of nav).
//
// For each held stock, computes 1D/1W/1M/6M/1Y absolute returns, 3Y/5Y CAGR,
// and per-stock XIRR (transactions only — rate computed in the UI layer).
//
// ASSUMPTIONS:
//   - priceHistory: [{ symbol, history: [{date, close}] }]
//   - stocks: ALL orders (BUY + SELL) — filtered per symbol internally
//   - stockTradeAllocations: not directly used here (cash flows come from
//     the stock's own orders, same pattern as MF per-fund XIRR)
//   - holdingStocks: array of { symbol, name, quantity (remaining), ... }
//     — only stocks with remainingQty > 0 should be passed in, since
//     price_history is typically only kept fresh for held positions.
//   - Missing periods (insufficient history) → null, shown as "—" in UI.
// ============================================================================
export const buildStockReturnsMatrix = (
  holdingStocks, priceHistory, stocks, stockTradeAllocations
) => {
  const priceMapBySymbol = {};
  (priceHistory || []).forEach(entry => {
    if (!entry.symbol || !Array.isArray(entry.history)) return;
    const sorted = [...entry.history]
      .map(r => ({ date: r.date, close: Number(r.close) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    priceMapBySymbol[entry.symbol] = sorted;
  });
  const findPriceNDaysAgo = (sortedHistory, latestDate, daysAgo) => {
    if (!sortedHistory?.length) return null;
    const target = new Date(latestDate);
    target.setDate(target.getDate() - daysAgo);
    const targetStr = target.toISOString().split("T")[0];
    let found = null;
    for (let i = sortedHistory.length - 1; i >= 0; i--) {
      if (sortedHistory[i].date <= targetStr) {
        found = sortedHistory[i];
        break;
      }
    }
    if (!found) return null;
    // Stocks trade daily (unlike MF NAV which skips weekends only) —
    // allow slightly more slack (15 days) to tolerate longer gaps in
    // sparse/illiquid stock price history.
    const gap = (new Date(targetStr) - new Date(found.date)) / 86400000;
    if (gap > 15) return null;
    return found.close;
  };
  return holdingStocks.map(stock => {
    const history = priceMapBySymbol[stock.symbol];
    if (!history || history.length === 0) {
      return { ...stock, returns: {}, xirr: null };
    }
    const latest      = history[history.length - 1];
    const latestPrice = latest.close;
    const latestDate  = latest.date;
    const periods     = { "1D": 1, "1W": 7, "1M": 30, "6M": 182, "1Y": 365 };
    const cagrPeriods = { "3Y": 3, "5Y": 5 };
    const returns = {};
    Object.entries(periods).forEach(([label, days]) => {
      const pastPrice = findPriceNDaysAgo(history, latestDate, days);
      returns[label] = pastPrice != null && pastPrice > 0
        ? parseFloat((((latestPrice - pastPrice) / pastPrice) * 100).toFixed(2))
        : null;
    });
    Object.entries(cagrPeriods).forEach(([label, years]) => {
      const pastPrice = findPriceNDaysAgo(history, latestDate, years * 365);
      if (pastPrice != null && pastPrice > 0) {
        const cagr = (Math.pow(latestPrice / pastPrice, 1 / years) - 1) * 100;
        returns[label] = parseFloat(cagr.toFixed(2));
      } else {
        returns[label] = null;
      }
    });
    const stockOrders = (stocks || []).filter(o => o.symbol === stock.symbol);
    const currentValue = latestPrice * (parseFloat(stock.quantity) || 0);
    // FIX #4 — anchor the terminal (current-value) cash flow to the price date
    // the currentValue was valued at (latestDate), NOT wall-clock time.
    const xirrTx = buildPerStockXIRRTransactions(stockOrders, currentValue, latestDate);
    return { ...stock, returns, xirr: xirrTx, currentPrice: latestPrice, priceDate: latestDate };
  });
};
// ============================================================================
// ============================================================================
// buildPerStockXIRRTransactions
//
// Builds XIRR cash flow transactions for a SINGLE stock's orders.
// Sign: BUY = investor pays (negative), SELL = investor receives (positive),
// current value = positive terminal inflow. Returns raw transactions —
// the UI layer (StockReturnsTable.jsx) calls xirr() on them, keeping the
// `xirr` package dependency out of this helpers file.
// ============================================================================
export const buildPerStockXIRRTransactions = (stockOrders, currentValue, asOfDate) => {
  if (!stockOrders?.length || currentValue <= 0) return null;
  const tx = stockOrders
    .filter(o => o.date && o.price && o.quantity)
    .map(o => {
      const amount = (parseFloat(o.price) || 0) * (parseFloat(o.quantity) || 0);
      return {
        amount: o.order_type === "BUY" ? -amount : amount,
        when: new Date(o.date),
      };
    });
  if (!tx.length) return null;
  // FIX #4 — Deterministic terminal date.
  // Previously the terminal inflow was dated by stockOrders[last].date, which
  // (a) assumes the array is date-sorted and (b) mis-dates the current value,
  // which is valued as of asOfDate (the latest price date). An earlier variant
  // used new Date() (wall-clock) → non-reproducible XIRR across runs.
  // Anchor to asOfDate; fall back to the MAX order date (not array position);
  // never let the terminal precede the last cash flow (keeps XIRR solvable).
  const lastOrderWhen = tx.reduce((mx, t) => (t.when > mx ? t.when : mx), tx[0].when);
  let terminalWhen = asOfDate ? new Date(asOfDate) : null;
  if (!terminalWhen || isNaN(terminalWhen.getTime()) || terminalWhen < lastOrderWhen) {
    terminalWhen = lastOrderWhen;
  }
  tx.push({ amount: currentValue, when: terminalWhen });
  return tx;
};
// ============================================================================
// ============================================================================
// buildStockComparisonSeries
//
// Normalizes 2+ selected stocks to base-100 from their COMMON overlapping
// date range (only dates where ALL selected stocks have a price entry).
//
// ASSUMPTIONS:
//   - selectedSymbols: array of stock symbols to compare (2+).
//   - priceHistory: [{ symbol, history: [{date, close}] }]
//   - If no overlapping range exists, returns [] — UI shows appropriate message.
// ============================================================================
export const buildStockComparisonSeries = (selectedSymbols, priceHistory) => {
  if (!Array.isArray(selectedSymbols) || selectedSymbols.length < 2) return [];
  const historyMaps = {};
  selectedSymbols.forEach(sym => {
    const entry = (priceHistory || []).find(e => e.symbol === sym);
    if (!entry || !Array.isArray(entry.history)) return;
    const map = new Map();
    entry.history.forEach(row => {
      if (row.date && row.close != null) map.set(row.date, Number(row.close));
    });
    historyMaps[sym] = map;
  });
  const validSymbols = selectedSymbols.filter(s => historyMaps[s]?.size > 0);
  if (validSymbols.length < 2) return [];
  const dateSets = validSymbols.map(s => new Set(historyMaps[s].keys()));
  const commonDates = [...dateSets[0]].filter(d =>
    dateSets.every(set => set.has(d))
  ).sort();
  if (!commonDates.length) return [];
  const baseValues = {};
  validSymbols.forEach(sym => {
    baseValues[sym] = historyMaps[sym].get(commonDates[0]);
  });
  return commonDates.map(date => {
    const point = { date };
    validSymbols.forEach(sym => {
      const price = historyMaps[sym].get(date);
      point[sym] = baseValues[sym] > 0
        ? parseFloat(((price / baseValues[sym]) * 100).toFixed(4))
        : null;
    });
    return point;
  });
};
// ============================================================================
// ============================================================================
function getLastMarketDay() {
  const ist = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  if (ist.getHours() < 16) {
    ist.setDate(ist.getDate() - 1);
  }
  return ist.toLocaleDateString("en-CA");
}
// ---------------------------------------------------
/**
 * Normalises any date value (string or Date object) to YYYY-MM-DD.
 * Returns null for invalid or missing input.
 */
function normalizeDateStr(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const p = new Date(t);
    return isNaN(p.getTime()) ? null : p.toISOString().split("T")[0];
  }
  const p = new Date(value);
  return isNaN(p.getTime()) ? null : p.toISOString().split("T")[0];
}
// ============================================================================
// ============================================================================
export const computeMissingPriceRanges = (stocks, priceHistory,
  stockTradeAllocations = []) => {
  const lastMarketDay = getLastMarketDay();
  // -------------------------
  // 1️⃣ Earliest trade per symbol
  // -------------------------
  // Only symbols still held (remaining BUY qty > 0). Fully-exited positions are
  // skipped so price_history doesn't grow for stocks the app no longer shows.
  const heldSymbols = new Set(
    getHoldingOrders(stocks, stockTradeAllocations).map(h => h.symbol)
  );
  // 1️⃣ Earliest trade per HELD symbol
  const tradeMap = {};
  stocks.forEach(trade => {
    if (!heldSymbols.has(trade.symbol)) return;   // ⬅ skip exited positions
    const symbol = trade.symbol;
    const date = trade.date;
    if (!tradeMap[symbol] || date < tradeMap[symbol]) {
      tradeMap[symbol] = date;
    }
  });
  // -------------------------
  // 2️⃣ Price history bounds
  // -------------------------
  const priceBounds = {};
  priceHistory.forEach(stock => {
    const symbol = stock.symbol;
    if (!Array.isArray(stock.history) || stock.history.length === 0) return;
    let min = null;
    let max = null;
    stock.history.forEach(row => {
      if (!row.date) return;
      if (!min || row.date < min) min = row.date;
      if (!max || row.date > max) max = row.date;
    });
    priceBounds[symbol] = { min, max };
  });
  // -------------------------
  // 3️⃣ Compute missing ranges
  // -------------------------
  const ranges = [];
  Object.entries(tradeMap).forEach(([symbol, tradeStart]) => {
    const bounds = priceBounds[symbol];
    // NEW SYMBOL
    if (!bounds) {
      ranges.push({
        symbol,
        from: tradeStart,
        to: lastMarketDay
      });
      return;
    }
    const { min, max } = bounds;
    // Missing before history
    if (tradeStart < min) {
      const beforeEnd = new Date(min);
      beforeEnd.setDate(beforeEnd.getDate() - 1);
      ranges.push({
        symbol,
        from: tradeStart,
        to: beforeEnd.toISOString().slice(0,10)
      });
    }
    // Missing after history
    const afterStart = new Date(max);
    afterStart.setDate(afterStart.getDate() + 1);
    const afterStr = afterStart.toISOString().slice(0,10);
    if (afterStr <= lastMarketDay) {
      ranges.push({
        symbol,
        from: afterStr,
        to: lastMarketDay
      });
    }
  });
  return ranges;
}
// ============================================================================
// ============================================================================
// Similar logic for indices, but based on global earliest trade date
export const computeMissingIndexRanges = (stocks, indexHistory) => {
  const lastMarketDay = getLastMarketDay();
  // -------------------------
  // 1️⃣ Global earliest trade date
  // (indices have no trades — window starts from portfolio inception)
  // -------------------------
  let globalStart = null;
  stocks.forEach(trade => {
    if (!globalStart || trade.date < globalStart) {
      globalStart = trade.date;
    }
  });
  if (!globalStart) return []; // no trades at all, nothing to fetch
  // -------------------------
  // 2️⃣ Price bounds per index
  // -------------------------
  const ranges = [];
  Object.entries(indexHistory).forEach(([symbol, history]) => {
    // NEW INDEX — no history at all
    if (!Array.isArray(history) || history.length === 0) {
      ranges.push({ symbol, from: globalStart, to: lastMarketDay });
      return;
    }
    let min = null;
    let max = null;
    history.forEach(row => {
      if (!row.date) return;
      if (!min || row.date < min) min = row.date;
      if (!max || row.date > max) max = row.date;
    });
    // -------------------------
    // 3️⃣ Missing before history
    // -------------------------
    if (globalStart < min) {
      const beforeEnd = new Date(min);
      beforeEnd.setDate(beforeEnd.getDate() - 1);
      ranges.push({
        symbol,
        from: globalStart,
        to: beforeEnd.toISOString().slice(0, 10)
      });
    }
    // -------------------------
    // 4️⃣ Missing after history
    // -------------------------
    const afterStart = new Date(max);
    afterStart.setDate(afterStart.getDate() + 1);
    const afterStr = afterStart.toISOString().slice(0, 10);
    if (afterStr <= lastMarketDay) {
      ranges.push({
        symbol,
        from: afterStr,
        to: lastMarketDay
      });
    }
  });
  return ranges;
};
// ============================================================================
// ============================================================================
// Function to get the latest price for each stock symbol from price history
// This allows O(1) access to the latest price when rendering the table,
// instead of O(n) search through priceHistory.
export const setLatestPriceMap = (priceHistory) => {
  const map = {};
  if (!Array.isArray(priceHistory)) return map;
  priceHistory.forEach(stock => {
    if (!stock?.symbol || !Array.isArray(stock.history)) return;
    let latest = null;
    for (const row of stock.history) {
      if (!row?.date) continue;
      if (!latest || new Date(row.date) > new Date(latest.date)) {
        latest = row;
      }
    }
    if (latest) {
      map[stock.symbol] = {
        price: Number(latest.close) || 0,
        date: latest.date
      };
    }
  });
  return map;
};
// ============================================================================
// ============================================================================
export const getAllocationMaps = (stockTradeAllocations) => {
  const soldQtyByBuyOrder = {};
  const allocationsBySellOrder = {};
  (Array.isArray(stockTradeAllocations)
    ? stockTradeAllocations
    : [])
    .forEach((allocation) => {
    const buyId = allocation.buy_order_id;
    const sellId = allocation.sell_order_id;
    const qty = parseFloat(allocation.quantity) || 0;
    // Total sold per BUY
    if (!soldQtyByBuyOrder[buyId]) soldQtyByBuyOrder[buyId] = 0;
    soldQtyByBuyOrder[buyId] += qty;
    // Allocation breakdown per SELL
    if (!allocationsBySellOrder[sellId]) {
      allocationsBySellOrder[sellId] = [];
    }
    allocationsBySellOrder[sellId].push(allocation);
  });
  return {
    soldQtyByBuyOrder,
    allocationsBySellOrder,
  };
};
// ============================================================================
// ============================================================================
export const getHoldingOrders = (stocks, stockTradeAllocations) => {
  // 1️⃣ Map total sold qty per buy order
  const { soldQtyByBuyOrder } = getAllocationMaps(stockTradeAllocations);
  // 2️⃣ Filter and calculate remaining BUY lots
  const holdings = stocks
    .filter((trade) => trade.order_type === "BUY")
    .map((trade) => {
      const originalQty = parseFloat(trade.quantity) || 0;
      const soldQty = soldQtyByBuyOrder[trade.id] || 0;
      const remainingQty = Math.max(originalQty - soldQty, 0);
      if (remainingQty <= 0) return null;
      return {
        ...trade,
        quantity: remainingQty,
        investmentvalue: remainingQty * (parseFloat(trade.price) || 0),
      };
    })
    .filter(Boolean); // remove fully sold lots
  // sort by date (oldest first)
  holdings.sort((a, b) => new Date(a.date) - new Date(b.date));
  return holdings;
};
// ============================================================================
// ============================================================================
export const normalizeIndexSeries = (series) => {
  if (!series.length) return [];
  const base = series[0].close;
  return series.map(p => ({
    date: p.date,
    value: (p.close / base) * 100
  }))
};
// ============================================================================
// ============================================================================
export const normalizePortfolioSeries = (series) => {
  if (!series.length) return [];
  const base = series[0].value;
  return series.map(p => ({
    date: p.date,
    value: (p.value / base) * 100
  }))
}
// ============================================================================
// ============================================================================
// ---------------------------------------------------------------------------
// buildStockPortfolioSeries
// ---------------------------------------------------------------------------
/**
 * Builds a daily portfolio value time-series for the stock portfolio.
 * Mirrors buildMFPortfolioSeries exactly in methodology:
 *   - Date spine from union of all dates in priceHistory (stock price history)
 *   - Cash-flow-adjusted gain/returnPct (market return only)
 *   - cashFlow uses XIRR sign convention (BUY = negative, SELL = positive)
 *   - value = true PV including cash flow effects (line shows jumps on trades)
 *
 * ASSUMPTIONS:
 *   - stocks: all BUY + SELL orders from the stocks table (order_type field)
 *   - stockTradeAllocations: links SELL → BUY lots (for unit accounting)
 *   - priceHistory: [{ symbol, history: [{date, close}] }]
 *   - investmentvalue on each order = quantity × price (already stored on order)
 *   - cashFlow amount = qty × price (order price, not history price) for accuracy
 *
 * @param {Array} stocks               - All stock orders (BUY + SELL)
 * @param {Array} stockTradeAllocations - Allocation rows for sell-buy linking
 * @param {Array} priceHistory         - [{ symbol, history:[{date, close}] }]
 * @returns {Array<{ date, value, gain, returnPct, cashFlow }>}
 */
export const buildStockPortfolioSeries = (stocks, stockTradeAllocations, priceHistory) => {
  if (!Array.isArray(stocks)        || stocks.length === 0)        return [];
  if (!Array.isArray(priceHistory)  || priceHistory.length === 0)  return [];
  // ── 1. Build price maps + date spine ──────────────────────────────────────
  const priceMaps   = {};      // symbol → Map<date, close>
  const allDatesSet = new Set();
  priceHistory.forEach((entry) => {
    const sym = entry.symbol;
    if (!sym || !Array.isArray(entry.history)) return;
    const map = new Map();
    entry.history.forEach((row) => {
      const d = normalizeDateStr(row.date);
      if (d && row.close != null) {
        map.set(d, Number(row.close));
        allDatesSet.add(d);
      }
    });
    priceMaps[sym] = map;
  });
  const allDates = [...allDatesSet].sort();
  if (!allDates.length) return [];
  // ── 2. Sold qty map from allocations (for remaining unit tracking) ──────────
  const soldQtyByBuyOrder = {};
  (Array.isArray(stockTradeAllocations) ? stockTradeAllocations : []).forEach(a => {
    const qty = parseFloat(a.quantity) || 0;
    soldQtyByBuyOrder[a.buy_order_id] = (soldQtyByBuyOrder[a.buy_order_id] || 0) + qty;
  });
  // ── 3. Sorted trade list per symbol ────────────────────────────────────────
  const tradesBySymbol = {};
  stocks.forEach((o) => {
    const sym  = o.symbol;
    const date = normalizeDateStr(o.date);
    const qty  = (o.order_type === "BUY" ? 1 : -1) * (parseFloat(o.quantity) || 0);
    if (!sym || !date || qty === 0) return;
    if (!tradesBySymbol[sym]) tradesBySymbol[sym] = [];
    tradesBySymbol[sym].push({
      date,
      qty,
      order_type: o.order_type,
      orderPrice: parseFloat(o.price) || 0,
    });
  });
  Object.values(tradesBySymbol).forEach(arr =>
    arr.sort((a, b) => (a.date < b.date ? -1 : 1))
  );
  // ── 3. Walk the date spine ─────────────────────────────────────────────────
  const allSymbols = new Set([
    ...Object.keys(priceMaps),
    ...Object.keys(tradesBySymbol),
  ]);
  const holdings   = {};   // symbol → current shares held
  const tradeIdx   = {};   // symbol → next unprocessed trade index
  const lastPrice  = {};   // symbol → last seen close (carry-forward)
  const dailySeries = [];
  let truePrevPV = null;
  allDates.forEach((date) => {
    let totalValue    = 0;
    const todayTrades = [];
    allSymbols.forEach((sym) => {
      if (holdings[sym] === undefined) holdings[sym] = 0;
      if (tradeIdx[sym]  === undefined) tradeIdx[sym]  = 0;
      const trades = tradesBySymbol[sym] || [];
      while (tradeIdx[sym] < trades.length && trades[tradeIdx[sym]].date <= date) {
        const t = trades[tradeIdx[sym]];
        holdings[sym] += t.qty;
        if (t.date === date) {
          todayTrades.push({
            sym,
            qty:        Math.abs(t.qty),
            order_type: t.order_type,
            orderPrice: t.orderPrice,
          });
        }
        tradeIdx[sym]++;
      }
      const todayPrice = priceMaps[sym]?.get(date);
      if (todayPrice !== undefined) totalValue += Math.max(holdings[sym], 0) * todayPrice;
    });
    const trueTodayPV = Math.round(totalValue);
    // ── Market-only daily gain and return ────────────────────────────────────
    let gain      = 0;
    let returnPct = 0;
    if (truePrevPV !== null) {
      if (todayTrades.length === 0) {
        gain      = trueTodayPV - truePrevPV;
        returnPct = truePrevPV > 0 ? (gain / truePrevPV) * 100 : 0;
      } else {
        // FIX #2 — Sell-day double-subtract corrected.
        // holdings[] is ALREADY net of today's SELL before valuation, so the sold
        // shares are NOT part of trueTodayPV. The continuing (held-through) value
        // today therefore only needs today's BUY removed (bought at close, no market
        // move yet). The previous code subtracted the sold shares a SECOND time
        // (sellAdjT), producing a large spurious loss on every sell day.
        //   continuingT  = trueTodayPV - buyAdjT                 (today's value of held-through shares)
        //   continuingT1 = truePrevPV  - sellAdjT1               (yesterday's value of held-through shares)
        // sellAdjT (today-priced sold shares) is no longer needed and was removed.
        let sellAdjT1 = 0;   // yesterday value of shares sold today
        let buyAdjT   = 0;   // today value of shares bought today
        todayTrades.forEach(({ sym, qty, order_type }) => {
          const priceT = priceMaps[sym]?.get(date) ?? 0;
          if (order_type === "SELL") {
            let priceT1 = 0;
            const idx = allDates.indexOf(date);
            for (let i = idx - 1; i >= 0; i--) {
              const v = priceMaps[sym]?.get(allDates[i]);
              if (v !== undefined) { priceT1 = v; break; }
            }
            sellAdjT1 += qty * priceT1;
          } else {
            buyAdjT += qty * priceT;
          }
        });
        const continuingT  = trueTodayPV - buyAdjT;
        const continuingT1 = truePrevPV - sellAdjT1;
        const denom        = continuingT1 > 0 ? continuingT1 : truePrevPV;
        gain      = continuingT - continuingT1;
        returnPct = denom > 0 ? (gain / denom) * 100 : 0;
      }
    }
    // ── Cash flow (XIRR sign convention) ────────────────────────────────────
    let cashFlowToday = 0;
    todayTrades.forEach(({ qty, order_type, orderPrice }) => {
      const amt = qty * orderPrice;
      if (order_type === "BUY")  cashFlowToday -= amt;
      if (order_type === "SELL") cashFlowToday += amt;
    });
    dailySeries.push({
      date,
      value:     trueTodayPV,
      gain:      Math.round(gain),
      returnPct: parseFloat(returnPct.toFixed(4)),
      cashFlow:  parseFloat(cashFlowToday.toFixed(2)),
    });
    truePrevPV = trueTodayPV;
  });
  // ── 5. Strip leading zero-value days ───────────────────────────────────────
  const firstNonZero = dailySeries.findIndex(d => d.value > 0);
  return firstNonZero === -1 ? [] : dailySeries.slice(firstNonZero);
};
// ============================================================================
// ============================================================================
// buildStockComparisonSeriesWithCashFlow
// Same idea as buildFundComparisonSeriesWithCashFlow, for stocks — uses
// `price` field instead of `nav`. Comparison normalization uses price only;
// cash flow is attached as metadata for BUY/SELL dot rendering per stock line.
// ============================================================================
export const buildStockComparisonSeriesWithCashFlow = (selectedSymbols, priceHistory, stockOrders) => {
  if (!Array.isArray(selectedSymbols) || selectedSymbols.length < 2) return [];
  const historyMaps = {};
  selectedSymbols.forEach(sym => {
    const entry = (priceHistory || []).find(e => e.symbol === sym);
    if (!entry || !Array.isArray(entry.history)) return;
    const map = new Map();
    entry.history.forEach(row => {
      if (row.date && row.close != null) map.set(row.date, Number(row.close));
    });
    historyMaps[sym] = map;
  });
  const validSymbols = selectedSymbols.filter(s => historyMaps[s]?.size > 0);
  if (validSymbols.length < 2) return [];
  const dateSets = validSymbols.map(s => new Set(historyMaps[s].keys()));
  const commonDates = [...dateSets[0]].filter(d =>
    dateSets.every(set => set.has(d))
  ).sort();
  if (!commonDates.length) return [];
  const baseValues = {};
  validSymbols.forEach(sym => {
    baseValues[sym] = historyMaps[sym].get(commonDates[0]);
  });
  const cashFlowMap = {};
  validSymbols.forEach(sym => { cashFlowMap[sym] = {}; });
  (stockOrders || []).forEach(o => {
    const sym = o.symbol;
    if (!validSymbols.includes(sym)) return;
    const date = typeof o.date === "string" ? o.date.split("T")[0] : null;
    if (!date) return;
    const amount = (parseFloat(o.price) || 0) * (parseFloat(o.quantity) || 0);
    const signedAmount = o.order_type === "BUY" ? amount : -amount;
    cashFlowMap[sym][date] = (cashFlowMap[sym][date] || 0) + signedAmount;
  });
  return commonDates.map(date => {
    const point = { date, cashFlows: {} };
    validSymbols.forEach(sym => {
      const price = historyMaps[sym].get(date);
      point[sym] = baseValues[sym] > 0
        ? parseFloat(((price / baseValues[sym]) * 100).toFixed(4))
        : null;
      if (cashFlowMap[sym][date]) {
        point.cashFlows[sym] = cashFlowMap[sym][date];
      }
    });
    return point;
  });
};
// ============================================================================
export default {
  computeMissingPriceRanges, computeMissingIndexRanges, setLatestPriceMap,
  getAllocationMaps, getHoldingOrders, normalizeIndexSeries,
  normalizePortfolioSeries,
  buildStockPortfolioSeries, buildStockReturnsMatrix,
  buildPerStockXIRRTransactions, buildStockComparisonSeries,
  buildStockComparisonSeriesWithCashFlow,
 };
