// ============================================================================
// prices.js — INDICES PATCH REFERENCE
// Switches indices from Yahoo → NSE (primary) with Yahoo fallback only where a
// ticker exists. Smallcap 250 is NSE-only. 3 indices total.
// Apply the 3 changes below to routes/prices.js.
// ============================================================================


// ----------------------------------------------------------------------------
// CHANGE 1 — REPLACE the old INDICES array.
//
//   // BEFORE:
//   const INDICES = [
//     { symbol: "NIFTY50", yahoo: "^NSEI" },
//     { symbol: "MIDCAP",  yahoo: "^NSEMDCP50" },
//   ];
//
//   // AFTER: (note MIDCAP -> MIDCAP150; ^NSEMDCP50 was Midcap-50, semantically
//   //         wrong for "Midcap 150" — dropped. NSE is now the source.)
// ----------------------------------------------------------------------------
const INDICES = [
  { symbol: "NIFTY50",     nse: "NIFTY 50",           yahoo: "^NSEI" },
  { symbol: "MIDCAP150",   nse: "NIFTY MIDCAP 150",   yahoo: null    },
  { symbol: "SMALLCAP250", nse: "NIFTY SMALLCAP 250", yahoo: null    },
];


// ----------------------------------------------------------------------------
// CHANGE 2 — ADD these two helpers just above router.post("/update_indices").
// Reuses `nseIndia` (stock-nse-india), `yahooFinance`, and `toISTDateKey`
// already defined in the file — no new imports.
// ----------------------------------------------------------------------------

// yyyy-mm-dd -> dd-mm-yyyy (NSE indicesHistory param format)
function toNseDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// Historical daily index close from NSE's own indicesHistory endpoint.
// Chunked yearly (NSE caps long ranges). Uses the package's low-level
// cookie-primed request so we don't re-implement NSE anti-bot handling.
async function fetchIndexFromNSE(nseName, from, to) {
  const out = [];
  let start = new Date(from);
  const end = new Date(to);

  while (start <= end) {
    const chunkEnd = new Date(start);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    const cEnd = chunkEnd < end ? chunkEnd : end;

    const ep =
      `/api/historical/indicesHistory?indexType=${encodeURIComponent(nseName)}` +
      `&from=${toNseDate(start.toISOString().slice(0, 10))}` +
      `&to=${toNseDate(cEnd.toISOString().slice(0, 10))}`;

    try {
      const resp = await nseIndia.getDataByEndpoint(ep);
      const recs = resp?.data?.indexCloseOnlineRecords || [];
      recs.forEach((r) => {
        const close = Number(r.EOD_CLOSE_INDEX_VAL);
        const parsed = new Date(r.EOD_TIMESTAMP); // "28-Jul-2026"
        if (!isFinite(close) || isNaN(parsed)) return;
        out.push({ date: toISTDateKey(parsed), close });
      });
    } catch (e) {
      console.warn(`[indices] NSE fetch failed for ${nseName}: ${e.message}`);
    }

    start = new Date(cEnd);
    start.setDate(start.getDate() + 1);
  }

  // Dedupe by date + sort ascending.
  const map = new Map();
  out.forEach((r) => map.set(r.date, r.close));
  return [...map.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Yahoo fallback (only for indices that have a ticker, e.g. Nifty 50).
async function fetchIndexFromYahoo(yahooTicker, from, to) {
  try {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    const history = await yahooFinance.historical(yahooTicker, {
      period1: new Date(from),
      period2: end,
      interval: "1d",
    });
    return (history || [])
      .filter((d) => d.close != null && !Number.isNaN(d.close))
      .map((d) => ({ date: toISTDateKey(d.date), close: d.close }));
  } catch (e) {
    console.warn(`[indices] Yahoo fetch failed for ${yahooTicker}: ${e.message}`);
    return [];
  }
}


// ----------------------------------------------------------------------------
// CHANGE 3 — REPLACE the body of router.post("/update_indices").
// Keep the route signature + the existing bulk-insert block; only the
// "build indexMap / fetch" section changes to NSE-first per-symbol.
//
// Replace everything from the `const indexMap = {}` block through the fetch
// loop that fills `allRows` with the version below. The placeholder/values
// bulk INSERT into index_price_history stays exactly as-is.
// ----------------------------------------------------------------------------
/*
router.post("/update_indices", async (req, res) => {
  try {
    const ranges = req.body; // [{ symbol, from, to }, ...]
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return res.status(400).json({ error: "No ranges provided" });
    }

    // NEW: config lookup by DB symbol.
    const bySymbol = Object.fromEntries(INDICES.map((i) => [i.symbol, i]));

    const allRows = [];
    for (const { symbol, from, to } of ranges) {
      const def = bySymbol[symbol];
      if (!def) {
        console.warn(`Unknown index symbol: ${symbol}, skipping.`);
        continue;
      }

      // NSE primary
      let rows = await fetchIndexFromNSE(def.nse, from, to);
      let source = "nse";

      // Yahoo fallback only if a ticker exists (Smallcap 250 => none)
      if (!rows.length && def.yahoo) {
        rows = await fetchIndexFromYahoo(def.yahoo, from, to);
        source = "yahoo";
      }

      console.log(`[indices] ${symbol}: ${rows.length} row(s) from ${source}`);
      rows.forEach((r) =>
        allRows.push({ symbol, date: r.date, close: r.close })
      );
    }

    if (allRows.length === 0) {
      return res.json({ status: "no new rows to insert" });
    }

    // ---- KEEP your existing bulk insert exactly as-is below ----
    const placeholders = allRows
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(", ");
    const values = allRows.flatMap((r) => [r.symbol, r.date, r.close]);
    await pool.query(
      `INSERT INTO index_price_history (symbol, date, close)
       VALUES ${placeholders}
       ON CONFLICT (symbol, date) DO NOTHING`,
      values
    );

    res.json({ status: "index prices updated", inserted: allRows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to fetch index prices" });
  }
});
*/


// ----------------------------------------------------------------------------
// CHANGE 4 — In router.get("/get_indices"), update the default symbol list so
// all three indices are returned on load (and new ones bootstrap):
//
//   // BEFORE:
//   ? req.query.symbols.split(",")
//   : ["NIFTY50", "MIDCAP"];
//
//   // AFTER:
//   ? req.query.symbols.split(",")
//   : ["NIFTY50", "MIDCAP150", "SMALLCAP250"];
// ----------------------------------------------------------------------------
