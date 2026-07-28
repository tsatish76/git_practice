const express = require("express");
const router = express.Router(); // This special "router" object will hold our instrument-related APIs
const axios = require("axios");
const { Readable } = require("stream");
const csv = require("csv-parser");
const pool = require("../database"); // Import PostgreSQL connection

// ============================================================================
// INSTRUMENT MASTER SYNC
// ----------------------------------------------------------------------------
// Sources (active-only feeds → delisted scrips never enter the master):
//   NSE : EQUITY_L.csv (has SYMBOL, NAME OF COMPANY, SERIES, ISIN NUMBER).
//         We filter SERIES === 'EQ' → drops SME (SM), BE/BZ (T2T), etc.
//   BSE : ListofScripData (segment=Equity, status=Active) → main board only,
//         SME is a separate segment so it is excluded by construction.
//         Used to resolve ISIN → BSE scrip_code.
//
// Join key = ISIN (identical across both exchanges; symbols/names differ).
// Scope    = EQ only. MF is out of scope (AMFI is a separate feed).
// ============================================================================

const NSE_EQUITY_CSV =
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

// segment=Equity + status=Active → main-board active equities only (no SME).
const BSE_SCRIP_LIST =
  "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w" +
  "?Group=&Scripcode=&industry=&segment=Equity&status=Active";

