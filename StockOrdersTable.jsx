import React, { useState } from "react";
import { FiEdit2, FiTrash2, FiTag } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { FiX } from "react-icons/fi";
import * as stockService from "../../services/stockService";
import utils from "../../utils/utils";
import { formatNumber } from "../../utils/formats";

// ============================================================================
const StockOrdersTable = ({  stock, stockTradeAllocations, stockOrderLedger, 
    editingRowId, setEditingRowId, rowDraft, setRowDraft, onUpdateOrder,
    onDeleteOrder, onOpenSellOrder
    }) => {
  const formatDisplayDate = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value.split("T")[0];
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toISOString().split("T")[0];
  };

  // State for OrderEditCard modal
  const [editingTrade, setEditingTrade] = useState(null);
  const [tradeAllocations, setTradeAllocations] = useState([]);

  const [showEditCard, setShowEditCard] = useState(false);

  const [showSellCard, setShowSellCard] = useState(false);
  const [sellTrade, setSellTrade] = useState(null);

  const [showDeleteCard, setShowDeleteCard] = useState(false);
  const [deleteTrade, setDeleteTrade] = useState(null);
    
  // --------------------------------------------------------------------------
  // Update a single order via stockService
  const updateSingleOrder = async (orderData, options = {}) => {
    // Trigger parent callback to update state
    if (onUpdateOrder) {
      await onUpdateOrder(orderData, options);
    }
    
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Get allocations for a trade from the passed-in stockTradeAllocations
  const getTradeAllocations = (trade) => {
    
    if (trade.order_type === "BUY") {
      return stockTradeAllocations
        .filter((a) => a.buy_order_id === trade.id)
        .map((a) => {
          const sellTrade = stockOrderLedger.find((t) => t.id === a.sell_order_id);
          return {
            id: a.id,
            sell_date: sellTrade?.date || "",
            quantity: Number(a.quantity) || 0,
            sell_order_id: a.sell_order_id,
            buy_order_id: a.buy_order_id,
          };
        });
    }

    return stockTradeAllocations
      .filter((a) => a.sell_order_id === trade.id)
      .map((a) => {
        const buyTrade = stockOrderLedger.find((t) => t.id === a.buy_order_id);
        return {
          id: a.id,
          sell_order_id: a.sell_order_id,
          buy_order_id: buyTrade?.id || null,
          buy_date: buyTrade?.date || "",
          buy_price: Number(buyTrade?.price) || 0,
          quantity: Number(a.quantity) || 0,
          remainingQty: Number(buyTrade?.remainingQty) || 0,
        };
      });
  };
  // --------------------------------------------------------------------------
  const fetchTradeAllocations = async (trade) => {
    const allocations = await getTradeAllocations(trade);
    setTradeAllocations(allocations);
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Open delete card (trigger delete dialog with allocation check)
  const openDeleteCard = async (trade) => {
    setSellTrade(null);
    setEditingTrade(null);
    setDeleteTrade(trade);
    setTradeAllocations([]);
    setShowSellCard(false);
    setShowEditCard(false);
    setShowDeleteCard(true);
  };

  // Open Edit card
  const openEditCard = async (trade) => {
    setDeleteTrade(null);
    setSellTrade(null);
    setEditingTrade(trade);
    setTradeAllocations([]);
    setShowDeleteCard(false);
    setShowSellCard(false);
    setShowEditCard(true);
  };

  // Open Sell card
  const openSellCard = async (trade) => {
    setDeleteTrade(null);
    setEditingTrade(null);
    setSellTrade(trade);
    setTradeAllocations([]);
    setShowDeleteCard(false);
    setShowEditCard(false);
    setShowSellCard(true);
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Function to handle saving edits from OrderEditCard
  const handleEditSave = async (draft) => {
    
    try {
      if (!editingTrade) return;

      // Always re-fetch original trade from ledger projection
      const trade = stockOrderLedger.find(
        (t) => t.id === editingTrade.id
      );

      if (!trade) {
        alert("Trade not found.");
        return;
      }

      const originalQty = Number(trade.quantity);
      const newQty = Number(draft.quantity);

      const originalPrice = Number(trade.price);
      const newPrice = Number(draft.price);

      const originalDate = trade.date
        ? new Date(trade.date).toISOString()
        : null;

      const newDate = draft.date
        ? new Date(draft.date).toISOString()
        : null;

      const qtyChanged = newQty !== originalQty;
      const priceChanged = newPrice !== originalPrice;
      const dateChanged = originalDate !== newDate;

      if (!newQty || newQty <= 0) {
        alert("Quantity must be greater than 0.");
        return;
      }
      if (trade.order_type === "SELL" && newPrice <= 0) {
        alert("Price must be greater than 0 for a sell order.");
        return;
      }

      if (!qtyChanged && !priceChanged && !dateChanged) {
        setEditingTrade(null);
        return;
      } // No change, no action needed
      else if (!qtyChanged && (priceChanged || dateChanged)) {
        await updateSingleOrder(draft);
        setEditingTrade(null);
        return;
      } // No change, no action needed

      // =====================================================
      // BUY VALIDATION
      // =====================================================
      if (trade.order_type === "BUY") {

        // remainingQty is derived in stockOrderLedger
        const remainingQty = Number(trade.remainingQty || 0);

        const allocatedQty = originalQty - remainingQty;

        // Cannot reduce below already allocated shares
        if (newQty < allocatedQty) {
          alert(
            `Cannot reduce BUY below allocated quantity (${allocatedQty}).`
          );
          return;
        }
        // Increasing BUY is always allowed

      // PASSED VALIDATION → PROCEED
      // Update the order itself
      await updateSingleOrder(draft);
      }

      // =====================================================
      // SELL VALIDATION (Lot-Scoped)
      // =====================================================
      if (trade.order_type === "SELL") {

        const delta = newQty - originalQty;

        // Only consider BUY lots linked to this SELL
        const allocations = getTradeAllocations(trade);

        let allocationsToUpdate = [];
        let allocationsToDelete = [];

        // =====================================================
        // INCREASE SELL (delta > 0)
        // =====================================================
        if (delta > 0) {
          // 1. Extract buy order ids
          const allocationIds = new Set(
            allocations.map(a => a.buy_order_id)
          );
          const allocationMap = new Map(
            allocations.map(a => [a.buy_order_id, a])
          );

          // 2. Get matching buy trades
          const matchingBuyOrders = stockOrderLedger.filter(
            trade => allocationIds.has(trade.id)
          );

          // 4. Calculate allowed expansion
          const allowedExpansion = matchingBuyOrders.reduce(
            (sum, trade) => sum + Number(trade.remainingQty || 0),
            0
          );

          const maxAllowed = originalQty + allowedExpansion;

          if (newQty > maxAllowed) {
            alert(
              `Cannot increase SELL beyond available shares in linked BUY lots.
              Max allowed: ${maxAllowed}`
            );
            return;
          }

          // 3. Sort by date (oldest first)
          matchingBuyOrders.sort(
            (a, b) => new Date(a.date) - new Date(b.date)
          );

          let remainingToAllocate = delta;
          for (const buyOrder of matchingBuyOrders) {
            if (remainingToAllocate <= 0) break;

            const available = Number(buyOrder.remainingQty || 0);
            if (available <= 0) continue;

            const incrementQty = Math.min(available, remainingToAllocate);
            remainingToAllocate -= incrementQty;

            const existingAllocation = allocationMap.get(buyOrder.id);            

            const previousQty = existingAllocation
              ? Number(existingAllocation.quantity)
              : 0;

            const updatedQty = previousQty + incrementQty;

            allocationsToUpdate.push({
              id: existingAllocation.id,
              buy_order_id: existingAllocation.buy_order_id,
              sell_order_id: existingAllocation.sell_order_id,
              quantity: updatedQty
            });
            // allocationsToUpdate.push({
            //   ...existingAllocation,
            //   quantity: updatedQty
            // });
          }

          if (remainingToAllocate > 0) {
            alert("Unexpected allocation mismatch.");
            return;
          }
        }
        // =====================================================
        // REDUCE SELL (delta < 0)
        // =====================================================
        if (delta < 0) {

          let remainingToReduce = Math.abs(delta);          

          // Get allocations only for this SELL order.
          // FIX #7 — allocations from getTradeAllocations(SELL) expose `buy_date`,
          // NOT `date`. Sorting on `.date` produced Invalid Date on both sides →
          // NaN comparator → no sort (release order was undefined). Sort by
          // `buy_date` descending to release newest BUY lots first (matches the
          // working MF side).
          const sellAllocations = allocations
            .sort((a, b) => new Date(b.buy_date) - new Date(a.buy_date));

          for (const allocation of sellAllocations) {
            if (remainingToReduce <= 0) break;

            const currentQty = Number(allocation.quantity);            
            if (currentQty <= remainingToReduce) {
              // Delete entire allocation
              remainingToReduce -= currentQty;
              allocationsToDelete.push(allocation.id);
              
            } else {
              // Partially reduce allocation
              allocationsToUpdate.push({
                ...allocation,
                quantity: currentQty - remainingToReduce
              });
              console.log("Updating allocation quantity to:", currentQty - remainingToReduce);
              
              remainingToReduce = 0;
            }
          }

          if (remainingToReduce > 0) {
            alert("Unexpected allocation mismatch while reducing SELL.");
            return;
          }
        }

        // =====================================================
        // COMMIT CHANGES (allocations first, then order)
        // =====================================================
        // PASSED VALIDATION → PROCEED for Sell Order update
        // Update the order itself

        
        await updateSingleOrder(draft, { allocationsToUpdate,
                        allocationsToDelete});
      }

      setEditingTrade(null);

    } catch (err) {
      console.error("Failed to save edit:", err);
      alert("Failed to save changes.");
    }
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Function to handle creating sell order from SellInlineCard
  const handleSellSave = async (draft) => {
    try {

      if (!sellTrade) return;

      const newQty = Number(draft.quantity);
      if (!newQty || newQty <= 0) {
        alert("Quantity must be greater than 0.");
        return;
      }

      // Always derive fresh BUY lot from projection
      const buyTrade = stockOrderLedger.find(
        (t) => t.id === sellTrade.id
      );

      if (!buyTrade) {
        alert("Buy order not found.");
        return;
      }

      const remainingQty = Number(buyTrade.remainingQty || 0);

      // Core constraint:
      // Cannot sell more than remaining shares in this lot
      if (newQty > remainingQty) {
        alert(
          `Cannot sell more than remaining shares in this lot (${remainingQty}).`
        );
        return;
      }

      // Optional: price sanity check
      if (!draft.price || Number(draft.price) <= 0) {
        alert("Price must be greater than 0.");
        return;
      }

      // Passed validation → proceed
      await onOpenSellOrder(
        {
          name: buyTrade.name,
          symbol: buyTrade.symbol,
          order_type: "SELL",
          date: draft.date,
          quantity: draft.quantity,
          price: draft.price
        },
        {
          mode: "LOT",
          buyTrade
        }
      );

      setShowSellCard(false);
      setSellTrade(null);

    } catch (err) {
      alert(err.message || "Failed to create sell");
    }
  };

  // --------------------------------------------------------------------------
  // Handle delete order (after allocation check)
  const handleDeleteOrder = async (trade) => {
    if (onDeleteOrder) {
      await onDeleteOrder(trade); // send as array for consistency
    }

    setShowDeleteCard(false);
    setDeleteTrade(null);
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const OrderEditCard = ({ trade, onSave, onCancel }) => {
    const [draft, setDraft] = useState({
      id: trade.id,
      name: trade.name,
      symbol: trade.symbol,
      date: formatDisplayDate(trade.date),
      quantity: trade.quantity,
      price: trade.price,
      order_type: trade.order_type,
      buyingthought: trade.buyingthought || "",
      links: trade.links || []
    });

    const allocations = getTradeAllocations(trade);
    const isBuy = trade.order_type === "BUY";

    const allocatedQty =
      isBuy
        ? trade.quantity - trade.remainingQty
        : null;

    return (
      <div className="p-4 rounded-xl border bg-(--card) shadow-lg border-(--border-light) mb-4">
        <button
          onClick={onCancel}
          className="absolute top-2 right-2 p-1 rounded-md
                    hover:bg-red-950 transition"
        >
          <FiX size={16} />
        </button>
        <h4 className="font-semibold mb-3 text-lg">
          EDIT {trade.order_type} TRADE
        </h4>

        {/* Editable Fields */}
        <div className="grid grid-cols-3 gap-4 mb-4">

          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={draft.date}
              onChange={(e) =>
                setDraft({ ...draft, date: e.target.value })
              }
              className="border rounded filter-blue px-2 py-1 w-full bg-(--bg)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Quantity</label>
            <input
              type="number"
              value={draft.quantity}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  quantity: parseInt(e.target.value) || 0,
                })
              }
              className="border rounded px-2 py-1 w-full bg-(--bg)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Price</label>
            <input
              type="number"
              step="0.01"
              value={draft.price}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  price: parseFloat(e.target.value) || 0,
                })
              }
              className="border rounded px-2 py-1 w-full bg-(--bg)"
            />
          </div>

        </div>

        {/* Warning */}
        <div className="text-sm text-yellow-600 mb-3 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
          ⚠ Editing will trigger full reallocation for this stock.
        </div>

        {/* Allocation Breakdown */}
        <div className="bg-(--bg) p-3 rounded mb-4 text-sm border border-(--border-light)">
          {isBuy ? (
            <>
              <div className="font-medium mb-2">Allocated Out:</div>

              {allocatedQty > 0 ? (
                <>
                  {allocations?.map((a, idx) => (
                    <div key={idx} className="ml-2">
                      SELL {formatDisplayDate(a.sell_date)} → {a.quantity} shares
                    </div>
                  ))}
                  <div className="mt-2 font-medium">
                    Remaining: {trade.remainingQty}
                  </div>
                </>
              ) : (
                <div>No allocations yet.</div>
              )}
            </>
          ) : (
            <>
              <div className="font-medium mb-2">Allocated From:</div>

              {allocations && allocations.length > 0 ? (
                allocations.map((a, idx) => (
                  <div key={idx} className="ml-2">
                    BUY {formatDisplayDate(a.buy_date)} | Qty: {a.quantity} | Buy ₹{a.buy_price}
                  </div>
                ))
              ) : (
                <div>No allocation data.</div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            onClick={() => onSave(draft)}
          >
            Save
          </button>

          <button
            className="px-4 py-1.5 bg-gray-400 text-white rounded hover:bg-gray-500 transition"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>

      </div>
    );
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const SellInlineCard = ({ buyTrade, onSave, onCancel }) => {
    const [draft, setDraft] = useState({
      date: new Date().toISOString().split("T")[0],
      quantity: 0,
      price: buyTrade.price || 0
    });

    const allocations = getTradeAllocations(buyTrade);
    const allocatedQty = buyTrade.quantity - buyTrade.remainingQty;

    return (
      <div className="p-4 rounded-xl border bg-(--card) shadow-lg border-(--border-light) mb-4">
        <button
          onClick={onCancel}
          className="absolute top-2 right-2 p-1 rounded-md 
          hover:bg-red-950 transition"
        >
          <FiX size={16} />
        </button>

        <h4 className="font-semibold mb-3 text-lg">CREATE SELL ORDER</h4>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              className="border rounded filter-blue px-2 py-1 w-full bg-(--bg)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Quantity</label>
            <input
              type="number"
              min="1"
              max={buyTrade.remainingQty}
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: parseInt(e.target.value) || 0 })}
              className="border rounded px-2 py-1 w-full bg-(--bg)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Price</label>
            <input
              type="number"
              step="0.01"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: parseFloat(e.target.value) || 0 })}
              className="border rounded px-2 py-1 w-full bg-(--bg)"
            />
          </div>
        </div>

        <div className="text-sm text-yellow-600 mb-3 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
          Available to sell: <strong>{buyTrade.remainingQty}</strong> (Allocated out: {allocatedQty})
        </div>

        <div className="bg-(--bg) p-3 rounded mb-4 text-sm border border-(--border-light)">
          <div className="font-medium mb-2">Existing Allocations:</div>
          {allocations && allocations.length > 0 ? (
            allocations.map((a, idx) => (
              <div key={idx} className="ml-2">SELL {formatDisplayDate(a.sell_date)} → {a.quantity} shares</div>
            ))
          ) : (
            <div>No allocations yet.</div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            className="px-4 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
            onClick={() => onSave(draft)}
          >
            Create Sell
          </button>

          <button
            className="px-4 py-1.5 bg-gray-400 text-white rounded hover:bg-gray-500 transition"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  const DeleteCard = ({ trade, onConfirmDelete, onCancel }) => {

    const allocations = getTradeAllocations(trade);

    // Only restrict deletion for BUY orders with allocations
    const hasAllocations = allocations && allocations.length > 0 && trade.order_type === "BUY";

    return (
      <div className="p-4 rounded-xl border bg-(--card) shadow-lg border-(--border-light) mb-4">
        <button
          onClick={onCancel}
          className="absolute top-2 right-2 p-1 rounded-md hover:bg-red-950 transition"
        >
          <FiX size={16} />
        </button>

        <h4 className="font-semibold mb-3 text-lg">
          DELETE {trade.order_type} ORDER
        </h4>

        {hasAllocations ? (
          <>
            <div className="text-sm text-red-600 mb-3 bg-red-50 dark:bg-red-900/20 p-3 rounded">
              ⚠ <strong>Cannot Delete:</strong> This BUY order has following allocations linked to it. Please remove the allocations first before deleting.
            </div>

            <div className="bg-(--bg) p-3 rounded mb-4 text-sm border border-(--border-light)">
              <div className="font-medium mb-2">Existing Allocations:</div>
              {allocations.map((a, idx) => (
                <div key={idx} className="ml-2">
                  SELL {formatDisplayDate(a.sell_date)} → {a.quantity} shares
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                className="px-4 py-1.5 bg-gray-400 text-white rounded hover:bg-gray-500 transition"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-yellow-600 mb-3 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
              Are you sure you want to delete this {trade.order_type} order for <strong>{trade.symbol}</strong> dated <strong>{formatDisplayDate(trade.date)}</strong>?
            </div>

            <div className="bg-(--bg) p-3 rounded mb-4 text-sm border border-(--border-light)">
              {allocations && allocations.length > 0 && trade.order_type === "SELL" && (
                <div className="mt-3">
                  <div className="font-medium mb-2">Associated Allocations (for info):</div>
                    {allocations && allocations.length > 0 ? (
                      allocations.map((a, idx) => (
                        <div key={idx} className="ml-2">SELL {formatDisplayDate(a.sell_date)} → {a.quantity} shares</div>
                      ))
                    ) : (
                      <div>No allocations yet.</div>
                    )}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                className="px-4 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 transition"
                onClick={() => onConfirmDelete(trade)}
              >
                Delete Order
              </button>

              <button
                className="px-4 py-1.5 bg-gray-400 text-white rounded hover:bg-gray-500 transition"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    );
  };
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  return (
    <div className="p-0">
    {/* Orders Table */}
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm border-separate
          border-spacing-y-1">
        <thead className="bg-(--table-header) text-(--text-muted)">
          <tr>
            <th className="px-2.5 py-1 text-center rounded-tl-md">Type</th>
            <th className="px-2.5 py-1 text-center">Price</th>
            <th className="px-2.5 py-1 text-center">Qty</th>
            <th className="px-2.5 py-1 text-center">Total</th>
            <th className="px-2.5 py-1 text-center">Date</th>
            <th className="px-2.5 py-1 text-center">Details</th>
            <th className="px-2.5 py-1 text-center rounded-tr-md">Actions</th>
          </tr>
        </thead>

        <tbody>
          {stockOrderLedger
            .filter((order) => order.symbol === stock.symbol)
            .map((trade, index) => {
              const isEditing = editingRowId === trade.id;
              
              return (
                <React.Fragment key={trade.id}>
                  <tr
                    className={`transition-colors ${
                      index % 2 === 0
                        ? "bg-(--table-row2)"
                        : "bg-(--table-row1)"
                    } hover:bg-(--hover-bg)`}
                  >

                  <td
                    className={` rounded-l-lg text-center px-2.5 py-1 font-medium ${
                      trade.order_type === "BUY"
                        ? "text-(--gain)"
                        : "text-(--loss)"
                    }`}
                  >
                    {trade.order_type}
                  </td>

                  <td className="text-center px-2.5 py-1">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={rowDraft.price}
                        onChange={(e) =>
                          setRowDraft({
                            ...rowDraft,
                            price: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="border rounded px-2.5 py-1 w-24 text-center"
                      />
                    ) : (
                      trade.price
                    )}
                  </td>

                  <td className="text-center px-2.5 py-1">
                    {isEditing ? (
                      <input
                        type="number"
                        min="1"
                        value={rowDraft.quantity}
                        onChange={(e) =>
                          setRowDraft({
                            ...rowDraft,
                            quantity: parseInt(e.target.value) || 0,
                          })
                        }
                        className="border rounded px-2.5 py-1 w-20 text-center"
                      />
                    ) : (
                      trade.quantity
                    )}
                  </td>

                  <td className="text-center px-2.5 py-1">
                    {(trade.quantity * trade.price).toFixed(2)}
                  </td>

                  {/* DATE */}
                  <td className="text-center px-2.5 py-1">
                    {isEditing ? (
                      <input
                        type="date"
                        value={rowDraft.date}
                        onChange={(e) =>
                          setRowDraft({ ...rowDraft, date: e.target.value })
                        }
                        className="border rounded filter-blue px-2.5 py-1"
                      />
                    ) : (
                      formatDisplayDate(trade.date)
                    )}
                  </td>

                  <td className="text-center px-2.5 py-1">
                    {trade.order_type === "BUY" && (
                      <span>Remaining: {trade.remainingQty}</span>
                    )}

                    {trade.order_type === "SELL" && (
                      <span
                        className={`align-middle rounded-r-lg
                                    ${utils.getPerformanceColorClass(trade.realizedPnL)}`}
                      >
                        P/L: {formatNumber(trade.realizedPnL)}
                      </span>
                    )}
                  </td>

                  {/* ACTIONS */}
                  <td className="text-center px-1 py-0 rounded-r-lg">
                    <div className="flex items-center justify-center gap-0">
                      
                      {/* EDIT */}
                      <button
                        title="Edit Order"
                        className="p-0 text-(--text-muted)
                      hover:bg-blue-500/10 hover:text-blue-600
                        transition-colors"
                        onClick={() => openEditCard(trade)}
                      >
                        <FiEdit2 size={14} />
                      </button>

                      {/* Divider */}
                      <div className="w-px h-4 bg-(--text-3)" />

                      {/* DELETE */}
                      <button
                        title="Delete Order"
                        className="p-0 text-(--text-muted)
                        hover:bg-red-500/10 hover:text-red-600
                          transition-colors"
                        onClick={() => openDeleteCard(trade)}
                      >
                        <FiTrash2 size={14} />
                      </button>

                      {trade.order_type === "BUY" && (
                        <>
                        {/* Divider */}
                        <div className="w-px h-4 bg-(--text-3)" />

                        {/* Sell Button */}
                        <button
                          title="Sell Order"
                          className="p-0 text-(--text-muted)
                          hover:bg-emerald-500/10 hover:text-emerald-600
                            transition-colors"
                          onClick={() => openSellCard(trade)}
                        >
                          <FiTag size={14} />
                        </button>
                        </>
                      )}
                    </div>
                  </td>
                  </tr>

                  <AnimatePresence mode="wait">
                    {sellTrade?.id === trade.id && showSellCard && (
                      <motion.tr
                        key={`sell-row-${trade.id}`}
                        initial={{ opacity: 0, y: -10, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -10, height: 0 }}
                        transition={{
                          exit: { duration: 0.2 },
                          enter: { duration: 0.3, delay: 0.2 }
                        }}
                        className="relative overflow-hidden p-3 rounded-xl
                        bg-(--card) border border-(--border-light)"
                      >
                        <td colSpan="7" className="p-0 border-0">
                          <SellInlineCard
                            buyTrade={sellTrade}
                            onSave={async (draft) => {
                              await handleSellSave(draft);
                            }}
                            onCancel={() => {
                              setShowSellCard(false);
                              setSellTrade(null);
                            }}
                          />
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>

                  <AnimatePresence mode="wait">
                    {editingTrade?.id === trade.id && (
                      <motion.tr
                            key="expanded-row"
                            initial={{ opacity: 0, y: -10, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: "auto" }}
                            exit={{ opacity: 0, y: -10, height: 0 }}
                            transition={{
                              exit: { duration: 0.2 },
                              enter: { duration: 0.3, delay: 0.2 }
                            }}
                            className="relative overflow-hidden p-3 rounded-xl bg-(--card)
                                      border border-(--border-light)"
                        >
                        <td colSpan="7" className="p-0 border-0">
                              <OrderEditCard
                                trade={editingTrade}
                                onSave={async (draft) => {
                                  await handleEditSave(draft);
                                }}
                                onCancel={() => setEditingTrade(null)}
                              />
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>

                  <AnimatePresence mode="wait">
                    {deleteTrade?.id === trade.id && showDeleteCard && (
                      <motion.tr
                        key={`delete-row-${trade.id}`}
                        initial={{ opacity: 0, y: -10, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -10, height: 0 }}
                        transition={{
                          exit: { duration: 0.2 },
                          enter: { duration: 0.3, delay: 0.2 }
                        }}
                        className="relative overflow-hidden p-3 rounded-xl bg-(--card) border border-(--border-light)"
                      >
                        <td colSpan="7" className="p-0 border-0">
                          <DeleteCard
                            trade={deleteTrade}
                            onConfirmDelete={async (t) => {
                              await handleDeleteOrder(t);
                            }}
                            onCancel={() => {
                              setShowDeleteCard(false);
                              setDeleteTrade(null);
                            }}
                          />
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
    </div>
  );
};
// --------------------------------------------------------------------------
// ============================================================================

export default StockOrdersTable;
