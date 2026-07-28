import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
// Import icons
import { FaEdit, FaTrash, FaCheck, FaSyncAlt,
  FaDownload, FaChartBar, FaListUl } from "react-icons/fa";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { HiOutlinePencil, HiOutlineTrash, HiOutlineTag } from "react-icons/hi";
import { FiX } from "react-icons/fi";

import ReactMarkdown from 'react-markdown';
import "react-resizable/css/styles.css";
import remarkGfm from "remark-gfm";

import { formatNumber } from "../utils/formats";
import utils from "../utils/utils";

import customCards from "./common/customCards";
import stockCards from "./stocks/StockCards";

import ThesisModal from "./common/editorModel";

import StockOrdersTable from "./stocks/StockOrdersTable";
import PositionsTable from "./stocks/PositionsTable";
import StockPerformanceChart from "./stocks/StockPerformanceChart";
import StockAllOrdersView from "./stocks/StockAllOrdersView";

import helpers from "./stocks/HelperFunctions";
import StockReturnsTable from "./stocks/StockReturnsTable";
import StockComparisonChart from "./stocks/StockComparisonChart";

// For Vite -- Access the environment variable
// import.meta.env.VITE_BACKEND_URL is used to access the environment variable in Vite
const BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ============================================================================
const StockList = ({ stocks, stockTradeAllocations, priceHistory, 
  indexHistory, currentStockData, holdingOrders, stockInstruments,
  onOrdersEdit, onScripCodesUpdate, onUpdateCurrentStockData,
  showAllocation, setShowAllocation, onSellStock, onAllocationsEdit,
  onUpdatePriceHistory, portfolioSeries = [] }) => {

  // Store the stock name of the stock which is expanded currently.
  const [expandedStock, setExpandedStock] = useState(null);

  // Table view mode: "portfolio" (price/qty/gain) or "returns" (1D..5Y + XIRR)
  const [viewMode, setViewMode] = useState("portfolio");

  // Store the scrip code information --> nav extracting
  const [scripCodes, setScripCodes] = useState({});

  // store the order id to delete
  const [deleteStockIds, setDeleteStockIds] = useState([]);

  // Store the merged stock information
  const [mergedStockData, setMergedStockData] = useState({});

  // State to manage dropdown for download data
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // State to manage mutual fund NAV updating
  const [updating, setUpdating] = useState(false);

  // State to manage the stock markdown editor
  const [showEditor, setShowEditor] = useState(false);
  const [editingThesis, setEditingThesis] = useState("");

  // State to manage tabs in expanded order view - "position" or "orders"
  const [expandedTab, setExpandedTab] = useState("position");

  // State to manage order editing
  const [editingRowId, setEditingRowId] = useState(null);
  const [rowDraft, setRowDraft] = useState(null);

  // State for the "All Orders" cross-stock ledger modal
  const [showAllOrders, setShowAllOrders] = useState(false);

  // State to manage sorting
  const [sortConfig, setSortConfig] = useState({
    key: "name",
    direction: "asc",
  });

  // ==========================================================================
  // --------------------------------------------------------------------------
  const instrumentsMap = useMemo(() => {
    const map = new Map();
    stockInstruments.forEach(inst => map.set(inst.symbol, inst.name));
    return map;
  }, [stockInstruments]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const updatePriceHistory = async () => {
    if (!onUpdatePriceHistory) return;

    try {
      setUpdating(true);
      // 1. Compute missing price ranges for all stocks based on 
      // their trade dates and existing price history
      const missingStockRanges = helpers.computeMissingPriceRanges(
        stocks, priceHistory, stockTradeAllocations
      );

      const missingIndexRanges = helpers.computeMissingIndexRanges(
        stocks, indexHistory
      );

      if (missingStockRanges.length === 0 && missingIndexRanges.length === 0) {
        console.log("Price history already up to date");
        setUpdating(false);
        return;
      }
      console.log("missingStockRanges: ", missingStockRanges);
      console.log("missingIndexRanges: ", missingIndexRanges);

      await onUpdatePriceHistory(missingStockRanges, missingIndexRanges);

    } catch (err) {
      console.error("Failed to update MF NAV history:", err);
    } finally {
      setUpdating(false);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const allocationMaps = useMemo(() => {

    return helpers.getAllocationMaps(stockTradeAllocations);

  }, [stocks, stockTradeAllocations]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Construct a normalized trade ledger enriched with allocation and PnL data.
  // This ledger is used for order-level analytics, realized PnL calculation,
  // and chronological reconstruction of trading activity.
  const stockOrderLedger = useMemo(() => {
    
    // Precomputed allocation maps for efficient lookup:
    // soldQtyByBuyOrder     → total quantity sold from each BUY lot
    // allocationsBySellOrder → allocation breakdown for each SELL order
    const { soldQtyByBuyOrder, allocationsBySellOrder } = allocationMaps;

    return stocks
      .map((trade) => {
        const qty = parseFloat(trade.quantity) || 0;
        const price = parseFloat(trade.price) || 0;
        const totalValue = qty * price;

        // -------------------------------------------------------
        // BUY ORDER PROCESSING
        // -------------------------------------------------------
        if (trade.order_type === "BUY") {
          // Quantity already sold from this BUY lot
          const soldQty = soldQtyByBuyOrder[trade.id] || 0;
          // Remaining shares still held from this lot
          const remainingQty = qty - soldQty;

          return {
            ...trade,
            totalValue,
            soldQty,
            remainingQty,
          };
        }

        // -------------------------------------------------------
        // SELL ORDER PROCESSING
        // -------------------------------------------------------
        if (trade.order_type === "SELL") {

          // Allocations linking this SELL order to specific BUY lots
          const allocations =
            allocationsBySellOrder[trade.id] || [];

          // Aggregate realized profit/loss for this sell order
          let realizedPnL = 0;

          const allocationDetails = allocations.map( (allocation) => {
              // Find the BUY trade corresponding to this allocation
              const buyTrade = stocks.find(
                (s) => s.id === allocation.buy_order_id
              );

              // Defensive check in case ledger and allocations get out of sync
              if (!buyTrade) return null;

              const buyPrice =
                parseFloat(buyTrade.price) || 0;
              const allocQty =
                parseFloat(allocation.quantity) || 0;

              const pnl =
                (price - buyPrice) * allocQty;

              realizedPnL += pnl;

              return {
                buy_order_id: buyTrade.id,
                buy_date: buyTrade.date,
                buy_price: buyPrice,
                quantity: allocQty,
                pnl,
              };
            }
          ).filter(Boolean);

          return {
            ...trade,
            totalValue,
            allocations: allocationDetails,
            realizedPnL,
          };
        }

        return trade;
      })

      // Ensure ledger is ordered chronologically for proper event
      // reconstruction
      .sort(
        (a, b) =>
          new Date(a.date) - new Date(b.date)
      );
  }, [stocks, allocationMaps]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const aggregatedStocks = useMemo(() => {

    if (!holdingOrders) return {};

    const agg = holdingOrders.reduce((acc, stock) => {
      const quantity = parseFloat(stock.quantity) || 0;
      const investmentvalue = parseFloat(stock.investmentvalue) || 0;
      const stockSymbol = stock.symbol.trim();

      if (!acc[stockSymbol]) {
        acc[stockSymbol] = {
          symbol: stockSymbol,
          quantity: 0,
          investmentvalue: 0.0,
          orders: [],
        };
      }

      acc[stockSymbol].quantity += quantity;
      acc[stockSymbol].investmentvalue += investmentvalue;
      acc[stockSymbol].orders.push(stock);

      return acc;
    }, {});

    for (let stockSymbol in agg) {
      let stock = agg[stockSymbol];
      stock.avgPrice =
        stock.quantity > 0
          ? (stock.investmentvalue / stock.quantity).toFixed(2)
          : 0.0;
    }

    return agg;
  }, [holdingOrders]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Function to delete the orders from database
  // Called upon hitting the Save button
  const updateEditedStocks = async (orderIdsToDelete, editedStocks) => {

    try {
      // Delete stock orders with given order IDs from database
      for (let orderId of orderIdsToDelete) {
        const response = await fetch(`${BASE_URL}/stocks/${orderId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          alert(`Failed to delete order with ID ${orderId}`);
          return; // Stop on failure
        };
      };

      let stockName = null;
      // Update the stock order in the database
      for (const [orderId, orderData] of Object.entries(editedStocks)) {
        // Get the stock name from the order data
        stockName = orderData.name;

        const response = await fetch(`${BASE_URL}/stocks/${orderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderData),
        });
        if (!response.ok) {
          alert(`Failed to update the order with ID ${orderId}`);
          return; // Stop on failure
        };
      };

      // ✅ Update the scrip codes in the database
      if (stockName) {
        onScripCodesUpdate(stockName, scripCodes);
      };

      // ✅ Inform parent to update global stocks
      onOrdersEdit(orderIdsToDelete, editedStocks);
      // ✅ Clear deleteStockIds after deletion
      setDeleteStockIds([]);
      // Reset the editing orders object
      setEditingOrders({});
      // Close the order list
      setExpandedStock(null); // 👈 This closes the expanded table
      // Reset the scrip codes
      setScripCodes({});
    } catch (error) {
      console.error("Error deleting or editing the orders:", error);
    };
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Handle save the stock thesis
  const updateStockThesis = async (stockId, thesisMarkdown) => {    
    try {
      const response = await fetch(`${BASE_URL}/stockscurrentdata/thesis/${stockId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis_markdown: thesisMarkdown }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Error updating thesis:", errorText);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Network error while updating thesis:", error);
      return false;
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const handleSaveThesis = async (stockObj, updatedThesis) => {

    const stockName = stockObj.name;
    
    // Set the scrip codes for the stock
    const selectedStock = currentStockData.find(stock => stock.name === stockName);
    if (selectedStock) {
      const stockID = selectedStock.id;

      const success = await updateStockThesis(stockID, updatedThesis);
      if (!success) return;

      // ✅ Update local state immutably
      setMergedStockData((prev) => {
        // Find matching key
        const updated = { ...prev };
        for (const key in updated) {
          if (updated[key].name === stockObj.name) {
            updated[key] = {
              ...updated[key],
              thesis_markdown: updatedThesis,
              thesis_last_updated: new Date().toISOString(),
            };
            break; // found and updated; exit loop
          }
        }
        return updated;
      });

    };
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Handle cancel order edit operation
  // --> reset ordersToDelte list and editingOrders
  const cancelEditOrderList = async () => {
    // ✅ Clear deleteStockIds after deletion
    setDeleteStockIds([]);
    // Reset the editing orders object
    setEditingOrders({});
    // Close the order list
    setExpandedStock(null); // This closes the expanded table
    // Reset the scrip codes
    setScripCodes({});
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Handle the order change data
  // Auto-update the investment value from price and quantity
  const handleOrderEdit = async (editedOrder, options={}) => {

    if (editedOrder.order_type === "SELL") {
      await onAllocationsEdit(options.allocationsToUpdate,
          options.allocationsToDelete
      );
    }

    await onOrdersEdit(
      [], // nothing to delete
      {
        [editedOrder.id]: editedOrder // single edited order
      }
    );
  };
  // Handle the order delete
  const handleOrderDelete = async (deleteOrder) => {
    await onOrdersEdit(
      [deleteOrder.id], // nothing to delete
      {}
    );
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Handle the order change data
  // Auto-update the investment value from price and quantity
  const handleOrderSell = async (sellOrder, options={}) => {
    await onSellStock(sellOrder, options );
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Toggle expand/collapse for order details
  const toggleExpand = (stockSymbol) => {
    if (expandedStock === stockSymbol) {
      setExpandedStock(null);
      setScripCodes({});
    } else {
      setExpandedStock(stockSymbol);

    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Memoized map of latest price for each stock symbol
  // This allows O(1) access to the latest price when rendering the table,
  // instead of O(n) search through priceHistory.
  const latestPriceMap = useMemo(() => {
    return helpers.setLatestPriceMap(priceHistory);
  }, [priceHistory]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Function to merge current Stock price data when
  // currentStockData and stocks data is updated
  useEffect(() => {
    
    if (Object.keys(aggregatedStocks).length > 0) {
      const mergedData = Object.values(aggregatedStocks).map((stock) => {
        const currentData = latestPriceMap[stock.symbol];
        
        const stockFullname = instrumentsMap.get(stock.symbol);

        let updatedStock = structuredClone(stock);
        let currentvalue = 0.0;
        let investmentvalue =
              updatedStock.quantity * (parseFloat(updatedStock.avgPrice) || 0);

        if (currentData) {
          // Access the current stock price
          const currentPrice = Number(String(currentData.price ?? 0).toString().replace(/,/g, "")) || 0.0;
          // Access quantity and investment value from the stock data
          let quantity = Number(updatedStock.quantity) || 0;
          currentvalue = currentPrice * quantity;

          // Update current price, fullname and other data
          updatedStock.currentPrice = currentPrice;
          updatedStock.fullname = stockFullname || stock.name;
          // updatedStock.marketcap = currentData.marketcap || 0;
          updatedStock.exchange = currentData.exchange || "";
          updatedStock.date = currentData.date || null;
          updatedStock.time = currentData.time || null;

          // Access the thesis markdown and its last updated timestamp          
          updatedStock.thesis_markdown = currentData.thesis_markdown || "";
          updatedStock.thesis_last_updated = currentData.thesis_last_updated
            ? new Date(currentData.thesis_last_updated).toISOString()
            : null;

          // Calculate the returns and gain
          if (investmentvalue > 0 && currentvalue > 0) {
            updatedStock.gain = currentvalue - investmentvalue;
            updatedStock.returns = (updatedStock.gain / investmentvalue) * 100;
          } else {
            updatedStock.gain = "-";
            updatedStock.returns = "-";
          };
        };

        // Convert the investment to a integer value
        updatedStock.investmentvalue = Math.round(investmentvalue);

        // Round off the current value
        updatedStock.currentvalue = Math.round(currentvalue);

        // Return the updated stock data
        return updatedStock;
      });

      // ✅ Sort the merged data alphabetically by stock symbol
      mergedData.sort((a, b) => a.symbol.localeCompare(b.symbol));

      // Set the merged stock data to the state
      setMergedStockData(mergedData);

    }
  }, [aggregatedStocks, latestPriceMap, stockInstruments]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Build previousPriceMap: { symbol: prevClose } using second-to-last date
  // per symbol in priceHistory — same approach as mfSummary previousNAVMap.
  const previousPriceMap = useMemo(() => {
    const map = {};
    if (!Array.isArray(priceHistory)) return map;
    priceHistory.forEach(stock => {
      if (!stock?.symbol || !Array.isArray(stock.history) || stock.history.length < 2) return;
      const sorted = [...stock.history]
        .sort((a, b) => (a.date > b.date ? -1 : 1)); // descending
      map[stock.symbol] = Number(sorted[1].close) || 0;
    });
    return map;
  }, [priceHistory]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const summary = useMemo(() => {
    let totalInvested = 0;
    let totalCurrent = 0;
    let totalGain = 0;
    let positive = 0;
    let negative = 0;

    Object.values(mergedStockData).forEach(stock => {
      const invested = Number(stock.investmentvalue) || 0;
      const current = Number(stock.currentvalue) || 0;

      totalInvested += invested;
      totalCurrent += current;

      let individualGain = 0;
      if (current && invested) {
        individualGain = current - invested;
        totalGain += individualGain;
      }

      if (individualGain >= 0) {
        positive += 1;
      } else {
        negative += 1;
      }

    });

    const totalReturns = totalInvested > 0
      ? (totalGain / totalInvested) * 100
      : 0;

    // FIX #9 — realised P&L aggregated from the trade ledger (source of truth).
    // Each SELL row in stockOrderLedger carries realizedPnL = Σ (sellPrice −
    // buyPrice)·allocQty over its allocations. Surfacing this lets StockCards
    // reconcile the invested basis (Value − NetInvested = Unrealised + Realised)
    // instead of silently diverging after a SELL.
    const totalRealizedPnL = (stockOrderLedger || [])
      .filter(o => o.order_type === "SELL")
      .reduce((s, o) => s + (Number(o.realizedPnL) || 0), 0);

    return {
      totalInvested,
      totalCurrent,
      totalGain,
      totalReturns,
      totalRealizedPnL,
      numStocks: Object.keys(mergedStockData).length,
      positive,
      negative,
    };
  }, [mergedStockData, previousPriceMap, stockOrderLedger]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Place at the top of mutualFundlist.jsx
  const StatusDot = ({ color, title }) => (
    <span
      title={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        margin: "1px 0",
        verticalAlign: "middle",
      }}
    />
  );
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Helper: Calculate dot color and title for an order
  function getOrderDotInfo(stockName, fundDate) {
    if (!fundDate) return { color: "#3B82F6", title: "Unknown" };
    const buyDate = new Date(fundDate);
    const now = new Date();
    const days = (now - buyDate) / (1000 * 60 * 60 * 24);

    if (days >= 365) return { color: "#22C55E", title: "Long Term" };
    if (days < 365) return { color: "#EF4444", title: "Short Term" };
    return { color: "#3B82F6", title: "Unknown" };
  }
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Render the status dot for an order
  function getOrderDot(order) {
    const { color, title } = getOrderDotInfo(order.name, order.date);
    return <StatusDot color={color} title={title} />;
  }
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Place inside MutualFundList
  function getAggregateDots(stock) {
    if (!stock.orders || stock.orders.length === 0) return null;
    const total = stock.orders.length;
    let long = 0, short = 0;

    stock.orders.forEach(order => {
      const { color } = getOrderDotInfo(order.name, order.date);
      // "#22C55E" is green (long term), everything else is short
      if (color === "#22C55E") {
        long++;
      } else {
        short++;
      }
    });

    // Calculate proportions (max 3 dots)
    const dotTotal = Math.min(3, total);
    let longDots = Math.round((long / total) * dotTotal);
    let shortDots = dotTotal - longDots;
    if (long > 0 && longDots === 0) {
      // Ensure at least one long dot if there are any long-term orders
      longDots = 1;
      shortDots = dotTotal - longDots;
    }

    // Ensure presence of shorts if any
    if (short > 0 && shortDots === 0) {
      shortDots = 1;
      longDots = dotTotal - shortDots;
    }

    let dotArr = [];
    for (let i = 0; i < longDots; i++) {
      dotArr.push(<StatusDot key={"long" + i} color="#22C55E" title="Long Term" />);
    }
    for (let i = 0; i < shortDots; i++) {
      dotArr.push(<StatusDot key={"short" + i} color="#EF4444" title="Short/Other Term" />);
    }

    return (
      <span style={{ display: "inline-flex", flexDirection: "column", marginLeft: 4 }}>
        {dotArr}
      </span>
    );
  }
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const handleDownloadStocks = () => {
    if (!mergedStockData || mergedStockData.length === 0) return;

    const excludedKeys = ["id", "orders"];
    const allKeys = Object.keys(mergedStockData[0]);
    const includedKeys = allKeys.filter(key => !excludedKeys.includes(key));

    // Extract headers from the first object
    const headers = includedKeys.join(",");

    // Convert each row to a CSV line
    const rows = mergedStockData.map(row =>
      includedKeys.map(key =>
        `"${String(row[key] ?? "").replace(/"/g, '""')}"`
      ).join(",")
    );

    const csvContent = [headers, ...rows].join("\n");

    // Create a Blob and trigger download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "aggregate_stock_Data.csv");
    link.click();
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const handleDownloadStockOrders = () => {
    if (!stocks || stocks.length === 0) return;

    const excludedKeys = ["id", "orders"];
    const allKeys = Object.keys(stocks[0]);
    const includedKeys = allKeys.filter(key => !excludedKeys.includes(key));

    // Extract headers from the first object
    const headers = includedKeys.join(",");

    // Convert each row to a CSV line
    const rows = stocks.map(row =>
      includedKeys.map(key =>
        `"${String(row[key] ?? "").replace(/"/g, '""')}"`
      ).join(",")
    );

    const csvContent = [headers, ...rows].join("\n");

    // Create a Blob and trigger download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "stock_order_data.csv");
    link.click();
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Click Handler for Headers
  // When a header is clicked, this function gets executed sorting the data.
  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        // toggle direction
        return {
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key, direction: "asc" };
    });
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Memoized sorted stock data
  // Use useMemo so sorting doesn’t happen on every render
  const sortedStocks = useMemo(() => {
    const data = Object.values(mergedStockData);

    if (!sortConfig.key) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];

      // handle null / undefined
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // string sort
      if (typeof aVal === "string") {
        return sortConfig.direction === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      // numeric sort
      return sortConfig.direction === "asc"
        ? aVal - bVal
        : bVal - aVal;
    });
  }, [mergedStockData, sortConfig]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // When edit button clicked, this function gets executed showing different
  // orders.
  const renderExpandedOrders = (stock) => (
    
    <tr>
      <td colSpan="9" className="p-0 align-top">
        <motion.div
              key="expanded-row"
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="relative overflow-hidden p-3 rounded-xl bg-(--card)
                        border border-(--border-light)"
            >
            <button
              onClick={() => setExpandedStock(null)}
              className="absolute top-2 right-2 p-1 rounded-md
                        hover:bg-red-950 transition"
            >
              <FiX size={16} />
            </button>
          <div className="p-0">
            {/* --- Buttons & Inputs section --- */}
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-(--text) font-semibold text-sm">
                {stock.fullname}
              </h3>
            </div>

            {/* Thesis Section */}
            <div className="mb-4 border border-(--border-light) rounded-lg bg-(--card-light) p-3">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-(--text) font-semibold text-sm">
                  Investment Thesis
                </h4>
                <button
                  onClick={() => {
                    setEditingThesis(stock.thesis_markdown || "");
                    setShowEditor(true);
                  }}
                  className="px-3 py-0 text-xs font-medium rounded-md 
                      bg-(--order-save-bg) text-white
                      hover:bg-(--order-save-bg-hover)
                      transition-colors"
                >
                  Edit Thesis
                </button>
              </div>
              {stock.thesis_last_updated && (
                <p className="text-(--text-muted) text-xs italic mb-2 py-0">
                  Last updated: {new Date(stock.thesis_last_updated).toLocaleString()}
                </p>
              )}
              <div
                className="max-h-56 overflow-y-auto p-2 rounded-md
                          bg-(--bg) text-(--text) text-sm leading-relaxed"
              >
                {stock.thesis_markdown ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {stock.thesis_markdown}
                  </ReactMarkdown>
                ) : (
                  <p className="italic text-(--text-muted)">
                    No thesis added yet. Click “Edit Thesis” to add one.
                  </p>
                )}
              </div>
            </div>

            {/*  🔽 Modal Render (below order window but within component) */}
            <ThesisModal
              visible={showEditor}
              content={editingThesis}
              setContent={setEditingThesis}
              last_updated={stock.thesis_last_updated}
              onSave={() => {
                handleSaveThesis(stock, editingThesis);
                setShowEditor(false);
              }}
              onClose={() => setShowEditor(false)}
            />

            {/* <div className="flex gap-4 border-b mb-4"> */}
            <div className="relative flex gap-6 mb-0">
              <button
                onClick={() => setExpandedTab("position")}
                className={`pb-2 text-sm font-medium transition-colors
                  ${
                    expandedTab === "position"
                      ? "text-blue-600"
                      : "text-(--text-muted) hover:text-(--text-primary)"
                  }`}
              >
                Position
              </button>

              <button
                onClick={() => setExpandedTab("orders")}
                className={`pb-2 text-sm font-medium transition-colors
                  ${
                    expandedTab === "orders"
                      ? "text-blue-600"
                      : "text-(--text-muted) hover:text-(--text-primary)"
                  }`}
              >
                Orders
              </button>
              <span
                className={`absolute bottom-0 h-0.5 bg-blue-600 transition-all duration-300 ${
                  expandedTab === "position"
                    ? "left-0 w-18"
                    : "left-25 w-17"
                }`}
              />
            </div>

            {expandedTab === "position" && (
              <PositionsTable 
                holdingOrders={holdingOrders} 
                stock={stock} 
                getOrderDot={getOrderDot} 
                utils={utils} 
              />
            )}

            {expandedTab === "orders" && (
              <StockOrdersTable
                stock={stock}
                stockOrderLedger={stockOrderLedger.filter((order) => order.symbol === stock.symbol)}
                stockTradeAllocations={stockTradeAllocations.filter((alloc) => {                  
                  const buyOrder = stockOrderLedger.find((o) => o.id === alloc.buy_order_id);
                  const sellOrder = stockOrderLedger.find((o) => o.id === alloc.sell_order_id);
                  return (buyOrder?.symbol === stock.symbol) || (sellOrder?.symbol === stock.symbol);
                })}
                editingRowId={editingRowId}
                setEditingRowId={setEditingRowId}
                rowDraft={rowDraft}
                setRowDraft={setRowDraft}
                onUpdateOrder={handleOrderEdit}
                onDeleteOrder={handleOrderDelete}
                onOpenSellOrder={handleOrderSell}
              />
            )}

          </div>
        </motion.div>
      </td>
    </tr>
  );
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Only stocks with remaining quantity > 0 — used by StockReturnsTable and
  // StockComparisonChart (mirrors MF's holdingFunds pattern).
  const holdingStocks = useMemo(() =>
    (Array.isArray(mergedStockData) ? mergedStockData : [])
      .filter(s => parseFloat(s.quantity) > 0),
    [mergedStockData]
  );

  const allocationBySymbol = useMemo(() => {
    const totalCurrent = summary.totalCurrent || 0;
    const map = {};

    (Array.isArray(mergedStockData) ? mergedStockData : []).forEach(stock => {
      map[stock.symbol] =
        totalCurrent > 0
          ? ((stock.currentvalue || 0) / totalCurrent) * 100
          : 0;
    });

    return map;
  }, [mergedStockData, summary.totalCurrent]);
  // --------------------------------------------------------------------------

  return (
    <>
      {/* Header + Action Bar */}
      <div className="flex flex-wrap items-center justify-between w-full
                    mb-4 gap-4 sm:gap-6 max-w-5xl mx-auto">

        <h2 className="text-2xl font-bold tracking-tight">
          🎡 Stock Portfolio
        </h2>

        <div className="flex items-center gap-4">
          {/* Update Share Prices */}
          <button
            className={`nav-btn flex items-center gap-2 px-4 py-2 text-sm
                    font-medium rounded-lg transition-colors shadow-sm
            ${updating ? "bg-gray-400 cursor-not-allowed" : ""}`}
            onClick={updatePriceHistory} disabled={updating}>
            <FaSyncAlt
              className={`text-base ${updating ? "animate-spin" : ""}`}
            />
            <span className="px-1 text-sm font-medium">
              {updating ? "  Updating Stock Prices..." : "  Update Stock Prices"}
            </span>
          </button>

          {/* Download Menu */}
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen(prev => !prev)}
              className={"nav-btn"}
            >
              <FaDownload />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 z-10 mt-2 w-56 rounded-md
                      shadow-lg bg-(--card) ring-1 ring-(--border)">
                <div className="py-1">

                  <button
                    onClick={() => {
                      handleDownloadStocks();
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left flex items-center px-4
                              py-2 hover:bg-(--hover-bg)
                              text-sm text-(--accent)"
                  >
                    📄 Download Aggregate Stock Data
                  </button>
                  <button
                    onClick={() => {
                      handleDownloadStockOrders();
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left flex items-center px-4 py-2
                    hover:bg-(--hover-bg) text-sm text-(--accent)"
                  >
                    📄 Download Stock orders data
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stock Summary Card + Performance Chart */}
      <stockCards.StockSummaryCard
        summary={summary}
        portfolioSeries={portfolioSeries}
        showAllocation={showAllocation}
        onToggle={() => setShowAllocation(prev => !prev)}
        onViewAllOrders={() => setShowAllOrders(true)}
      />

      {/* ── All Orders modal: flat, searchable, filterable cross-fund ledger ── */}
      <StockAllOrdersView
        visible={showAllOrders}
        onClose={() => setShowAllOrders(false)}
        stocks={stocks}
        stockTradeAllocations={stockTradeAllocations}
        instrumentsMap={instrumentsMap}
        />

      {showAllocation && (
        <StockPerformanceChart
          portfolioSeries={portfolioSeries}
          indexHistory={indexHistory}
        />
      )}

      {/* Allocation Chart */}
      {showAllocation && (
        <div className="flex justify-center w-full mb-0">
          <div className="bg-(--card) rounded-xl shadow-sm py-2 px-0
                transition-all duration-200 w-full max-w-5xl">
            <customCards.AllocationChart
              allocationData={mergedStockData}
            />
          </div>
        </div>
      )}

      {/* Stock-to-Stock Comparison Chart (collapsible, occasional-use tool) */}
      <StockComparisonChart
        holdingStocks={holdingStocks}
        priceHistory={priceHistory}
        stocks={stocks}
      />

      {/* ===== STOCKS TABLE ===== */}
      <div className="flex justify-center w-full mb-10">
        <div className="w-full max-w-5xl">

          {/* View mode toggle: Portfolio (price/qty/gain) vs Returns (1D..5Y+XIRR) */}
          {stocks.length > 0 && (
            <div className="flex justify-end mb-3">
              <div className="inline-flex rounded-lg border border-(--border)
                              bg-(--card-light) p-0.5">
                <button
                  onClick={() => setViewMode("portfolio")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                    ${viewMode === "portfolio"
                      ? "bg-(--accent) text-white"
                      : "text-(--text-muted) hover:(--text)"}`}
                >
                  Portfolio
                </button>
                <button
                  onClick={() => setViewMode("returns")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                    ${viewMode === "returns"
                      ? "bg-(--accent) text-white"
                      : "text-(--text-muted) hover:(--text)"}`}
                >
                  Returns
                </button>
              </div>
            </div>
          )}

          {stocks.length === 0 ? (
          <p className="text-center text-(--text-muted) py-6">
            No stocks added yet. Please add some stocks.
          </p>
          ) : viewMode === "returns" ? (
            <StockReturnsTable
              holdingStocks={holdingStocks}
              priceHistory={priceHistory}
              stocks={stocks}
              stockTradeAllocations={stockTradeAllocations}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate
                  border-spacing-y-1">
                <thead className="bg-(--table-header) text-(--text-strong)">
                  <tr>
                    <th className="px-3 py-2.5 text-left align-middle
                                      rounded-l-lg font-semibold"
                        onClick={() => handleSort("name")}
                      >
                        Name {sortConfig.key === "name" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                    <th className="px-3 py-2.5 text-center align-middle
                                      font-semibold"
                        onClick={() => handleSort("avgPrice")}
                      >
                          Avg. Price {sortConfig.key === "avgPrice" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                    <th className="px-3 py-2.5 text-center align-middle
                                  font-semibold"
                        onClick={() => handleSort("quantity")}
                      >
                        Qty. {sortConfig.key === "quantity" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                    <th className="px-3 py-2.5 text-center align-middle
                                font-semibold"
                        onClick={() => handleSort("currentPrice")}
                      >
                        Current Price {sortConfig.key === "currentPrice" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                    <th className="px-3 py-2.5 text-center align-middle
                                font-semibold"
                      onClick={() => handleSort("investmentvalue")}>
                        Invested {sortConfig.key === "investmentvalue" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                    <th className="px-3 py-2.5 text-center align-middle
                                font-semibold"
                        onClick={() => handleSort("currentvalue")}
                      >
                        Current Value {sortConfig.key === "currentvalue" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                    <th className="px-3 py-2.5 text-center align-middle font-semibold">
                        Alloc %
                      </th>
                    <th className="px-3 py-2.5 text-center align-middle
                                font-semibold"
                        onClick={() => handleSort("gain")}
                      >
                        Gain {sortConfig.key === "gain" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                    <th className="px-3 rounded-r-lg"
                        onClick={() => handleSort("returns")}
                      >
                        Returns {sortConfig.key === "returns" &&
                        (sortConfig.direction === "asc" ? "▲" : "▼")}
                      </th>
                  </tr>
                </thead>

                <tbody>
                  {sortedStocks.map((stock, index) => {
                    
                    return (
                      <React.Fragment key={stock.symbol}>
                        <tr className={`shadow-sm hover:shadow-md rounded-lg
                              transition-all hover:bg-(--hover-bg)
                               ${index % 2 === 0
                                                ? "bg-(--table-row2)"
                                                : "bg-(--table-row1)"}`}
                        >
                          <td className="px-3 py-2.5 text-center items-center
                                          align-middle rounded-l-lg">
                            <div className="flex items-center gap-0">
                              {getAggregateDots(stock)}

                              <button className="mr-2 px-0 w-0 border-0!
                                hover:text-blue-500 transition duration-300
                                ease-in-out transform hover:scale-115"
                                onClick={() => toggleExpand(stock.symbol)}>
                                <FaChevronDown
                                  className={`text-(--accent) transform
                                    transition-transform duration-300 ease-in-out ${
                                      expandedStock === stock.symbol
                                          ? "rotate-0"
                                          : "rotate-90"
                                  }`}
                                />
                              </button>

                              {stock.symbol ? (
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                  <span>{stock.symbol}</span>
                                  <span style={{ fontSize: "0.6em", lineHeight: "1", textAlign: "left" }}>
                                    {stock.exchange ? stock.exchange : ""}
                                  </span>
                                </div>
                              ) : (
                                "NA"
                              )}
                            </div>
                          </td>

                          <td className="px-3 py-2.5 text-center align-middle">
                              {stock.avgPrice}</td>
                          <td className="px-3 py-2.5 text-center align-middle">
                              {stock.quantity}</td>

                          {/* Add current price of the stock along with date and time */}
                          <td className="px-3 py-2.5 text-center align-middle">
                            {/* Add date on which the nav is extracted */}
                            {stock.currentPrice ? (
                              <div style={{ display: "flex", flexDirection: "column" }}>
                                <span>{stock.currentPrice}</span>
                                <span style={{ fontSize: "0.6em", lineHeight: "1" }}>
                                  {stock.date
                                    ? `${stock.date}${stock.time ? " | " + stock.time : ""}`
                                    : ""}
                                </span>
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>

                          <td className="px-3 py-2.5 text-center align-middle">
                              {formatNumber(stock.investmentvalue)}</td>
                          <td className="px-3 py-2.5 text-center align-middle">
                              {formatNumber(stock.currentvalue)}</td>

                          <td className="px-3 py-2.5 text-center align-middle">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-xs font-medium">
                                {(allocationBySymbol[stock.symbol] || 0).toFixed(1)}%
                              </span>
                              <div className="w-12 h-1 rounded-full bg-(--border-light) overflow-hidden">
                                <div
                                  className="h-full bg-(--accent) rounded-full"
                                  style={{ width: `${Math.min(allocationBySymbol[stock.symbol] || 0, 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Add colour to the return value */}
                          <td className="px-3 py-2.5 text-center align-middle">
                            <span className={utils.getPerformanceColorClass(stock.gain)}>
                              {typeof stock.gain === "number"
                                ? `${stock.gain > 0 ? "+" : ""}${formatNumber(Math.round(stock.gain))}`
                                : "-"}
                            </span>
                          </td>

                          {/* Add colour to the return value */}
                          <td className="px-3 py-2.5 text-center align-middle
                                    rounded-r-lg">
                            <span className={utils.getPerformanceColorClass(stock.returns)}
                            >
                              {typeof stock.returns === "number"
                                ? `${stock.returns > 0 ? "+" : ""}${stock.returns.toFixed(2)}`
                                : "-"}
                            </span>
                          </td>
                        </tr>

                        <AnimatePresence mode="wait">
                          {/* Expanded Buy Orders Table */}
                          {expandedStock === stock.symbol &&
                            renderExpandedOrders(stock)}                            
                        </AnimatePresence>

                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default StockList;