// nsearchives static files serve with a plain browser UA (unlike the
// api.nseindia.com JSON endpoints, these archive CSVs don't need cookie priming).
const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/csv,application/octet-stream,*/*",
};

// api.bseindia.com already works elsewhere in this app with a UA; Referer/Origin
// added defensively as BSE's WAF sometimes 403s bare requests.
const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
};

// ----------------------------------------------------------------------------
// fetchNseMaster
// Streams EQUITY_L.csv → [{ symbol, name, isin }] filtered to SERIES === 'EQ'.
// NSE CSV headers carry leading spaces (" SERIES", " ISIN NUMBER"); mapHeaders
// trims + upper-cases so lookups are stable regardless of that quirk.
// ----------------------------------------------------------------------------
async function fetchNseMaster() {
  const resp = await axios.get(NSE_EQUITY_CSV, {
    headers: NSE_HEADERS,
    responseType: "text",
    timeout: 30000,
  });

  const rows = [];
  await new Promise((resolve, reject) => {
    Readable.from(resp.data)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim().toUpperCase() }))
      .on("data", (r) => {
        const series = (r["SERIES"] || "").trim().toUpperCase();
        if (series !== "EQ") return; // drop SME/BE/BZ/etc.
        const symbol = (r["SYMBOL"] || "").trim().toUpperCase();
        if (!symbol) return;
        const name = (r["NAME OF COMPANY"] || "").trim();
        const isin = (r["ISIN NUMBER"] || "").trim().toUpperCase();
        rows.push({ symbol, name, isin: isin || null });
      })
      .on("end", resolve)
      .on("error", reject);
  });
  return rows;
}

// ----------------------------------------------------------------------------
// fetchBseIsinMap
// Returns Map<ISIN, scrip_code> for active main-board equities.
// Non-fatal: on failure returns an empty map so NSE add + ISIN backfill still
// proceed (scrip_code simply stays null and can be resolved on a later sync).
// ----------------------------------------------------------------------------
async function fetchBseIsinMap() {
  const resp = await axios.get(BSE_SCRIP_LIST, {
    headers: BSE_HEADERS,
    timeout: 30000,
  });

  // Endpoint returns a bare array; guard for wrapped shapes just in case.
  const data = Array.isArray(resp.data)
    ? resp.data
    : resp.data?.Table || resp.data?.data || [];

  const map = new Map();
  for (const row of data) {
    const isin = (row.ISIN_NUMBER || row.ISINNumber || row.ISIN || "")
      .toString()
      .trim()
      .toUpperCase();
    const scrip = (row.SCRIP_CD || row.Scrip_Cd || row.scrip_cd || "")
      .toString()
      .trim();
    if (isin && scrip) map.set(isin, scrip);
  }
  return map;
}

// ----------------------------------------------------------------------------
// GET /  — list all instruments (now including isin + scrip_code).
// ----------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT symbol, name, asset_type, isin, scrip_code
      FROM instruments
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch instruments" });
  }
});

// ----------------------------------------------------------------------------
// POST /sync/preview
// Fetches NSE + BSE masters, diffs against DB (EQ only), returns:
//   toAdd    : NSE EQ symbols not yet in the table (with isin + scrip_code).
//   toEnrich : existing rows missing isin and/or scrip_code that we can now fill.
// Read-only — nothing is written. This is the "what will be added/changed" preview.
// ----------------------------------------------------------------------------
router.post("/sync/preview", async (req, res) => {
  try {
    const [nse, bseMap] = await Promise.all([
      fetchNseMaster(),
      fetchBseIsinMap().catch((e) => {
        console.warn(`[instruments] BSE fetch failed: ${e.message}`);
        return new Map();
      }),
    ]);

    const existing = await pool.query(
      `SELECT symbol, name, isin, scrip_code FROM instruments WHERE asset_type = 'EQ'`
    );
    const bySymbol = new Map(
      existing.rows.map((r) => [r.symbol.toUpperCase(), r])
    );

    const toAdd = [];
    const toEnrich = [];

    for (const inst of nse) {
      const scrip_code = inst.isin ? bseMap.get(inst.isin) || null : null;
      const cur = bySymbol.get(inst.symbol);

      if (!cur) {
        toAdd.push({
          symbol: inst.symbol,
          name: inst.name,
          isin: inst.isin,
          scrip_code,
        });
        continue;
      }

      const needIsin = !cur.isin && !!inst.isin;
      const needScrip = !cur.scrip_code && !!scrip_code;
      if (needIsin || needScrip) {
        toEnrich.push({
          symbol: inst.symbol,
          name: cur.name,
          isin: cur.isin || inst.isin,
          scrip_code: cur.scrip_code || scrip_code,
        });
      }
    }

    res.json({
      stats: {
        nseEqCount: nse.length,
        bseIsinCount: bseMap.size,
        existingEq: existing.rowCount,
        addable: toAdd.length,
        enrichable: toEnrich.length,
        bseAvailable: bseMap.size > 0,
      },
      toAdd,
      toEnrich,
    });
  } catch (err) {
    console.error("[instruments] preview failed:", err.message);
    res.status(500).json({ error: "Failed to preview instrument sync" });
  }
});

// ----------------------------------------------------------------------------
// POST /sync/commit
// Body: { toAdd: [{symbol,name,isin,scrip_code}], toEnrich: [{...}] }
// Applies exactly the rows the client confirmed from the preview (deterministic,
// user-controlled). Runs in a single transaction. COALESCE guards ensure a sync
// never overwrites an existing non-null isin/scrip_code with null.
// ----------------------------------------------------------------------------
router.post("/sync/commit", async (req, res) => {
  const { toAdd = [], toEnrich = [] } = req.body || {};

  if (!Array.isArray(toAdd) || !Array.isArray(toEnrich)) {
    return res
      .status(400)
      .json({ error: "toAdd and toEnrich must be arrays" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let added = 0;
    let enriched = 0;

    for (const r of toAdd) {
      if (!r || !r.symbol) continue;
      await client.query(
        `INSERT INTO instruments (symbol, name, asset_type, isin, scrip_code)
         VALUES ($1, $2, 'EQ', $3, $4)
         ON CONFLICT (symbol) DO UPDATE
         SET name       = EXCLUDED.name,
             isin       = COALESCE(instruments.isin, EXCLUDED.isin),
             scrip_code = COALESCE(instruments.scrip_code, EXCLUDED.scrip_code)`,
        [
          r.symbol.toUpperCase(),
          r.name || r.symbol,
          r.isin || null,
          r.scrip_code || null,
        ]
      );
      added++;
    }

    for (const r of toEnrich) {
      if (!r || !r.symbol) continue;
      await client.query(
        `UPDATE instruments
         SET isin       = COALESCE(isin, $2),
             scrip_code = COALESCE(scrip_code, $3)
         WHERE symbol = $1 AND asset_type = 'EQ'`,
        [r.symbol.toUpperCase(), r.isin || null, r.scrip_code || null]
      );
      enriched++;
    }

    await client.query("COMMIT");
    res.json({ status: "ok", added, enriched });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[instruments] commit failed:", err.message);
    res.status(500).json({ error: "Failed to commit instrument sync" });
  } finally {
    client.release();
  }
});

// ============================================================================
module.exports = router; // Export the router to be used in the main app
