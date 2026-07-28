// ============================================================================
// InstrumentsTab.jsx
// ----------------------------------------------------------------------------
// Instrument Master Sync UI.
//   1. "Fetch & Preview"  → POST /instruments/sync/preview (read-only).
//   2. Review two sections (New / Enrich existing), toggle rows.
//   3. "Commit Selected"  → POST /instruments/sync/commit  (writes selected).
//
// Scope: EQ only. New symbols come from NSE EQUITY_L.csv (SERIES=EQ, SME
// excluded). scrip_code is resolved from BSE (active main-board) by ISIN.
// No delisted entities enter the table (active-only source feeds).
// ============================================================================
import React, { useMemo, useState } from "react";
import { FaDatabase, FaSync, FaCheck } from "react-icons/fa";
import {
  previewInstrumentSync,
  commitInstrumentSync,
} from "../../services/instrumentService";

// ----------------------------------------------------------------------------
const StatPill = ({ label, value }) => (
  <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-(--hover-bg)/40 border border-(--border)/50 min-w-[90px]">
    <span className="text-lg font-bold text-(--accent)">{value}</span>
    <span className="text-xs text-(--text-muted)">{label}</span>
  </div>
);

// ----------------------------------------------------------------------------
// Reusable selectable table for both "add" and "enrich" sections.
const SyncTable = ({ title, rows, selected, onToggle, onToggleAll, emptyMsg }) => {
  const allSelected = rows.length > 0 && selected.size === rows.length;

  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <h3 className="font-semibold text-(--text) mb-2">{title}</h3>
        <p className="text-sm text-(--text-muted) italic">{emptyMsg}</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-(--text)">
          {title}{" "}
          <span className="text-(--text-muted) font-normal">
            ({selected.size}/{rows.length} selected)
          </span>
        </h3>
        <button
          onClick={onToggleAll}
          className="text-xs px-3 py-1 rounded-full border border-(--border)/60 hover:bg-(--hover-bg) transition"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>

      <div className="overflow-auto max-h-[420px] rounded-xl border border-(--border)/50">
        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 bg-(--card-bg)/95 backdrop-blur">
            <tr className="text-(--text-muted)">
              <th className="px-3 py-2 w-10"></th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">ISIN</th>
              <th className="px-3 py-2">BSE Scrip</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSel = selected.has(r.symbol);
              return (
                <tr
                  key={r.symbol}
                  onClick={() => onToggle(r.symbol)}
                  className={`cursor-pointer border-t border-(--border)/30 hover:bg-(--hover-bg)/40 ${
                    isSel ? "bg-(--hover-bg)/30" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={isSel}
                      readOnly
                      className="accent-(--accent)"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-(--text)">
                    {r.symbol}
                  </td>
                  <td className="px-3 py-2 text-(--text-muted)">{r.name}</td>
                  <td className="px-3 py-2 text-(--text-muted)">
                    {r.isin || "—"}
                  </td>
                  <td className="px-3 py-2 text-(--text-muted)">
                    {r.scrip_code || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
const InstrumentsTab = ({ onCommitted }) => {
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState(null); // { stats, toAdd, toEnrich }
  const [result, setResult] = useState(null); // { added, enriched }

  const [selAdd, setSelAdd] = useState(new Set());
  const [selEnrich, setSelEnrich] = useState(new Set());

  const toAdd = preview?.toAdd || [];
  const toEnrich = preview?.toEnrich || [];

  const canCommit = useMemo(
    () => selAdd.size > 0 || selEnrich.size > 0,
    [selAdd, selEnrich]
  );

  // --- preview -------------------------------------------------------------
  const handlePreview = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await previewInstrumentSync();
      setPreview(data);
      // Default: pre-select everything addable/enrichable (user can trim).
      setSelAdd(new Set(data.toAdd.map((r) => r.symbol)));
      setSelEnrich(new Set(data.toEnrich.map((r) => r.symbol)));
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to preview instrument sync");
    } finally {
      setLoading(false);
    }
  };

  // --- selection toggles ---------------------------------------------------
  const toggle = (setFn) => (symbol) =>
    setFn((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });

  const toggleAll = (setFn, rows) => () =>
    setFn((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.symbol))
    );

  // --- commit --------------------------------------------------------------
  const handleCommit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    try {
      const payload = {
        toAdd: toAdd.filter((r) => selAdd.has(r.symbol)),
        toEnrich: toEnrich.filter((r) => selEnrich.has(r.symbol)),
      };
      const res = await commitInstrumentSync(payload);
      setResult(res);
      setPreview(null);
      setSelAdd(new Set());
      setSelEnrich(new Set());
      if (typeof onCommitted === "function") await onCommitted(); // refresh parent
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to commit instrument sync");
    } finally {
      setCommitting(false);
    }
  };

  const s = preview?.stats;

  return (
    <div className="py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <FaDatabase className="text-xl text-(--accent)" />
        <h2 className="text-xl font-bold text-(--text)">Instrument Master</h2>
      </div>
      <p className="text-sm text-(--text-muted) max-w-2xl mb-4">
        Sync equity instruments from NSE (active, SERIES=EQ) and resolve BSE
        scrip codes by ISIN. Delisted and SME scrips are excluded. Preview is
        read-only; nothing is written until you commit.
      </p>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handlePreview}
          disabled={loading || committing}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-(--accent) text-white font-medium hover:opacity-90 disabled:opacity-50 transition"
        >
          <FaSync className={loading ? "animate-spin" : ""} />
          {loading ? "Fetching…" : "Fetch & Preview"}
        </button>

        {preview && (
          <button
            onClick={handleCommit}
            disabled={!canCommit || committing}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-600 text-white font-medium hover:opacity-90 disabled:opacity-40 transition"
          >
            <FaCheck />
            {committing
              ? "Committing…"
              : `Commit Selected (${selAdd.size + selEnrich.size})`}
          </button>
        )}
      </div>

      {/* Post-commit result */}
      {result && (
        <div className="mt-4 px-4 py-3 rounded-xl bg-green-600/15 border border-green-500/40 text-sm text-(--text)">
          ✅ Sync complete — <b>{result.added}</b> added,{" "}
          <b>{result.enriched}</b> enriched.
        </div>
      )}

      {/* Stats */}
      {s && (
        <div className="flex flex-wrap gap-3 mt-5">
          <StatPill label="NSE EQ" value={s.nseEqCount} />
          <StatPill label="BSE ISINs" value={s.bseIsinCount} />
          <StatPill label="In DB" value={s.existingEq} />
          <StatPill label="Addable" value={s.addable} />
          <StatPill label="Enrichable" value={s.enrichable} />
        </div>
      )}

      {s && !s.bseAvailable && (
        <div className="mt-3 px-4 py-2 rounded-xl bg-yellow-500/15 border border-yellow-500/40 text-xs text-(--text)">
          ⚠️ BSE feed unavailable this run — scrip codes will be blank. Re-run
          later to backfill them (existing data is never overwritten).
        </div>
      )}

      {/* Tables */}
      {preview && (
        <>
          <SyncTable
            title="New instruments to add"
            rows={toAdd}
            selected={selAdd}
            onToggle={toggle(setSelAdd)}
            onToggleAll={toggleAll(setSelAdd, toAdd)}
            emptyMsg="Nothing new — DB is already in sync with NSE EQ list."
          />
          <SyncTable
            title="Existing instruments to enrich (ISIN / BSE scrip)"
            rows={toEnrich}
            selected={selEnrich}
            onToggle={toggle(setSelEnrich)}
            onToggleAll={toggleAll(setSelEnrich, toEnrich)}
            emptyMsg="No existing rows need ISIN / scrip-code backfill."
          />
        </>
      )}
    </div>
  );
};

export default InstrumentsTab;
