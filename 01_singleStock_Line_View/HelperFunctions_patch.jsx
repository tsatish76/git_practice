// Replace the existing buildStockComparisonSeriesWithCashFlow function in
// src/components/stocks/HelperFunctions.jsx with this implementation.
//
// Behavior:
//   1 selected symbol  -> actual close price series.
//   2+ selected symbols -> normalized base-100 common-date comparison.
// Cash-flow metadata is attached in both modes for BUY/SELL markers.
export const buildStockComparisonSeriesWithCashFlow = (
  selectedSymbols,
  priceHistory,
  stockOrders
) => {
  if (!Array.isArray(selectedSymbols) || selectedSymbols.length === 0) return [];

  const historyMaps = {};
  selectedSymbols.forEach((symbol) => {
    const entry = (priceHistory || []).find((item) => item.symbol === symbol);
    if (!entry || !Array.isArray(entry.history)) return;

    const map = new Map();
    entry.history.forEach((row) => {
      const date = normalizeDateStr(row.date);
      const close = Number(row.close);
      if (date && Number.isFinite(close)) map.set(date, close);
    });
    historyMaps[symbol] = map;
  });

  const validSymbols = selectedSymbols.filter(
    (symbol) => historyMaps[symbol]?.size > 0
  );
  if (validSymbols.length !== selectedSymbols.length) return [];

  const cashFlowMap = {};
  validSymbols.forEach((symbol) => {
    cashFlowMap[symbol] = {};
  });

  (stockOrders || []).forEach((order) => {
    const symbol = order.symbol;
    if (!validSymbols.includes(symbol)) return;

    const date = normalizeDateStr(order.date);
    const quantity = Number(order.quantity) || 0;
    const price = Number(order.price) || 0;
    if (!date || quantity <= 0 || price <= 0) return;

    const type = order.order_type === "SELL" ? "SELL" : "BUY";
    const amount = quantity * price;
    const existing = cashFlowMap[symbol][date];

    if (!existing) {
      cashFlowMap[symbol][date] = { type, amount };
    } else if (existing.type === type) {
      existing.amount += amount;
    } else {
      cashFlowMap[symbol][date] = {
        type: "MIXED",
        amount: existing.amount + amount,
      };
    }
  });

  // Single stock: actual historical market price, not normalized.
  if (validSymbols.length === 1) {
    const symbol = validSymbols[0];
    return [...historyMaps[symbol].entries()]
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, close]) => {
        const point = {
          date,
          [symbol]: close,
          cashFlows: {},
        };
        if (cashFlowMap[symbol][date]) {
          point.cashFlows[symbol] = cashFlowMap[symbol][date];
        }
        return point;
      });
  }

  // Multiple stocks: retain the existing base-100 common-date comparison.
  const dateSets = validSymbols.map(
    (symbol) => new Set(historyMaps[symbol].keys())
  );
  const commonDates = [...dateSets[0]]
    .filter((date) => dateSets.every((set) => set.has(date)))
    .sort();
  if (!commonDates.length) return [];

  const baseValues = {};
  validSymbols.forEach((symbol) => {
    baseValues[symbol] = historyMaps[symbol].get(commonDates[0]);
  });

  return commonDates.map((date) => {
    const point = { date, cashFlows: {} };
    validSymbols.forEach((symbol) => {
      const close = historyMaps[symbol].get(date);
      point[symbol] =
        baseValues[symbol] > 0
          ? Number(((close / baseValues[symbol]) * 100).toFixed(4))
          : null;
      if (cashFlowMap[symbol][date]) {
        point.cashFlows[symbol] = cashFlowMap[symbol][date];
      }
    });
    return point;
  });
};
