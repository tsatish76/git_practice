const express = require("express");
const router = express.Router();
const pool = require("../database");
const {
  refreshFundamentals,
  refreshTechnicals,
} = require("./stockIndicatorService");

// ============================================================================
// stockscurrentdata — thesis + indicator layer (symbol-keyed).
// Post scrip-code removal this table no longer holds price/exchange/scrip:
//   - holdings price comes from stock_price_history
//   - name/fullname come from instruments
//   - this table = thesis + fundamental/technical indicators, keyed by symbol
// ============================================================================

// ── column groups (single source of truth for SELECT / UPSERT) ──────────────
const FUND_COLS = [
  "pe_ratio", "forward_pe", "pb_ratio", "peg_ratio", "market_cap",
  "market_cap_category", "roe", "debt_to_equity", "operating_margin",
  "profit_margin", "eps_ttm", "revenue_growth_yoy", "profit_growth_yoy",
  "margin_trend", "margin_history", "profit_growth_trend",
  "profit_growth_history", "analyst_target",
];
const TECH_COLS = [
  "current_price", "prev_close", "day_change_pct", "week52_high", "week52_low",
  "dma_50", "dma_200", "avg_volume", "rsi_14", "beta",
];
const JSON_COLS = new Set(["margin_history", "profit_growth_history"]);

// ----------------------------------------------------------------------------
// GET /  — full current-data snapshot (thesis + all indicators), by symbol.
// ----------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const query = `
      SELECT id, symbol,
             thesis_markdown, thesis_last_updated,
             fundamentals_updated_at, technicals_updated_at,
             ${FUND_COLS.join(", ")},
             analyst_target_manual,
             ${TECH_COLS.join(", ")}
      FROM stockscurrentdata
      ORDER BY symbol;
    `;
    const result = await pool.query(query);
    const rows = result.rows.map((r) => ({
      ...r,
      thesis_last_updated: r.thesis_last_updated
        ? new Date(r.thesis_last_updated).toISOString()
        : null,
      fundamentals_updated_at: r.fundamentals_updated_at
        ? new Date(r.fundamentals_updated_at).toISOString()
        : null,
      technicals_updated_at: r.technicals_updated_at
        ? new Date(r.technicals_updated_at).toISOString()
        : null,
    }));
    res.json(rows);
  } catch (error) {
    console.error("❌ Error fetching stocks current data:", error);
    res.status(500).json({ error: "Failed to fetch stocks current data." });
  }
});

// ----------------------------------------------------------------------------
// Held-symbol resolver: BUY qty > sold qty (via allocations). Deterministic,
// mirrors the frontend getHoldingOrders semantics in SQL.
// ----------------------------------------------------------------------------
async function getHeldSymbols(client) {
  const q = `
    SELECT s.symbol
    FROM stocks s
    WHERE s.order_type = 'BUY'
    GROUP BY s.symbol
    HAVING SUM(s.quantity) > COALESCE((
      SELECT SUM(a.quantity)
      FROM stock_trade_allocations a
      JOIN stocks b ON b.id = a.buy_order_id
      WHERE b.symbol = s.symbol
    ), 0);
  `;
  const r = await client.query(q);
  return r.rows.map((x) => x.symbol);
}

// ----------------------------------------------------------------------------
// Stored closes per symbol (ascending) for RSI gap-fill. Trusted source.
// ----------------------------------------------------------------------------
async function getStoredCloses(client, symbols) {
  if (!symbols.length) return {};
  const r = await client.query(
    `SELECT symbol, date, close
       FROM stock_price_history
      WHERE symbol = ANY($1)
      ORDER BY symbol, date`,
    [symbols]
  );
  const map = {};
  for (const row of r.rows) {
    (map[row.symbol] ||= []).push({ date: row.date, close: Number(row.close) });
  }
  return map;
}

// ----------------------------------------------------------------------------
// UPSERT helpers. One row per symbol; each class stamps only its cadence col.
// analyst_target is preserved when analyst_target_manual = true.
// ----------------------------------------------------------------------------
async function upsertFundamentals(client, payloads) {
  const cols = ["symbol", ...FUND_COLS, "fundamentals_updated_at"];
  for (const p of payloads) {
    const values = [p.symbol];
    FUND_COLS.forEach((c) => {
      const v = p[c];
      values.push(JSON_COLS.has(c) && v != null ? JSON.stringify(v) : v ?? null);
    });
    values.push(new Date()); // fundamentals_updated_at

    const params = cols
      .map((c, i) => (JSON_COLS.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`))
      .join(", ");

    const updates = FUND_COLS.filter((c) => c !== "analyst_target")
      .map((c) => `${c} = EXCLUDED.${c}`)
      .concat([
        // manual override guard
        `analyst_target = CASE
           WHEN stockscurrentdata.analyst_target_manual THEN stockscurrentdata.analyst_target
           ELSE EXCLUDED.analyst_target END`,
        `fundamentals_updated_at = EXCLUDED.fundamentals_updated_at`,
      ])
      .join(", ");

    await client.query(
      `INSERT INTO stockscurrentdata (${cols.join(", ")})
       VALUES (${params})
       ON CONFLICT (symbol) DO UPDATE SET ${updates}`,
      values
    );
  }
}

async function upsertTechnicals(client, payloads) {
  const cols = ["symbol", ...TECH_COLS, "technicals_updated_at"];
  for (const p of payloads) {
    const values = [p.symbol, ...TECH_COLS.map((c) => p[c] ?? null), new Date()];
    const params = cols.map((_, i) => `$${i + 1}`).join(", ");
    const updates = TECH_COLS.map((c) => `${c} = EXCLUDED.${c}`)
      .concat([`technicals_updated_at = EXCLUDED.technicals_updated_at`])
      .join(", ");

    await client.query(
      `INSERT INTO stockscurrentdata (${cols.join(", ")})
       VALUES (${params})
       ON CONFLICT (symbol) DO UPDATE SET ${updates}`,
      values
    );
  }
}

