// ============================================================================
// StockComparisonChart.jsx
//
// Selection behavior:
//   1 stock  -> actual historical stock price with BUY/SELL cash-flow markers.
//   2-6      -> normalized base-100 comparison over the common date range,
//               with BUY/SELL cash-flow markers.
// ============================================================================
import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import {
  FaChartLine,
  FaChevronDown,
  FaChevronUp,
  FaSearch,
  FaTimes,
} from "react-icons/fa";
import helpers from "./HelperFunctions";

const LINE_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#16a34a",
  "#dc2626",
  "#a855f7",
  "#0891b2",
];
const MAX_SELECTION = 6;

const formatINR = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;

const StockComparisonChart = ({
  holdingStocks = [],
  priceHistory = [],
  stocks = [],
}) => {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchResults = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return holdingStocks
      .filter((stock) => !selected.includes(stock.symbol))
      .filter(
        (stock) =>
          !query ||
          (stock.fullname || stock.name || "").toLowerCase().includes(query) ||
          stock.symbol.toLowerCase().includes(query)
      );
  }, [holdingStocks, selected, searchTerm]);

  const addStock = (symbol) => {
    if (selected.length >= MAX_SELECTION) return;
    setSelected((previous) => [...previous, symbol]);
    setSearchTerm("");
    setShowDropdown(false);
  };

  const removeStock = (symbol) => {
    setSelected((previous) => previous.filter((item) => item !== symbol));
  };

  const comparisonData = useMemo(() => {
    if (selected.length === 0) return [];
    return helpers.buildStockComparisonSeriesWithCashFlow(
      selected,
      priceHistory,
      stocks
    );
  }, [selected, priceHistory, stocks]);

  const selectedMeta = useMemo(
    () =>
      selected
        .map((symbol) => holdingStocks.find((stock) => stock.symbol === symbol))
        .filter(Boolean),
    [selected, holdingStocks]
  );

  const isSingleStock = selected.length === 1;

  const cashFlowEvents = useMemo(() => {
    if (!comparisonData.length) return [];
    const events = [];
    comparisonData.forEach((point) => {
      selected.forEach((symbol, index) => {
        const event = point.cashFlows?.[symbol];
        if (!event) return;
        events.push({
          symbol,
          date: point.date,
          value: point[symbol],
          amount: event.amount,
          type: event.type,
          color: LINE_COLORS[index],
        });
      });
    });
    return events;
  }, [comparisonData, selected]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const displayDate = new Date(label).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const point = payload[0]?.payload;

    return (
      <div className="bg-(--card) border border-(--border-light) rounded-xl shadow-xl p-3 text-xs min-w-45">
        <p className="font-semibold text-(--text) mb-2 border-b border-(--border-light) pb-1">
          {displayDate}
        </p>
        {payload.map((entry) => {
          const meta = selectedMeta.find(
            (stock) => stock.symbol === entry.dataKey
          );
          const event = point?.cashFlows?.[entry.dataKey];
          return (
            <div key={entry.dataKey} className="mb-2 last:mb-0">
              <div className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5 text-(--text-muted)">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ background: entry.color }}
                  />
                  {meta?.fullname || meta?.name || entry.dataKey}
                </span>
                <span className="font-semibold" style={{ color: entry.color }}>
                  {isSingleStock
                    ? formatINR(entry.value)
                    : Number(entry.value).toFixed(2)}
                </span>
              </div>
              {event && (
                <div
                  className={`mt-1 font-medium ${
                    event.type === "BUY" ? "text-(--gain)" : "text-(--loss)"
                  }`}
                >
                  {event.type}: {formatINR(event.amount)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mb-6 w-full max-w-5xl mx-auto">
      <div className="bg-(--card) border border-(--border) rounded-2xl shadow-sm overflow-visible">
        <button
          onClick={() => setExpanded((previous) => !previous)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-(--hover-bg) transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-(--text)">
            <FaChartLine className="text-(--accent)" />
            Compare Stocks
          </span>
          {expanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
        </button>

        {expanded && (
          <div className="px-5 pb-5 border-t border-(--border-light) pt-4">
            <p className="text-xs text-(--text-muted) mb-2">
              Select 1 stock for its actual price history, or 2–6 stocks for a normalized comparison.
            </p>

            <div className="relative mb-3" ref={searchRef}>
              <div className="relative">
                <FaSearch
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
                  size={12}
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder={
                    selected.length >= MAX_SELECTION
                      ? `Max ${MAX_SELECTION} stocks selected`
                      : "Type a stock name or symbol…"
                  }
                  disabled={selected.length >= MAX_SELECTION}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-(--border) bg-(--bg) focus:border-(--accent) focus:ring-1 focus:ring-(--accent) outline-none disabled:opacity-50"
                />
              </div>

              {showDropdown && searchResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-(--card) border border-(--border) rounded-lg shadow-xl max-h-56 overflow-y-auto">
                  {searchResults.map((stock) => (
                    <button
                      key={stock.symbol}
                      onClick={() => addStock(stock.symbol)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-(--hover-bg) transition-colors flex items-center justify-between"
                    >
                      <span className="font-medium text-(--text)">
                        {stock.fullname || stock.name}
                      </span>
                      <span className="text-xs text-(--text-muted)">
                        {stock.symbol}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {selected.map((symbol, index) => {
                  const meta = holdingStocks.find(
                    (stock) => stock.symbol === symbol
                  );
                  return (
                    <span
                      key={symbol}
                      className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 text-xs font-medium rounded-full text-white"
                      style={{ background: LINE_COLORS[index] }}
                    >
                      {meta?.fullname || meta?.name || symbol}
                      <button
                        onClick={() => removeStock(symbol)}
                        className="p-0.5 rounded-full hover:bg-white/20 transition-colors"
                      >
                        <FaTimes size={9} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {selected.length === 0 ? (
              <p className="text-center text-(--text-muted) py-8 text-sm italic">
                Select a stock to view its price history.
              </p>
            ) : comparisonData.length === 0 ? (
              <p className="text-center text-(--text-muted) py-8 text-sm italic">
                {isSingleStock
                  ? "No price history is available for this stock."
                  : "These stocks have no overlapping price-history date range."}
              </p>
            ) : (
              <>
                <p className="text-[10px] text-(--text-muted) mb-2 italic">
                  Showing {comparisonData[0]?.date} → {comparisonData[comparisonData.length - 1]?.date}
                  {isSingleStock
                    ? " (actual historical price; markers show BUY/SELL cash flows)"
                    : " (normalized to 100 at common-range start; markers show BUY/SELL cash flows)"}
                </p>

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={comparisonData}
                      margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                        stroke="var(--text-3)"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                        stroke="var(--text-3)"
                        axisLine={false}
                        tickLine={false}
                        width={isSingleStock ? 72 : 45}
                        tickFormatter={(value) =>
                          isSingleStock
                            ? `₹${Number(value).toLocaleString("en-IN", {
                                maximumFractionDigits: 0,
                              })}`
                            : Number(value).toFixed(0)
                        }
                        domain={isSingleStock ? ["auto", "auto"] : undefined}
                      />
                      <Tooltip content={<CustomTooltip />} />

                      {selected.map((symbol, index) => (
                        <Line
                          key={symbol}
                          type="monotone"
                          dataKey={symbol}
                          stroke={LINE_COLORS[index]}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          connectNulls
                        />
                      ))}

                      {cashFlowEvents.map((event, index) => (
                        <ReferenceDot
                          key={`${event.symbol}-${event.date}-${event.type}-${index}`}
                          x={event.date}
                          y={event.value}
                          r={4}
                          fill={event.type === "BUY" ? "#16a34a" : "#dc2626"}
                          stroke="var(--card)"
                          strokeWidth={1.5}
                          ifOverflow="extendDomain"
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {cashFlowEvents.length > 0 && (
                  <div className="flex gap-4 mt-2 text-[10px] text-(--text-muted)">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-600" /> BUY
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-600" /> SELL
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StockComparisonChart;
