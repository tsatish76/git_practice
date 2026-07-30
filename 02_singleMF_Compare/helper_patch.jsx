// Replace the existing buildFundComparisonSeriesWithCashFlow function in
// src/components/mutualFunds/HelperFunctions.jsx with this implementation.
//
// Behavior:
//   1 selected fund  -> actual NAV series.
//   2+ selected funds -> normalized base-100 common-date comparison.
// Cash-flow metadata is attached in both modes for BUY/SELL markers.
export const buildFundComparisonSeriesWithCashFlow = (
  selectedSymbols,
  mfNavHistory,
  mfOrders
) => {
  if (!Array.isArray(selectedSymbols) || selectedSymbols.length === 0) return [];

  const historyMaps = {};

  selectedSymbols.forEach((symbol) => {
    const entry = (mfNavHistory || []).find((item) => item.symbol === symbol);
    if (!entry || !Array.isArray(entry.history)) return;

    const map = new Map();
    entry.history.forEach((row) => {
      const date = normalizeDateStr(row.date);
      const nav = Number(row.nav);
      if (date && Number.isFinite(nav)) map.set(date, nav);
    });
    historyMaps[symbol] = map;
  });

  const validSymbols = selectedSymbols.filter(
    (symbol) => historyMaps[symbol]?.size > 0
  );

  // Do not silently render a partial selection if any selected fund lacks NAV data.
  if (validSymbols.length !== selectedSymbols.length) return [];

  // Numeric signed cash flow keeps the existing MF chart convention:
  // BUY = positive, SELL = negative.
  const cashFlowMap = {};
  validSymbols.forEach((symbol) => {
    cashFlowMap[symbol] = {};
  });

  (mfOrders || []).forEach((order) => {
    const symbol = order.symbol;
    if (!validSymbols.includes(symbol)) return;

    const date = normalizeDateStr(order.date);
    const quantity = Number(order.quantity) || 0;
    const nav = Number(order.nav) || 0;
    if (!date || quantity <= 0 || nav <= 0) return;

    const amount = quantity * nav;
    const signedAmount = order.order_type === "SELL" ? -amount : amount;

    cashFlowMap[symbol][date] =
      (cashFlowMap[symbol][date] || 0) + signedAmount;
  });

  // Single fund: actual historical NAV, not normalized.
  if (validSymbols.length === 1) {
    const symbol = validSymbols[0];

    return [...historyMaps[symbol].entries()]
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, nav]) => {
        const point = {
          date,
          [symbol]: nav,
          cashFlows: {},
        };

        if (cashFlowMap[symbol][date]) {
          point.cashFlows[symbol] = cashFlowMap[symbol][date];
        }

        return point;
      });
  }

  // Multiple funds: retain base-100 comparison over common NAV dates.
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
      const nav = historyMaps[symbol].get(date);
      point[symbol] =
        baseValues[symbol] > 0
          ? Number(((nav / baseValues[symbol]) * 100).toFixed(4))
          : null;

      if (cashFlowMap[symbol][date]) {
        point.cashFlows[symbol] = cashFlowMap[symbol][date];
      }
    });

    return point;
  });
};