// ----------------------------------------------------------------------------
// POST /refresh-indicators  — batch refresh for held symbols.
// Body (all optional):
//   { symbols?: string[], classes?: ("fundamentals"|"technicals")[] }
// Defaults: held symbols, both classes.
// ----------------------------------------------------------------------------
router.post("/refresh-indicators", async (req, res) => {
  const { symbols: bodySymbols, classes } = req.body || {};
  const wantFund = !classes || classes.includes("fundamentals");
  const wantTech = !classes || classes.includes("technicals");

  const client = await pool.connect();
  try {
    const symbols =
      Array.isArray(bodySymbols) && bodySymbols.length
        ? bodySymbols.map((s) => String(s).toUpperCase())
        : await getHeldSymbols(client);

    if (!symbols.length) {
      return res.json({ status: "no held symbols", refreshed: 0 });
    }

    const out = { symbols: symbols.length, fundamentals: 0, technicals: 0, failed: {} };

    if (wantFund) {
      const { data, failed } = await refreshFundamentals(symbols);
      if (data.length) {
        await client.query("BEGIN");
        await upsertFundamentals(client, data);
        await client.query("COMMIT");
      }
      out.fundamentals = data.length;
      if (failed.length) out.failed.fundamentals = failed;
    }

    if (wantTech) {
      const storedClosesMap = await getStoredCloses(client, symbols);
      const { data, failed } = await refreshTechnicals(symbols, storedClosesMap);
      if (data.length) {
        await client.query("BEGIN");
        await upsertTechnicals(client, data);
        await client.query("COMMIT");
      }
      out.technicals = data.length;
      if (failed.length) out.failed.technicals = failed;
    }

    res.json({ status: "ok", ...out });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* no active tx */ }
    console.error("❌ Error refreshing indicators:", error);
    res.status(500).json({ error: "Failed to refresh indicators." });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// POST /refresh-indicators/:symbol  — single stock, both classes.
// ----------------------------------------------------------------------------
router.post("/refresh-indicators/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const client = await pool.connect();
  try {
    const { data: fund, failed: fFailed } = await refreshFundamentals([symbol]);
    const storedClosesMap = await getStoredCloses(client, [symbol]);
    const { data: tech, failed: tFailed } = await refreshTechnicals(
      [symbol],
      storedClosesMap
    );

    await client.query("BEGIN");
    if (fund.length) await upsertFundamentals(client, fund);
    if (tech.length) await upsertTechnicals(client, tech);
    await client.query("COMMIT");

    res.json({
      status: "ok",
      symbol,
      fundamentals: fund.length,
      technicals: tech.length,
      failed: [...fFailed, ...tFailed],
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* no active tx */ }
    console.error(`❌ Error refreshing indicators for ${symbol}:`, error);
    res.status(500).json({ error: "Failed to refresh indicators." });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// PUT /thesis/:id  — unchanged thesis editor (small payload, fast).
// ----------------------------------------------------------------------------
router.put("/thesis/:id", async (req, res) => {
  const { id } = req.params;
  const { thesis_markdown } = req.body;
  if (!id) return res.status(400).json({ error: "Stock ID is required." });
  try {
    const query = `
      UPDATE stockscurrentdata
      SET thesis_markdown = $1,
          thesis_last_updated = NOW()
      WHERE id = $2
      RETURNING id, symbol, thesis_markdown, thesis_last_updated;
    `;
    const result = await pool.query(query, [thesis_markdown, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Stock not found." });
    }
    res.json({ message: "Thesis updated successfully!", thesis: result.rows[0] });
  } catch (error) {
    console.error("❌ Error updating thesis:", error);
    res.status(500).json({ error: "Failed to update thesis." });
  }
});

// ----------------------------------------------------------------------------
// PUT /analyst-target/:symbol  — manual override; sets manual flag so auto
// sync never clobbers it. Send { analyst_target: null } to clear + re-enable
// auto-fill (manual flag reset to false).
// ----------------------------------------------------------------------------
router.put("/analyst-target/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const { analyst_target } = req.body || {};
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const value = analyst_target == null ? null : Number(analyst_target);
  if (value != null && !Number.isFinite(value)) {
    return res.status(400).json({ error: "analyst_target must be a number or null" });
  }
  const manual = value != null; // clearing re-enables auto-fill

  try {
    const query = `
      INSERT INTO stockscurrentdata (symbol, analyst_target, analyst_target_manual)
      VALUES ($1, $2, $3)
      ON CONFLICT (symbol) DO UPDATE
        SET analyst_target = EXCLUDED.analyst_target,
            analyst_target_manual = EXCLUDED.analyst_target_manual
      RETURNING symbol, analyst_target, analyst_target_manual;
    `;
    const result = await pool.query(query, [symbol, value, manual]);
    res.json({ message: "Analyst target updated.", row: result.rows[0] });
  } catch (error) {
    console.error("❌ Error updating analyst target:", error);
    res.status(500).json({ error: "Failed to update analyst target." });
  }
});

// ----------------------------------------------------------------------------
// DELETE /:id  — remove a current-data row (fixed the old '//:id' path bug).
// ----------------------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM stockscurrentdata WHERE id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Stock Current Data not found." });
    }
    res.json({ message: "Stock Current Data deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting stock current data:", error);
    res.status(500).json({ error: "Failed to delete stock current data." });
  }
});

module.exports = router;
