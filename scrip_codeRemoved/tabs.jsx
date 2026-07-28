// --------------------------------------------------------------------------
import React, { useState, useEffect, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

// Import icons
import { FaPlus, FaChartLine, FaPiggyBank, FaChartPie, FaCoins } from 'react-icons/fa'; // Added FaChartPie for the new tab
import { Sun, Moon, LayoutDashboard, Menu, X } from 'lucide-react'; // At top
import { MdSummarize } from 'react-icons/md';
import SanchayaBodhiLogo from '../assets/logo_noBg.png';

import InputForm from "./inputForm/inputForm";
import StockList from "./stocklist";
import MutualFundList from "./mutualFundlist";
import OtherAssetList from "./otherAssetlist";
import ValuationMetricsApp from './valuationMetrics';
import SummaryTab from './summaryTab';

import stockHelpers from "./stocks/HelperFunctions";
import mfHelpers    from "./mutualFunds/HelperFunctions";

import { useTheme } from '../context/ThemeContext';
import ScrollToTop from "./common/ScrollToTop";

import * as stockService from "../services/stockService";
import * as mfService from "../services/mutualFundService";

// For Vite -- Access the environment variable
// import.meta.env.VITE_BACKEND_URL is used to access the environment variable in Vite
const BASE_URL = import.meta.env.VITE_BACKEND_URL;


// ============================================================================
const Tabs = () => {
  const [activeTab, setActiveTab] = useState("summary");
  // State for dropdown menu
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // New state for responsive toggle
  const [isMobileView, setIsMobileView] = useState(false);

  // Stores all buy orders for stocks
  const [stocks, setStocks] = useState([]);

  // Stores index price history data from database
  const [indexHistory, setIndexHistory] = useState([]);

  // Stores price history data from database
  const [stockPriceHistory, setStockPriceHistory] = useState([]);

  // Stores per-stock investment thesis records ONLY (not price, not scrip codes).
  // Shape: [{ id, name, thesis_markdown, thesis_last_updated }]. Sourced from the
  // stockscurrentdata table, which now holds thesis alone. Price comes from
  // history; symbol/name come from the instruments map.
  const [stockThesisData, setStockThesisData] = useState([]);

  // Stores MF NAV history from mf_nav_history table.
  // Shape: [{ symbol: schemecode, history: [{date, nav}] }]
  // This replaces currentMFData as the source of current NAV.
  const [mfNavHistory, setMfNavHistory] = useState([]);

  // Stores stock instrument details
  const [stockInstruments, setStockInstruments] = useState([]);
  // Stores mutual fund instrument details
  const [mutualFundInstruments, setMutualFundInstruments] = useState([]);

  // Stores stock trade allocations
  const [stockTradeAllocations, setStockTradeAllocations] = useState([]);
  // Stores mutual fund trade allocations
  const [mfTradeAllocations, setMfTradeAllocations] = useState([]);
  
  // Stores all buy orders for other assets
  const [otherAssets, setOtherAssets] = useState([]);

  // Stores all buy orders for mutual funds
  const [mutualFunds, setMutualFunds] = useState([]);
  // Stores mutual funds Current data
  const [currentMFData, setCurrentMFData] = useState([]);

  // Stores the show summary ON/OFF
  const [showMFSummary, setShowMFSummary] = useState(false);
  const [showOASummary, setShowOASummary] = useState(false);

  // Show stock allocation
  const [showAllocation, setShowAllocation] = useState(false);

  // variabels for touch effect
  const tabOrder = ["add", "stock_portfolio", "mf_portfolio", "valuation_metrics"];
  const tabContainerRef = useRef(null);

  // Swipe state
  const touchStartX = useRef(null);

  // Dark/Light Theme variable
  const { theme, toggleTheme } = useTheme();

  const [navMode, setNavMode] = useState("full"); 
  // "full" | "compact" | "mobile"

  // New loading state
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(false);

  // --------------------------------------------------------------------------
  // Periodic fetch for NAVs and Stocks (new rules)
  useEffect(() => {
    const checkAndFetchMutualFunds = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();

      // 11:30 PM daily (domestic funds)
      if (hours === 23 && minutes === 30) {
        console.log("🌙 Fetching Mutual Fund NAVs (Domestic)...");
        fetchMutualFundsCurrentData();
      }

      // 11:00 AM daily (international funds)
      if (hours === 11 && minutes === 0) {
        console.log("☀️ Fetching Mutual Fund NAVs (International)...");
        fetchMutualFundsCurrentData();
      }
    };

    const fetchStocksPeriodically = () => {
      const now = new Date();
      const day = now.getDay(); // Sunday=0, Monday=1, ..., Saturday=6
      const hours = now.getHours();
      const minutes = now.getMinutes();

      // Skip weekends
      if (day === 0 || day === 6) return;

      // Market hours check (9:15–15:30 IST)
      const isMarketHours =
        (hours > 9 || (hours === 9 && minutes >= 15)) &&
        (hours < 15 || (hours === 15 && minutes <= 30));

      // Every 30 min during market hours
      if (isMarketHours && minutes % 30 === 0) {
        console.log("📈 Fetching Stock Prices (Market Hours)...");
        fetchStocksCurrentData();
      }

      // Once after market close at 5:00 PM
      if (hours === 17 && minutes === 0) {
        console.log("🌇 Fetching Stock Prices (Post-Market)...");
        fetchStocksCurrentData();
      }
    };

    // Run every minute to check NAV/Stock conditions
    const interval = setInterval(() => {
      checkAndFetchMutualFunds();
      fetchStocksPeriodically();
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, []);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  useEffect(() => {
    const container = tabContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX;
    };

    const handleTouchEnd = (e) => {
      if (touchStartX.current === null) return;
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchEndX - touchStartX.current;
      const threshold = 50; // Minimum px to be considered a swipe

      if (Math.abs(diff) > threshold) {
        const currentIdx = tabOrder.indexOf(activeTab);
        if (diff < 0 && currentIdx < tabOrder.length - 1) {
          // Swipe left: next tab
          setActiveTab(tabOrder[currentIdx + 1]);
        } else if (diff > 0 && currentIdx > 0) {
          // Swipe right: previous tab
          setActiveTab(tabOrder[currentIdx - 1]);
        }
      }
      touchStartX.current = null;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [activeTab]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Handle click outside to close mobile menu
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMobileMenuOpen && isMobileView) {
        // Check if click is outside the mobile menu and menu button
        const mobileMenu = document.querySelector('[data-mobile-menu]');
        const menuButton = document.querySelector('[data-mobile-menu-button]');

        if (mobileMenu && menuButton &&
          !mobileMenu.contains(event.target) &&
          !menuButton.contains(event.target)) {
          setIsMobileMenuOpen(false);
        }
      }
    };

    if (isMobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMobileMenuOpen, isMobileView]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Memoized map of latest price for each stock symbol
  // This allows O(1) access to the latest price when rendering the table,
  // instead of O(n) search through priceHistory.
  // Latest stock price per symbol, DERIVED from stock price history — the single
  // source of truth for "current" price. No separate stockscurrentdata table /
  // fetch is used for price anymore. Shape: { [symbol]: { price, date } }.
  const currentStockData = useMemo(() => {

    if (!Array.isArray(stockPriceHistory)) return {};
    
    return stockHelpers.setLatestPriceMap(stockPriceHistory);

  }, [stockPriceHistory]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Memoized list of stock orders with their remaining quantity and
  // allocated quantit. This is used to display the current holdings.
  const stockHoldingOrders = useMemo(() => {

    return stockHelpers.getHoldingOrders(stocks, stockTradeAllocations);

  }, [stocks, stockTradeAllocations]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // MF holding orders: BUY lots with remaining units > 0 (nets out redemptions).
  // investmentvalue = remainingQty × buyNAV. Used by SummaryTab + chart.
  const mfHoldingOrders = useMemo(() => {
    return mfHelpers.getMFHoldingOrders(mutualFunds, mfTradeAllocations);
  }, [mutualFunds, mfTradeAllocations]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Latest NAV per schemecode from mfNavHistory.
  // Shape: { [schemecode]: { nav, date } } — replaces currentMFData for NAV.
  const latestNAVMap = useMemo(() => {
    return mfHelpers.getLatestNAVMap(mfNavHistory);
  }, [mfNavHistory]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Daily MF portfolio series: [{ date, value, gain, returnPct, cashFlow }]
  // cashFlow: BUY = negative, SELL = positive (XIRR sign convention).
  const mfPortfolioSeries = useMemo(() => {
    return mfHelpers.buildMFPortfolioSeries(mutualFunds, mfNavHistory);
  }, [mutualFunds, mfNavHistory]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Daily stock portfolio series: same shape as mfPortfolioSeries.
  const stockPortfolioSeries = useMemo(() => {

    return stockHelpers.buildStockPortfolioSeries(
      stocks, stockTradeAllocations, stockPriceHistory
    );

  }, [stocks, stockTradeAllocations, stockPriceHistory]);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Delete stock trade allocations from backend
  const deleteStockAllocations = async (allocationIds) => {
    if (allocationIds.length === 0) return true;

    try {
      const response = await fetch(`${BASE_URL}/stock_trade_allocations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation_ids: allocationIds }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error("Error deleting allocations:", error);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error deleting stock allocations:", error);
      return false;
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const handleStockOrderEdit = async (orderIdsToDelete=[], editedOrders=null) => {
    let updatedStocks = [...stocks];

    /* ===============================
      1️⃣ DELETE ORDERS (API FIRST)
    =============================== */
    if (orderIdsToDelete.length > 0) {

      try {
        // 🔥 DELETE STOCK ORDERS API        
        for (let orderId of orderIdsToDelete) {
          await stockService.deleteOrder(orderId);
        };

        console.log("✅ Stock orders deleted");

      } catch (error) {
        console.error("🚨 Error deleting stock orders:", error);
        alert(error.message || "Failed to delete order");
        return;
      }

      // Remove from local state AFTER API success
      updatedStocks = updatedStocks.filter(
        (stock) => !orderIdsToDelete.includes(stock.id)
      );

      // 2️⃣ Find and delete associated allocations
      // Remove deleted stocks' allocations from local state
      // Find all allocations that reference deleted order IDs
      const allocationIdsToRemove = stockTradeAllocations
        .filter(
          (alloc) =>
            orderIdsToDelete.includes(alloc.buy_order_id) ||
            orderIdsToDelete.includes(alloc.sell_order_id)
        )
        .map((alloc) => alloc.id);

      if (allocationIdsToRemove.length > 0) {
        setStockTradeAllocations((prev) =>
          prev.filter((alloc) => !allocationIdsToRemove.includes(alloc.id))
        );
      }
    }

    /* ===============================
      2️⃣ UPDATE EDITED ORDERS (API FIRST)
    =============================== */
    // updatedStocks = updatedStocks.map((stock) =>
    //   editedOrders[stock.id] ? { ...stock, ...editedOrders[stock.id] } : stock
    // );
    if (editedOrders && Object.keys(editedOrders).length > 0) {
      try {
        const updatedOrdersFromAPI = [];

        for (let orderId of Object.keys(editedOrders)) {
          const orderToUpdate = {
            id: orderId,
            ...editedOrders[orderId],
          };

          // 🔥 Call your improved updateOrder API helper
          const updatedOrder = await stockService.updateOrder(orderToUpdate);

          if (!updatedOrder) {
            console.error(`❌ Failed to update order ${orderId}`);
            return; // ⛔ stop execution
          }

          updatedOrdersFromAPI.push(updatedOrder);
        }

        console.log("✅ Orders updated successfully");

        // Replace local state using returned API objects
        updatedStocks = updatedStocks.map((stock) => {
          const updated = updatedOrdersFromAPI.find(
            (order) => order.id === stock.id
          );
          return updated ? updated : stock;
        });

      } catch (error) {
        console.error("🚨 Error updating stock orders:", error);
        alert(error.message || "Failed to update order");
        return;
      }
    }

    /* ===============================
      FINAL STATE UPDATE
    =============================== */
    setStocks(updatedStocks);
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const handleAllocationsEdit = async (allocationsToUpdate,
      allocationsToDelete) => {
    // Work on a local copy of allocations
    let updatedAllocations = [...stockTradeAllocations];

    // 1) Delete allocations (API first)
    if (Array.isArray(allocationsToDelete) && allocationsToDelete.length > 0) {
      const success = await deleteStockAllocations(allocationsToDelete);
      if (!success) {
        alert("Failed to delete allocations");
        return;
      }
      updatedAllocations = updatedAllocations.filter(
        (alloc) => !allocationsToDelete.includes(alloc.id)
      );
    }

    // 2) Update allocations (API first)
    if (allocationsToUpdate) {
      const payload = Array.isArray(allocationsToUpdate)
        ? allocationsToUpdate
        : Object.values(allocationsToUpdate);

      if (payload.length > 0) {
        try {
          const response = await fetch(`${BASE_URL}/stock_trade_allocations`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allocations: payload }),
          });

          if (!response.ok) {
            const txt = await response.text();
            throw new Error(txt || "Failed to update allocations");
          }

          const updatedFromAPI = await response.json();

          // Merge updated allocations into local list
          const map = new Map(updatedAllocations.map((a) => [a.id, a]));
          (Array.isArray(updatedFromAPI) ? updatedFromAPI : payload).forEach((a) =>
            map.set(a.id, a)
          );
          updatedAllocations = Array.from(map.values());
        } catch (err) {
          console.error("🚨 Error updating allocations:", err);
          alert(err.message || "Failed to update allocations");
          return;
        }
      }
    }

    // 3) Commit to state
    setStockTradeAllocations(updatedAllocations);
  }
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // REMOVED updateScripCodes + updateCurrentStockData.
  // Scrip codes (nse_scrip_code / bse_scrip_code) are obsolete — symbol, name
  // and instrument metadata now come from the instruments map (stockInstruments),
  // which is the single source used everywhere. The stockscurrentdata price
  // columns are likewise gone (price is derived from history). Nothing writes to
  // that table for price/scrip anymore.
  // --------------------------------------------------------------------------
  // ==========================================================================

  // --------------------------------------------------------------------------
  const handleMFOrderEdit = (orderIdsToDelete, editedOrders) => {
    let updatedMFs = mutualFunds;

    // filter out the order ids which are deleted
    orderIdsToDelete.forEach((orderId) => {
      updatedMFs = updatedMFs.filter((mutualFund) => mutualFund.id !== orderId);
    });

    // update the edited order data
    updatedMFs = updatedMFs.map((mutualFund) =>
      editedOrders[mutualFund.id]
        ? { ...mutualFund, ...editedOrders[mutualFund.id] }
        : mutualFund
    );

    // Set the update Mutual funds data
    setMutualFunds(updatedMFs);
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const handleOAOrderEdit = (orderIdsToDelete, editedOrders) => {
    let updatedOAs = otherAssets;

    // filter out the order ids which are deleted
    orderIdsToDelete.forEach((orderId) => {
      updatedOAs = updatedOAs.filter((otherAsset) => otherAsset.id !== orderId);
    });

    // update the edited order data
    updatedOAs = updatedOAs.map((otherAsset) =>
      editedOrders[otherAsset.id]
        ? { ...otherAsset, ...editedOrders[otherAsset.id] }
        : otherAsset
    );

    // Set the update Mutual funds data
    setOtherAssets(updatedOAs);
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Function to call API to delete mutual funds with IDs
  const deleteMultipleMFs = async (mfIDsToDelete) => {
    if (mfIDsToDelete.length === 0) return;

    try {
      const response = await fetch(`${BASE_URL}/mutualfundscurrentdata`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: mfIDsToDelete }),
      });

      const data = await response.json();
    } catch (error) {
      console.error("Error deleting mutual funds:", error);
    };
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Delete the current mutual fund data with matching MF name
  // mfToDelete -> mutual fund name to be deleted
  const handleCurrentMFDelete = (mfToDelete) => {
    // let updatedCurrentMFs = [ ...currentMFData ];
    let updatedCurrentMFs = currentMFData.map(mf => ({ ...mf }));

    updatedCurrentMFs = updatedCurrentMFs.filter((mutualFund) => mutualFund.name !== mfToDelete);
    const mfIDsToDelete = currentMFData
      .filter((mutualFund) => mutualFund.name === mfToDelete) // Keep only matching items
      .map((mutualFund) => mutualFund.id) // Extract IDs

    // Delete entries from database
    // use .then to call async function
    deleteMultipleMFs(mfIDsToDelete)
      .then(() => console.log("Deletion completed!"))
      .catch(error => console.error("Error while deleting:", error));

    // Set the update Mutual funds data
    setCurrentMFData(updatedCurrentMFs);
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Function to update the current mutual fund nav data.
  const handleCurrentMFUpdate = (updatedData) => {

    let mfToUpdate = [];
    // Update the nav data in the currentMFData
    const newMFCurrentData = currentMFData.map((mfData) => {
      const currData = structuredClone(mfData);  // create a deep copy
      const schemecode = mfData.schemecode;

      if (schemecode && Object.hasOwn(updatedData, schemecode)) {

        let newDate = updatedData[schemecode].date;
        // Check if date is valid (i.e. not undefined and not null)
        if (newDate) {
          let prevDate = isNaN(new Date(currData.date)) ? null : new Date(currData.date);
          newDate = new Date(newDate);

          // Check if the new date is latest that current one
          if (!prevDate || newDate > prevDate) {
            currData.nav = updatedData[schemecode].nav ?? currData.nav;
            currData.date = newDate.toISOString().split('T')[0]; // Keep YYYY-MM-DD format
            currData.fullname = updatedData[schemecode].name ?? "";

            // Update
            mfToUpdate.push(currData);
          };
        };
      };
      return currData;
    });

    // Set the update Mutual funds data
    setCurrentMFData(newMFCurrentData);

    // Update the data in the database
    updateCurrentMFData(mfToUpdate, "PUT");

  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // REMOVED handleCurrentStockUpdate.
  // It snapshotted live quotes (price/date/time/marketcap/exchange) into the
  // stockscurrentdata table and mirrored them in client state. Current price is
  // now derived from stock price history, so there is nothing to snapshot. The
  // handler was also effectively dead (its prop onUpdateCurrentStockData was
  // never invoked from StockList).
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch mutual funds data from backend when the app loads
  const fetchMutualFunds = async () => {
    try {
      const response = await fetch(`${BASE_URL}/mutualfunds`);
      const data = await response.json();

      setMutualFunds(data); // Update the UI with stored mutual funds
    } catch (error) {
      console.error("Error fetching mutual funds:", error);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch mutual funds data from backend when the app loads
  const fetchOtherAssets = async () => {
    try {
      const response = await fetch(`${BASE_URL}/otherassets`);
      const data = await response.json();

      setOtherAssets(data); // Update the UI with stored mutual funds
    } catch (error) {
      console.error("Error fetching other assets:", error);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch mutual funds from backend when the app loads
  const fetchMutualFundsCurrentData = async () => {
    try {
      const response = await fetch(`${BASE_URL}/mutualfundscurrentdata`);
      const data = await response.json();

      // Update the UI with stored mutual funds current data        
      setCurrentMFData(data);
    } catch (error) {
      console.error("Error fetching current mutual funds:", error);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch stocks from backend when the app loads
  const fetchStocks = async () => {
    try {
      const response = await fetch(`${BASE_URL}/stocks`);
      const data = await response.json();
      setStocks(data); // Update the UI with stored stocks
    } catch (error) {
      console.error("Error fetching stocks:", error);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch per-stock thesis records (thesis only) from the stockscurrentdata
  // table. Price/scrip are no longer read from or written to this table.
  // Expected shape: [{ id, name, thesis_markdown, thesis_last_updated }].
  const fetchStockThesisData = async () => {
    try {
      const response = await fetch(`${BASE_URL}/stockscurrentdata`);
      const data = await response.json();
      setStockThesisData(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching stock thesis data:", error);
      setStockThesisData([]);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Sync parent thesis state after a successful save in StockList (the PUT is
  // performed inside StockList.updateStockThesis). Keeps display consistent
  // without a full refetch.
  const handleThesisSaved = (stockId, thesisMarkdown) => {
    setStockThesisData(prev =>
      prev.map(rec =>
        rec.id === stockId
          ? { ...rec, thesis_markdown: thesisMarkdown,
              thesis_last_updated: new Date().toISOString() }
          : rec
      )
    );
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const fetchIndexPriceHistory = async () => {

    try {
      const res = await fetch(`${BASE_URL}/prices/get_indices`);
      if (!res.ok) {
        throw new Error("Failed to fetch index price history");
      }
      const data = await res.json();
      setIndexHistory(data); // Update the UI with index price history
    
    } catch (error) {
      console.error("Error fetching index prices:", error);
    }
  }

  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch stock price history from database
  const fetchStockPriceHistory = async () => {
    try {
      const response = await fetch(`${BASE_URL}/prices/get_stocks`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        throw new Error("Failed to fetch price history from database");
      }

      const data = await response.json();
      setStockPriceHistory(data); // Update the UI with DB price history

    } catch (error) {
      console.error("DB price history fetch error:", error);
    }
  }
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch stocks from backend when the app loads
  const fetchInstruments = async () => {
    try {
      const response = await fetch(`${BASE_URL}/instruments`);
      const data = await response.json();

      const instruments = Array.isArray(data) ? data : [];
      setStockInstruments(instruments.filter((instrument) => instrument.asset_type === "EQ"));
      setMutualFundInstruments(instruments.filter((instrument) => instrument.asset_type === "MF"));

    } catch (error) {
      console.error("Error fetching instruments:", error);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const fetchMfTradeAllocations = async () => {
    try {
      const response = await fetch(`${BASE_URL}/mf_trade_allocations`);
      const data = await response.json();

      if (!response.ok) {
        console.error("Error fetching MF trade allocations:", data);
        setMfTradeAllocations([]);
        return;
      }

      setMfTradeAllocations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching MF trade allocations:", error);
      setMfTradeAllocations([]);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
    // Fetch stored MF NAV history from DB.
    // Returns all rows grouped by schemecode:
    //   [{ symbol: schemecode, history: [{date, nav}] }]
    // This is the source of truth for current NAV (latest date) and
    // historical portfolio value reconstruction.
    const fetchMfNavHistory = async () => {
      try {
        const response = await fetch(`${BASE_URL}/prices/get_mf_nav`);
        if (!response.ok) {
          console.error("Failed to fetch MF NAV history");
          return;
        }
        const data = await response.json();
        setMfNavHistory(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error fetching MF NAV history:", error);
      }
    };
    // --------------------------------------------------------------------------

    // --------------------------------------------------------------------------
    // handleUpdateMFNavHistory
    //
    // FLOW:
    //   1. POST missing ranges to /prices/update_mf_nav → server returns 202
    //      immediately and starts a background job (sequential, with retries).
    //   2. Poll GET /prices/mf_nav_update_status every 3s until status = "done".
    //   3. On completion, re-fetch mf_nav_history from DB to update chart.
    //
    // Returns: { done, total, inserted, errors } for the button to display.
    // Throws on network/server error so the caller can set updating=false.
    const handleUpdateMFNavHistory = async (missingRanges, onProgress) => {
      if (!missingRanges || missingRanges.length === 0) {
        console.log("MF NAV: no missing ranges to fetch.");
        return { done: 0, total: 0, inserted: 0, errors: [] };
      }

      // 1. Start the background job
      const startRes = await fetch(`${BASE_URL}/prices/update_mf_nav`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(missingRanges),
      });

      if (startRes.status === 409) {
        // Another job is already running — still poll so the button shows progress
        console.warn("MF NAV: a job is already running, polling for its status.");
      } else if (!startRes.ok) {
        const err = await startRes.text();
        throw new Error(`Failed to start NAV update: ${err}`);
      }

      // 2. Poll until done
      const POLL_MS = 3000;
      while (true) {
        await new Promise(r => setTimeout(r, POLL_MS));

        const pollRes = await fetch(`${BASE_URL}/prices/mf_nav_update_status`);
        if (!pollRes.ok) continue; // transient error — keep polling

        const status = await pollRes.json();

        // Forward progress to button for live display
        if (onProgress) onProgress(status);

        if (status.status === "done" || status.status === "error") {
          // 3. Refresh local state from DB
          await fetchMfNavHistory();
          return status;
        }
        // status === "running" → keep polling
      }
    };
    // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Fetch stocks from backend when the app loads
  const fetchStocksTradeAllocations = async () => {
    try {
      const response = await fetch(`${BASE_URL}/stock_trade_allocations`);
      const data = await response.json();

      if (!response.ok) {
        console.error("Error fetching stocks trade allocations:", data);
        setStockTradeAllocations([]);
        return;
      }

      setStockTradeAllocations(Array.isArray(data) ? data : []); // Update the UI with stored stocks
    } catch (error) {
      console.error("Error fetching stocks trade allocations:", error);
      setStockTradeAllocations([]);
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Make all the initial data fetching calls when the app loads
  const fetchAllInitialData = async () => {
    setIsLoadingInitialData(true);
    try {
      await Promise.all([
        fetchStocks(),
        fetchStocksTradeAllocations(),
        fetchStockThesisData(),        // thesis records only (no price/scrip)

        fetchIndexPriceHistory(),
        fetchStockPriceHistory(),

        fetchMutualFunds(),
        fetchMutualFundsCurrentData(),
        fetchMfTradeAllocations(),
        fetchMfNavHistory(),

        fetchOtherAssets(),
        fetchInstruments()
      ]);
      
    } catch (error) {
      console.error("Error loading initial data:", error);
    } finally {
      setIsLoadingInitialData(false);
    }
  };
  // Call the initial data fetching functionas soon as the component mounts
  useEffect(() => {
    fetchAllInitialData();
  }, []);
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Helper: remaining qty for a specific buy order
  const getRemainingQty = (buyId, stocks, allocations) => {
    const buy = stocks.find(s => s.id === buyId);
    if (!buy) return 0;
    const allocsForBuy = allocations.filter(a => a.buy_order_id === buyId);
    const soldQty = allocsForBuy.reduce((sum, a) => sum + parseFloat(a.quantity || 0), 0);
    return buy.quantity - soldQty;
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const buildFifoAllocations = (stocks, sellTrade) => {
    const availableBuys = stocks
      .filter(s =>
        s.symbol === sellTrade.symbol &&
        s.order_type === "BUY" &&
        new Date(s.date) <= new Date(sellTrade.date), 
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    let remaining = sellTrade.quantity;
    const allocations = [];

    for (let buy of availableBuys) {
      if (remaining <= 0) break;

      const remainingQtyForBuy = getRemainingQty(buy.id, stocks, stockTradeAllocations);
      const allocQty = Math.min(remainingQtyForBuy, remaining);

      if (allocQty > 0) {
        allocations.push({
          buy_order_id: buy.id,
          quantity: allocQty
        });

        remaining -= allocQty;
      }
    }

    if (remaining > 0) {
      throw new Error("Insufficient BUY shares for FIFO sell.");
    }

    return allocations;
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Lot-based allocator (explicit BUY)
  const buildLotBasedAllocation = (buyTrade, sellTrade) => {
    if (sellTrade.quantity > buyTrade.remainingQty) {
      throw new Error(
        `Cannot sell more than remaining shares (${buyTrade.remainingQty})`
      );
    }

    return [{
      buy_order_id: buyTrade.id,
      quantity: sellTrade.quantity
    }];
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const persistSellWithAllocations = async (sellTrade, allocationBlueprint) => {

    // 1️⃣ Insert SELL
    const response = await fetch(`${BASE_URL}/stocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sellTrade),
    });

    if (!response.ok) {
      throw new Error("Failed to create SELL");
    }

    const createdSell = await response.json();

    // 2️⃣ Attach sell_order_id
    const allocations = allocationBlueprint.map(a => ({
      ...a,
      sell_order_id: createdSell.id
    }));

    // 3️⃣ Insert allocations
    const allocRes = await fetch(`${BASE_URL}/stock_trade_allocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocations }),
    });

    const data = await allocRes.json();

    if (!allocRes.ok) {
      throw new Error(data.error || "Failed to create allocations");
    }

    // 4️⃣ Update state
    setStockTradeAllocations(prev => [...prev, ...data.allocations]);
    setStocks(prev => [...prev, createdSell]);

    return createdSell;
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Modify handleAddStock so that:
  // ✅ The new stock is added to the existing stocks list.
  // ✅ It triggers re-aggregation immediately.
  const handleAddStock = async (newStock, options = {}) => {
    try {

      // BUY → simple insert
      if (newStock.order_type === "BUY") {
        const createdBuy = await stockService.createBuyOrder(newStock);
        setStocks(prev => [...prev, createdBuy]);
        return true;
      }

      // SELL
      if (newStock.order_type === "SELL") {

        let allocationBlueprint;

        // 🔵 LOT-BASED
        if (options.mode === "LOT") {
          allocationBlueprint = buildLotBasedAllocation(
            options.buyTrade,
            newStock
          );
        }

        // 🟢 FIFO
        else {
          allocationBlueprint = buildFifoAllocations(
            stocks,
            newStock
          );
        }

        await persistSellWithAllocations(
          newStock,
          allocationBlueprint
        );

        return true;
      }

      return false;

    } catch (error) {
      console.error("Error adding stock:", error);
      alert(error.message);
      return false;
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Function to update the price history in the database
  // for missing date ranges.
  // The backend will return the updated price history which will replace
  // the frontend price history state.
  const handleUpdatePriceHistory = async (missingStockRanges, missingIndexRanges) => {

    if (missingStockRanges.length === 0 && missingIndexRanges.length === 0) {
      console.log("No missing prices.");
      return;
    }

    const requests = [];

    // -------------------------
    // Stock price update
    // -------------------------

    if (missingStockRanges.length > 0) {
      requests.push(
        fetch(`${BASE_URL}/prices/update_stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(missingStockRanges)
        })
      );
    }

    // -------------------------
    // Index price update
    // -------------------------

    if (missingIndexRanges.length > 0) {
      requests.push(
        fetch(`${BASE_URL}/prices/update_indices`, {        // placeholder — update endpoint later
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(missingIndexRanges)
        })
      );
    }

    // -------------------------
    // Fire both in parallel
    // -------------------------

    const responses = await Promise.all(requests);

    const anyFailed = responses.some(r => !r.ok);
    if (anyFailed) {
      console.error("One or more price update requests failed");
      return;
    }

    // Refresh after both settle
    await fetchStockPriceHistory();
    await fetchIndexPriceHistory();

  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Delete MF trade allocation rows from backend
  const deleteMfAllocations = async (allocationIds) => {
    if (!allocationIds || allocationIds.length === 0) return true;
    try {
      const response = await fetch(`${BASE_URL}/mf_trade_allocations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation_ids: allocationIds }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error("Error deleting MF allocations:", err);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error deleting MF allocations:", error);
      return false;
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Update a single MF order (BUY or SELL) + optionally rebalance allocations.
  // Called by MFOrdersTable via onMFOrderUpdate.
  // options: { allocationsToUpdate?: [], allocationsToDelete?: [] }
  const handleMFOrderUpdate = async (orderData, options = {}) => {
    const { allocationsToUpdate = [], allocationsToDelete = [] } = options;
    let updatedAllocations = [...mfTradeAllocations];

    // 1️⃣ Delete allocation rows first (avoids constraint violations)
    if (allocationsToDelete.length > 0) {
      const ok = await deleteMfAllocations(allocationsToDelete);
      if (!ok) { alert("Failed to delete MF allocations."); return; }
      updatedAllocations = updatedAllocations.filter(
        a => !allocationsToDelete.includes(a.id)
      );
    }

    // 2️⃣ Update allocation rows
    if (allocationsToUpdate.length > 0) {
      try {
        const response = await fetch(`${BASE_URL}/mf_trade_allocations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allocations: allocationsToUpdate }),
        });
        if (!response.ok) {
          const txt = await response.text();
          throw new Error(txt || "Failed to update MF allocations.");
        }
        const updatedFromAPI = await response.json();
        const map = new Map(updatedAllocations.map(a => [a.id, a]));
        (Array.isArray(updatedFromAPI) ? updatedFromAPI : allocationsToUpdate)
          .forEach(a => map.set(a.id, a));
        updatedAllocations = Array.from(map.values());
      } catch (err) {
        console.error("Error updating MF allocations:", err);
        alert(err.message || "Failed to update MF allocations.");
        return;
      }
    }

    // 3️⃣ Update the order itself
    try {
      const updatedOrder = await mfService.updateOrder(orderData);
      if (!updatedOrder) throw new Error("Order update returned null.");

      setMutualFunds(prev =>
        prev.map(o => (o.id === updatedOrder.id ? updatedOrder : o))
      );
      setMfTradeAllocations(updatedAllocations);
    } catch (err) {
      console.error("Error updating MF order:", err);
      alert(err.message || "Failed to update order.");
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Delete a single MF order (BUY or SELL) + its linked allocations.
  // Called by MFOrdersTable via onMFOrderDelete.
  const handleMFOrderDelete = async (orderData) => {
    try {
      // Find and delete linked allocation rows first
      const linkedAllocIds = mfTradeAllocations
        .filter(
          a => a.buy_order_id === orderData.id || a.sell_order_id === orderData.id
        )
        .map(a => a.id);

      if (linkedAllocIds.length > 0) {
        const ok = await deleteMfAllocations(linkedAllocIds);
        if (!ok) { alert("Failed to delete linked MF allocations."); return; }
        setMfTradeAllocations(prev =>
          prev.filter(a => !linkedAllocIds.includes(a.id))
        );
      }

      // Delete the order itself
      await mfService.deleteOrder(orderData.id);

      setMutualFunds(prev => prev.filter(o => o.id !== orderData.id));

    } catch (err) {
      console.error("Error deleting MF order:", err);
      alert(err.message || "Failed to delete order.");
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Helper: remaining units for a specific MF buy order
  const getMFRemainingQty = (buyId, mfOrders, allocations) => {
    const buy = mfOrders.find(o => o.id === buyId);
    if (!buy) return 0;
    const soldQty = allocations
      .filter(a => a.buy_order_id === buyId)
      .reduce((sum, a) => sum + parseFloat(a.quantity), 0);
    return parseFloat(buy.quantity) - soldQty;
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // FIFO allocator for MF redemptions
  // Walks BUY lots (oldest first) for the same fund, consuming units greedily.
  const buildMFFifoAllocations = (mfOrders, redeemTrade) => {
    const availableBuys = mfOrders
      .filter(o =>
        o.symbol === redeemTrade.symbol &&
        o.order_type === "BUY" &&
        new Date(o.date) < new Date(redeemTrade.date)
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    let remaining = parseFloat(redeemTrade.quantity);
    
    const allocations = [];

    for (const buy of availableBuys) {
      
      if (remaining <= 0) break;
      const availableQty = getMFRemainingQty(buy.id, mfOrders, mfTradeAllocations);
      const allocQty = Math.min(availableQty, remaining);
      if (allocQty > 0) {
        allocations.push({ buy_order_id: buy.id, quantity: allocQty });
        remaining = Number((remaining - allocQty).toFixed(4));
      }
    }

    if (remaining > 0.0001) { // tolerance for float precision
      throw new Error("Insufficient units in BUY lots for FIFO redemption.");
    }

    return allocations;
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Lot-based allocator for MF redemptions (single explicit BUY lot)
  const buildMFLotBasedAllocation = (buyTrade, redeemTrade) => {
    const remainingQty = getMFRemainingQty(
      buyTrade.id, mutualFunds, mfTradeAllocations
    );
    if (parseFloat(redeemTrade.quantity) > remainingQty) {
      throw new Error(
        `Cannot redeem more than remaining units in this lot (${remainingQty.toFixed(3)}).`
      );
    }
    return [{ buy_order_id: buyTrade.id, quantity: parseFloat(redeemTrade.quantity) }];
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Persist a SELL (redemption) order + its allocation rows atomically
  const persistMFRedeemWithAllocations = async (redeemTrade, allocationBlueprint) => {

    // 1️⃣ Insert SELL order
    const response = await fetch(`${BASE_URL}/mutualfunds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(redeemTrade),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to create redemption order.");
    }

    const createdSell = await response.json();

    // 2️⃣ Attach sell_order_id to each allocation row
    const allocations = allocationBlueprint.map(a => ({
      ...a,
      sell_order_id: createdSell.id,
    }));

    // 3️⃣ Insert allocation rows
    const allocRes = await fetch(`${BASE_URL}/mf_trade_allocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocations }),
    });

    const allocData = await allocRes.json();

    if (!allocRes.ok) {
      throw new Error(allocData.error || "Failed to create MF allocations.");
    }

    // 4️⃣ Update local state
    setMfTradeAllocations(prev => [...prev, ...allocData.allocations]);
    setMutualFunds(prev => [...prev, createdSell]);

    return createdSell;
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // handleAddMF
  // BUY  → simple insert (unchanged)
  // SELL → two modes:
  //   options.mode === "LOT"  → lot-wise: allocate from options.buyTrade only
  //   (default)               → FIFO: consume oldest BUY lots first
  const handleAddMF = async (newMutualFund, options = {}) => {
    try {

      // BUY → simple insert
      if (newMutualFund.order_type === "BUY") {
        const createdBuy = await mfService.createBuyOrder(newMutualFund);
        setMutualFunds(prev => [...prev, createdBuy]);
        return true;
      }

      // SELL (redemption)
      if (newMutualFund.order_type === "SELL") {

        let allocationBlueprint;

        // 🔵 LOT-BASED — specific BUY lot provided by caller
        if (options.mode === "LOT") {
          allocationBlueprint = buildMFLotBasedAllocation(
            options.buyTrade,
            newMutualFund
          );
        }

        // 🟢 FIFO — walk oldest BUY lots automatically
        else {
          allocationBlueprint = buildMFFifoAllocations(
            mutualFunds,
            newMutualFund
          );
        }
        console.log("allocationBlueprint: ", allocationBlueprint);

        await persistMFRedeemWithAllocations(newMutualFund, allocationBlueprint);
        return true;
      }

      return false;

    } catch (error) {
      console.error("Error adding MF order:", error);
      alert(error.message);
      return false;
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Modify handleAddOA so that:
  // ✅ The new asset is added to the existing assets list.
  // ✅ It triggers re-aggregation immediately.
  const handleAddOA = (newAsset) => {
    setOtherAssets((prevAssets) => {
      const updatedOAs = [...prevAssets, newAsset];
      return updatedOAs;
    });
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Modify handleAddMF so that:
  // ✅ The new mutual fund is added to the existing mutual funds list.
  // ✅ It triggers re-aggregation immediately.
  const handleAddMFCurrentData = (newMFCurrentData) => {
    setCurrentMFData((prevMFCurrentData) => {
      const updatedMFsCurrentData = [...prevMFCurrentData, newMFCurrentData];
      return updatedMFsCurrentData;
    });
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const updateCurrentMFData = async (payload, API_name) => {
    // ✅ Check if array is valid
    if (!Array.isArray(payload) || payload.length === 0) {
      return false;
    };

    try {
      const response = await fetch(`${BASE_URL}/mutualfundscurrentdata/`, {
        method: API_name,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        alert(`${API_name}: Failed to add scheme code for Mutual Fund!`);
        return false;
      } else {
        return true;
      };

    } catch (error) {
      console.error("Error adding Mutual Fund:", error);
      return false;
    };
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const updateMFSchemeCode = async (fundName, newSchemeCode) => {
    // ✅ Check if fundName exists in currentMFData
    const existingFund = currentMFData.find(fund => fund.name === fundName);

    const updatedCurrentFund = {
      ...(existingFund || {}), // Keep existing data if available
      name: fundName,
      nav: existingFund?.nav ?? 0, // Ensure nav is always set (default to 0)
      schemecode: newSchemeCode,
      // Store empty string date if it does not exists
      date: existingFund?.date && !isNaN(Date.parse(existingFund.date))
        ? new Date(existingFund.date).toISOString().split("T")[0]
        : null, // Use null for invalid or missing dates
    };

    const API_name = existingFund ? "PUT" : "POST";
    const payload = [updatedCurrentFund,];

    // Edit entries from database
    // use .then to call async function
    updateCurrentMFData(payload, API_name)
      .then((success) => {
        if (success) {
          console.log("✅ Update successful!");
        } else {
          console.log("success: ", success);
          console.error("❌ Update failed!");
        }
      })
      .catch((error) => {
        console.error("🚨 Error in putCurrentMFData:", error);
      });

    // ✅ **Update React State**
    setCurrentMFData((prevData) => {
      if (existingFund) {
        // Update existing fund
        return prevData.map((fund) =>
          fund.name === existingFund.name ? { ...fund, schemecode: newSchemeCode } : fund
        );
      } else {
        // Add new fund
        return [...prevData, updatedCurrentFund];
      };
    });
  };
  // --------------------------------------------------------------------------
  // --- NAV ITEMS CONFIG ---
  const navItems = [
    { id: "summary", label: "Summary", icon: <LayoutDashboard /> },
    { id: "add", label: "Add Scrip", icon: <FaPlus /> },
    { id: "stock_portfolio", label: "Stocks", icon: <FaChartLine /> },
    { id: "mf_portfolio", label: "Mutual Funds", icon: <FaPiggyBank /> },
    { id: "asset_portfolio", label: "Other Assets", icon: <FaCoins /> },
    { id: "valuation_metrics", label: "Valuation", icon: <FaChartPie /> },
  ];

  // --------------------------------------------------------------------------
  // Component for the logo placeholder - UPDATED TO USE YOUR IMAGE
  const AppLogo = () => (
    <div className="flex items-center space-x-2">
      {/* Replaced the <Gem> icon with the imported <img>.
        Added w-8 h-8 to size the logo appropriately in the header.
      */}
      <img src={SanchayaBodhiLogo} alt="Sanchaya Bodhi Logo" className="w-8 h-8 object-contain" />
      <h1 className="text-(--text) transition-colors duration-300">
        Sanchaya-Bodhi
      </h1>
    </div>
  );
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Toggle mobile menu
  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;

      if (width < 640) {
        // mobile — use dropdown
        setNavMode("mobile");
        setIsMobileMenuOpen(false);
      } else if (width < 1150) {
        // compact — icons only
        setNavMode("compact");
        setIsMobileMenuOpen(false);
      } else {
        // full — icons + text
        setNavMode("full");
        setIsMobileMenuOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  // --------------------------------------------------------------------------

  return (
<div
  className="min-h-screen w-screen flex flex-col text-(--text) bg-(--bg) transition-colors duration-300 overflow-x-hidden"
>
  {/* 🌫️ Floating Glass Header */}
  <header
    className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] sm:w-[calc(100%-3rem)] lg:w-[80%] z-50
               bg-(--header-bg)/70 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.1)]
               transition-all duration-300 ease-in-out"
  >
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="flex items-center justify-between h-14">

        {/* 🌈 Logo + Title */}
        <div className="flex items-center gap-2 shrink-0">
          <img
            src={SanchayaBodhiLogo}
            alt="Sanchaya Bodhi Logo"
            className="w-10 h-10 object-contain"
          />
          <h1 className="text-xl font-bold bg-linear-to-r from-blue-500
              via-purple-600 to-pink-500 bg-clip-text text-transparent">
            Sanchay
          </h1>
        </div>

        {/* 🧭 Navigation & Theme Toggle */}
        <div className="flex items-center gap-2">

          {/* Nav Buttons — Full / Compact */}
          {(navMode === "full" || navMode === "compact") && (
            <nav className="flex items-center gap-2 sm:gap-3">
              {navItems.map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => {
                    setActiveTab(id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`relative nav-btn flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ease-out 
                    hover:bg-(--hover-bg) hover:scale-[1.03] backdrop-blur-md 
                    ${
                      activeTab === id
                        ? "active shadow-md bg-(--hover-bg)/50"
                        : ""
                    }`}
                >
                  <span className="text-lg">{icon}</span>
                  {/* Hide label in compact mode */}
                  <span
                    className={`transition-opacity duration-300 ${
                      navMode === "compact"
                        ? "opacity-0 w-0 overflow-hidden"
                        : "opacity-100"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              ))}
            </nav>
          )}

          {/* ☰ Mobile Menu Button */}
          {navMode === "mobile" && (
            <button
              onClick={toggleMobileMenu}
              aria-label="Toggle mobile menu"
              className="p-2 rounded-full hover:bg-(--hover-bg) transition-all duration-300"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6 animate-spin-in" />
              ) : (
                <Menu className="w-6 h-6 animate-spin-out" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  </header>

  {/* ⏳ Loading Indicator */}
  {isLoadingInitialData && (
    <div className="fixed top-20 right-4 bg-linear-to-r from-blue-500
        to-indigo-500 text-white px-6 py-3 rounded-full shadow-lg flex
        items-center gap-3 z-50 animate-fade-in backdrop-blur-sm border
        border-white/20">
      <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      <span className="font-medium">Loading Data...</span>
    </div>
  )}

  {/* 📱 Mobile Dropdown Menu */}
  {navMode === "mobile" && isMobileMenuOpen && (
    <div
      className="fixed top-20 left-4 right-4 bg-(--select-text)/20
        backdrop-blur-xl border border-(--border)/50 rounded-2xl
        shadow-lg animate-slide-down z-50"
      data-mobile-menu
    >
      <div className="flex flex-col p-4 space-y-2">
        {navItems.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id);
              setIsMobileMenuOpen(false);
            }}
            className={`nav-btn flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 hover:bg-(--hover-bg) ${
              activeTab === id ? "active bg-(--hover-bg)/40" : ""
            }`}
          >
            <span className="text-lg">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )}

  {/* 🧾 Main Content */}
  <main className="grow w-full pt-20 px-0 overflow-auto text-left">
    <div className="shadow-xl rounded-2xl px-6 bg-(--card-bg)/90 backdrop-blur-xl transition-all duration-300 animate-fade-in">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {activeTab === "summary" ? (
            <SummaryTab
              stockHoldingOrders={stockHoldingOrders}
              currentStockData={currentStockData}
              mfHoldingOrders={mfHoldingOrders}
              latestNAVMap={latestNAVMap}
              otherAssetsData={otherAssets}
              stockPortfolioSeries={stockPortfolioSeries}
              mfPortfolioSeries={mfPortfolioSeries}
            />
          ) : activeTab === "add" ? (
            <InputForm
              onAddStock={handleAddStock}
              onAddMutualFund={handleAddMF}
              onAddOtherAsset={handleAddOA}
              stockInstruments={stockInstruments}
              mutualFundInstruments={mutualFundInstruments}
            />
          ) : activeTab === "stock_portfolio" ? (
            <StockList
              stocks={stocks}
              stockTradeAllocations={stockTradeAllocations}
              priceHistory={stockPriceHistory}
              indexHistory={indexHistory}
              stockThesisData={stockThesisData}
              onThesisSaved={handleThesisSaved}
              holdingOrders={stockHoldingOrders}
              stockInstruments={stockInstruments}
              onOrdersEdit={handleStockOrderEdit}
              showAllocation={showAllocation}
              setShowAllocation={setShowAllocation}
              onSellStock={handleAddStock}
              onAllocationsEdit={handleAllocationsEdit}
              onUpdatePriceHistory={handleUpdatePriceHistory}
              portfolioSeries={stockPortfolioSeries}
            />
          ) : activeTab === "mf_portfolio" ? (
            <MutualFundList
              mutualFunds={mutualFunds}
              onOrdersEdit={handleMFOrderEdit}
              currentMFData={currentMFData}
              mutualFundInstruments={mutualFundInstruments}
              onCurrentDataDelete={handleCurrentMFDelete}
              onSchemeCodeUpdate={updateMFSchemeCode}
              onUpdateCurrentMFData={handleCurrentMFUpdate}
              showSummary={showMFSummary}
              setShowSummary={setShowMFSummary}
              mfTradeAllocations={mfTradeAllocations}
              onRedeemMF={handleAddMF}
              onMFOrderUpdate={handleMFOrderUpdate}
              onMFOrderDelete={handleMFOrderDelete}
              mfNavHistory={mfNavHistory}
              onUpdateMFNavHistory={handleUpdateMFNavHistory}
              indexHistory={indexHistory}
            />
          ) : activeTab === "asset_portfolio" ? (
            <OtherAssetList
              otherAssets={otherAssets}
              onOrdersEdit={handleOAOrderEdit}
              showSummary={showOASummary}
              setShowSummary={setShowOASummary}
            />
          ) : activeTab === "valuation_metrics" ? (
            <ValuationMetricsApp />
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  </main>

  <ScrollToTop /> {/* ✅ Smooth scroll button */}

  {/* 🪞 Glassmorphic Footer */}
  <footer className="w-full mt-10 py-4 border-t border-(--border)
      bg-(--bg)/30 backdrop-blur-lg text-center text-sm text-(--text)
      shadow-[0_0_20px_rgba(0,0,0,0.1)] transition-all duration-300">
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-5xl mx-auto px-4">

      <div className="flex items-center bg-(--card-light)
                      border border-(--border) rounded-lg p-0.5 ml-1">
        <button
          onClick={theme === "light" ? undefined : toggleTheme}
          title="Light mode"
          className={`relative flex items-center gap-2 p-1.5 rounded-md transition-all duration-200 ${
            theme === "light"
              ? "bg-white shadow-sm text-amber-500"
              : "text-(--text-muted) hover:text-(--text) hover:bg-(--hover-bg)"
          }`}
        >
          <Sun className="w-3.5 h-3.5" />
          <span className="text-xs font-medium hidden sm:inline">Light</span>
        </button>
        <button
          onClick={theme === "dark" ? undefined : toggleTheme}
          title="Dark mode"
          className={`relative flex items-center gap-2 p-1.5 rounded-md transition-all duration-200 ${
            theme === "dark"
              ? "bg-(--hover-bg) shadow-sm text-(--accent)"
              : "text-(--text-muted) hover:text-(--text) hover:bg-(--hover-bg)"
          }`}
        >
          <Moon className="w-3.5 h-3.5" />
          <span className="text-xs font-medium hidden sm:inline">Dark</span>
        </button>
      </div>

      <div className="text-xs sm:text-sm opacity-80">
        Built with ❤️ by{" "}
        <span className="font-semibold text-(--accent)">
          Satish Thorat
        </span>{" "}
        using <span className="font-medium">React</span> &{" "}
        <span className="font-medium">Tailwind</span>
      </div>

    </div>

    <div className="mt-3 text-xs text-(--text)/70">
      © {new Date().getFullYear()} All rights reserved.
    </div>
  </footer>
</div>

  );
};
// ============================================================================


export default Tabs;

