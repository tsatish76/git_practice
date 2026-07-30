// ============================================================================
// MFFundComparisonChart.jsx
//
// Selection behavior:
//   1 fund  -> actual historical NAV with BUY/SELL cash-flow markers.
//   2-5     -> normalized base-100 comparison over the common NAV date range,
//              with BUY/SELL cash-flow markers.
// ============================================================================
import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  FaChartLine,
  FaChevronDown,
  FaChevronUp,
} from "react-icons/fa";
import helpers from "./HelperFunctions";

const LINE_COLORS = [
  "#4f46e5",
  "#f59e0b",
  "#16a34a",
  "#dc2626",
  "#0ea5e9",
];

const RANGES = ["1W", "1M", "6M", "1Y", "2Y", "5Y", "ALL"];
const RANGE_DAYS = {
  "1W": 7,
  "1M": 30,
  "6M": 182,
  "1Y": 365,
  "2Y": 730,
  "5Y": 1825,
};

const formatINR = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 4,
  })}`;

// Renders a marker only on that fund's own transaction dates.
const CashFlowDot = ({ cx, cy, payload, symbol }) => {
  const flow = payload?.cashFlows?.[symbol];
  if (flow == null || flow === 0) return null;

  const isBuy = flow > 0;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={isBuy ? "#22c55e" : "#f97316"}
      stroke="var(--card)"
      strokeWidth={1.5}
    />
  );
};

const MFFundComparisonChart = ({
  allFunds = [],
  mfNavHistory = [],
  mutualFunds = [],
}) => {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState([]);
  const [range, setRange] = useState("1Y");

  const heldFunds = useMemo(
    () => (allFunds || []).filter((fund) => parseFloat(fund.quantity) > 0),
    [allFunds]
  );

  const toggleFund = (symbol) => {
    setSelected((previous) =>
      previous.includes(symbol)
        ? previous.filter((item) => item !== symbol)
        : previous.length < 5
        ? [...previous, symbol]
        : previous
    );
  };

  const fullComparisonData = useMemo(() => {
    if (selected.length === 0) return [];
    return helpers.buildFundComparisonSeriesWithCashFlow(
      selected,
      mfNavHistory,
      mutualFunds
    );
  }, [selected, mfNavHistory, mutualFunds]);

  const comparisonData = useMemo(() => {
    if (!fullComparisonData.length || range === "ALL") {
      return fullComparisonData;
    }

    const lastDate = new Date(
      fullComparisonData[fullComparisonData.length - 1].date
    );
    const cutoff = new Date(
      lastDate.getTime() - RANGE_DAYS[range] * 86_400_000
    );

    return fullComparisonData.filter(
      (point) => new Date(point.date) >= cutoff
    );
  }, [fullComparisonData, range]);

  const selectedFundMeta = useMemo(
    () =>
      selected
        .map((symbol) => heldFunds.find((fund) => fund.symbol === symbol))
        .filter(Boolean),
    [selected, heldFunds]
  );

  const isSingleFund = selected.length === 1;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;

    const displayDate = new Date(label).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    return (
      <div className="bg-(--card) border border-(--border-light) rounded-xl shadow-xl p-3 text-xs min-w-40">
        <p className="font-semibold text-(--text) mb-2 border-b border-(--border-light) pb-1">
          {displayDate}
        </p>

        {payload.map((entry) => {
          const meta = selectedFundMeta.find(
            (fund) => fund.symbol === entry.dataKey
          );
          const flow = entry.payload?.cashFlows?.[entry.dataKey];

          return (
            <div key={entry.dataKey} className="mb-1.5 last:mb-0">
              <div className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5 text-(--text-muted)">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ background: entry.color }}
                  />
                  {meta?.name || entry.dataKey}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: entry.color }}
                >
                  {isSingleFund
                    ? formatINR(entry.value)
                    : Number(entry.value).toFixed(2)}
                </span>
              </div>

              {flow != null && flow !== 0 && (
                <div className="flex justify-between gap-4 pl-3.5 mt-0.5">
                  <span
                    className={
                      flow > 0 ? "text-green-500" : "text-orange-500"
                    }
                  >
                    {flow > 0 ? "● Bought" : "● Sold"}
                  </span>
                  <span
                    className={
                      flow > 0 ? "text-green-500" : "text-orange-500"
                    }
                  >
                    ₹{Math.abs(Math.round(flow)).toLocaleString("en-IN")}
                  </span>
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
      <div className="bg-(--card) border border-(--border) rounded-2xl shadow-sm overflow-hidden">
        <button
          onClick={() => setExpanded((previous) => !previous)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-(--hover-bg) transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-(--text)">
            <FaChartLine className="text-(--accent)" />
            Compare Funds
          </span>
          {expanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
        </button>

        {expanded && (
          <div className="px-5 pb-5 border-t border-(--border-light) pt-4">
            <p className="text-xs text-(--text-muted) mb-2">
              Select 1 fund for its actual NAV history, or 2–5 funds for a normalized comparison.
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
              {heldFunds.map((fund) => {
                const isSelected = selected.includes(fund.symbol);
                return (
                  <button
                    key={fund.symbol}
                    onClick={() => toggleFund(fund.symbol)}
                    disabled={!isSelected && selected.length >= 5}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all
                      ${
                        isSelected
                          ? "text-white border-transparent"
                          : "bg-(--card-light) border-(--border) text-(--text-muted) hover:border-(--accent)"
                      }
                      ${
                        !isSelected && selected.length >= 5
                          ? "opacity-40 cursor-not-allowed"
                          : ""
                      }`}
                    style={
                      isSelected
                        ? {
                            background:
                              LINE_COLORS[selected.indexOf(fund.symbol)],
                          }
                        : {}
                    }
                  >
                    {fund.name}
                  </button>
                );
              })}
            </div>

            {selected.length >= 1 && fullComparisonData.length > 0 && (
              <div className="flex gap-1 flex-wrap mb-4">
                {RANGES.map((item) => (
                  <button
                    key={item}
                    onClick={() => setRange(item)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors
                      ${
                        range === item
                          ? "bg-(--accent) text-white border-(--accent)"
                          : "bg-(--card) border-(--border) text-(--text-muted) hover:border-(--accent)"
                      }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}

            {selected.length === 0 ? (
              <p className="text-center text-(--text-muted) py-8 text-sm italic">
                Select a fund to view its NAV history.
              </p>
            ) : fullComparisonData.length === 0 ? (
              <p className="text-center text-(--text-muted) py-8 text-sm italic">
                {isSingleFund
                  ? "No NAV history is available for this fund."
                  : "These funds have no overlapping NAV-history date range."}
              </p>
            ) : comparisonData.length === 0 ? (
              <p className="text-center text-(--text-muted) py-8 text-sm italic">
                No NAV history is available in the selected time range.
              </p>
            ) : (
              <>
                <p className="text-[10px] text-(--text-muted) mb-2 italic">
                  Showing {comparisonData[0]?.date} → {comparisonData[comparisonData.length - 1]?.date}
                  {isSingleFund
                    ? " (actual historical NAV; green/orange dots = BUY/SELL)"
                    : " (normalized to 100 at common-range start; green/orange dots = BUY/SELL)"}
                </p>

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={comparisonData}
                      margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
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
                        width={isSingleFund ? 72 : 45}
                        domain={isSingleFund ? ["auto", "auto"] : undefined}
                        tickFormatter={(value) =>
                          isSingleFund
                            ? `₹${Number(value).toLocaleString("en-IN", {
                                maximumFractionDigits: 2,
                              })}`
                            : Number(value).toFixed(0)
                        }
                      />
                      <Tooltip content={<CustomTooltip />} />

                      {selected.map((symbol, index) => (
                        <Line
                          key={symbol}
                          type="monotone"
                          dataKey={symbol}
                          stroke={LINE_COLORS[index]}
                          strokeWidth={2}
                          dot={(props) => (
                            <CashFlowDot
                              key={`${symbol}-${props.payload?.date}`}
                              {...props}
                              symbol={symbol}
                            />
                          )}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex gap-4 flex-wrap mt-3 pt-3 border-t border-(--border-light)">
                  {selected.map((symbol, index) => {
                    const meta = heldFunds.find(
                      (fund) => fund.symbol === symbol
                    );
                    return (
                      <div
                        key={symbol}
                        className="flex items-center gap-1.5 text-xs text-(--text-muted)"
                      >
                        <span
                          className="w-4 h-0.5 inline-block rounded"
                          style={{ background: LINE_COLORS[index] }}
                        />
                        {meta?.name}
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-1.5 text-xs text-(--text-muted)">
                    <span className="w-2 h-2 rounded-full inline-block bg-green-500" />
                    BUY
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-(--text-muted)">
                    <span className="w-2 h-2 rounded-full inline-block bg-orange-500" />
                    SELL
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MFFundComparisonChart;
