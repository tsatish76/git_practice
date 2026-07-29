const express = require("express");
const router = express.Router(); // This special "router" object will hold our user-related APIs
const axios = require("axios");
const pool = require("../database"); // Import PostgreSQL connection
const YahooFinance = require('yahoo-finance2').default;
// import YahooFinance from 'yahoo-finance2';
// 2. Create an instance
const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical"],
});
// ============================================================================
// PRIMARY SOURCE: stock-nse-india (npm) — scrapes NSE's own official public
// JSON endpoints. Free, no API key, unlimited requests (subject to NSE's own
// anti-bot rate limiting on their servers).
//
// WHY THIS IS PRIMARY NOW: NSE's own settlement close price does not have
// the "close: null / adjclose: null on a valid trading day" gaps that Yahoo
// exhibits for illiquid/small-cap NSE stocks. Since this data comes straight
// from the exchange, it's the source of truth — no third-party adjustment
// pipeline to introduce holes.
//
// SECONDARY: BSE historical daily close by scrip code (main-board equity).
// Covers scrips that are BSE-listed but missing/illiquid on NSE. Requires the
// instruments table to carry scrip_code (populated by the instrument master
// sync); symbols without a scrip_code simply skip BSE and fall to Yahoo.
//
// FALLBACK: Yahoo Finance (.NS then .BO) — kept as a safety net because NSE/BSE
// periodically change cookies/anti-scraping headers, which can break the
// primary sources until patched upstream. Independent free sources mean a
// single-source outage or gap doesn't take the whole chain down.
// ============================================================================
const { NseIndia } = require("stock-nse-india");
const nseIndia = new NseIndia();
// ============================================================================
// ----------------------------------------------------------------------------
// This API returns all price history stored in our DB, grouped by symbol.
router.get("/get_stocks", async (req, res) => {
  try {
    const query = `
      SELECT symbol, date, close
      FROM stock_price_history
      ORDER BY symbol, date
    `;
    const result = await pool.query(query);
    // group results by symbol
    const grouped = {};
    result.rows.forEach(row => {
      if (!grouped[row.symbol]) {
        grouped[row.symbol] = [];
      }
      grouped[row.symbol].push({
        date: row.date,
        close: row.close
      });
    });
    const response = Object.entries(grouped).map(([symbol, history]) => ({
      symbol,
      history
    }));
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch DB price history" });
  }
});
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// This API returns all price history stored in our DB, grouped by symbol.
router.get("/get_mf_nav", async (req, res) => {
  try {
    const query = `
      SELECT symbol, date, nav
      FROM mf_nav_history
      ORDER BY symbol, date
    `;
    const result = await pool.query(query);
    // group results by symbol
    const grouped = {};
    result.rows.forEach(row => {
      if (!grouped[row.symbol]) {
        grouped[row.symbol] = [];
      }
      grouped[row.symbol].push({
        date: row.date,
        nav: row.nav
      });
    });
    const response = Object.entries(grouped).map(([symbol, history]) => ({
      symbol,
      history
    }));
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch DB mutual fund price history" });
  }
});
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// A much faster and scalable approach is to use Postgres UNNEST bulk
// insert. It sends 3 arrays instead of thousands of parameters.
async function savePriceHistory(rows, pool, chunkSize = 5000) {
  // Defensive second filter: never let a null/NaN close reach the DB, even
  // if it slipped through upstream. One bad numeric value in a UNNEST batch
  // can silently corrupt or reject the entire chunk (including valid symbols).
  const cleanRows = rows.filter(r =>
    r.close != null && !Number.isNaN(r.close) && Number.isFinite(r.close)
  );
  const droppedCount = rows.length - cleanRows.length;
  if (droppedCount > 0) {
    console.warn(`[prices] savePriceHistory: dropped ${droppedCount} row(s) with invalid close value`);
  }
  for (let i = 0; i < cleanRows.length; i += chunkSize) {
    const chunk = cleanRows.slice(i, i + chunkSize);
    const symbols = chunk.map(r => r.symbol);
    const dates = chunk.map(r => r.date);
    const closes = chunk.map(r => r.close);
    const query = `
      INSERT INTO stock_price_history (symbol, date, close)
      SELECT *
      FROM UNNEST($1::text[], $2::date[], $3::numeric[])
      ON CONFLICT (symbol, date) DO NOTHING
    `;
    await pool.query(query, [symbols, dates, closes]);
  }
}
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Exchange-local (IST) date key. TZ-safe regardless of server timezone.
const toISTDateKey = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt); // → "YYYY-MM-DD"
};
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// fetchFromNSE
//
// Fetches historical daily close prices directly from NSE's own official
// data via the stock-nse-india package. This is the exchange's own
// settlement price — no third-party adjustment pipeline, so it doesn't
// exhibit the "close: null on a valid trading day" gaps Yahoo sometimes has.
//
// Response shape from getEquityHistoricalData(): array of chunks, each with
// a `.data` array of records keyed CH_TIMESTAMP / CH_CLOSING_PRICE etc.
// (NSE splits multi-year ranges into yearly chunks internally — the package
// handles that and returns them as an array of chunk objects.)
// ----------------------------------------------------------------------------
async function fetchFromNSE(symbol, from, to) {
  try {
    const range = {
      start: new Date(from),
      end: new Date(to),
    };
    const chunks = await nseIndia.getEquityHistoricalData(symbol, range);
    if (!Array.isArray(chunks) || chunks.length === 0) return [];
    const rows = [];
    chunks.forEach(chunk => {
      const records = chunk?.data;
      if (!Array.isArray(records)) return;
      records.forEach(r => {
        const closeRaw = r.chClosingPrice;
        const dateRaw  = r.mtimestamp;
        if (closeRaw == null || Number.isNaN(Number(closeRaw))) return;
        if (!dateRaw) return;
        // CH_TIMESTAMP is typically "DD-MMM-YYYY" or ISO — normalize to YYYY-MM-DD
        const parsed = new Date(dateRaw);
        if (isNaN(parsed.getTime())) return;
        rows.push({
          date: toISTDateKey(parsed),
          close: Math.round(Number(closeRaw) * 1000) / 1000,
        });
      });
    });
    console.log("\nFetched from NSE:", rows);
    return rows;
  } catch (err) {
    console.warn(`[prices] NSE fetch failed for ${symbol}: ${err.message}`);
    return [];
  }
}
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// BSE historical daily-close by scrip code (SECONDARY source).
//
// Uses StockPriceCSVDownload, which accepts a date range (unlike
// GetStockReachGraphData, which is latest/chart-only). Params are dd/mm/yyyy;
// response is CSV. Returns [] on any failure (no scrip code, HTML/error body,
// empty series, parse miss) so the fetchOneSymbol chain falls cleanly to Yahoo
// — same contract as fetchFromNSE (never throws).
// ----------------------------------------------------------------------------
const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/csv,application/json,text/plain,*/*",
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
};

// yyyy-mm-dd -> dd/mm/yyyy (BSE param format)
function toBseDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Robustly parse BSE CSV date cells. BSE returns either "2 Jan 2024" /
// "02-Jan-2024" (native Date parses these) OR "02/01/2024" (dd/mm/yyyy, which
// JS Date misreads as mm/dd). Handle the numeric dd/mm/yyyy case explicitly.
function parseBseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s); // "2 Jan 2024" / "02-Jan-2024"
  return isNaN(dt.getTime()) ? null : dt;
}

async function fetchFromBSE(symbol, from, to, scripCode) {
  // No BSE mapping for this symbol -> skip BSE, let chain fall to Yahoo.
  if (!scripCode) return [];

  try {
    const url =
      "https://api.bseindia.com/BseIndiaAPI/api/StockPriceCSVDownload/w" +
      `?scripcode=${encodeURIComponent(scripCode)}` +
      `&flag=0&fromdate=${encodeURIComponent(toBseDate(from))}` +
      `&todate=${encodeURIComponent(toBseDate(to))}` +
      "&seriesid=";

    const resp = await axios.get(url, {
      headers: BSE_HEADERS,
      responseType: "text",
      timeout: 30000,
    });

    const text = typeof resp.data === "string" ? resp.data : "";
    if (!text.trim() || text.trim().startsWith("<")) {
      console.warn(`[prices] BSE returned no CSV for ${symbol} (${scripCode})`);
      return [];
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      console.warn(`[prices] BSE empty series for ${symbol} (${scripCode})`);
      return [];
    }

    // Header columns vary in case/spacing: Date, Open, High, Low, Close, ...
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const dateIdx = header.findIndex((h) => h.includes("date"));
    const closeIdx = header.findIndex((h) => h === "close" || h.includes("close"));
    if (dateIdx === -1 || closeIdx === -1) {
      console.warn(`[prices] BSE CSV missing Date/Close columns for ${symbol}`);
      return [];
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const parsed = parseBseDate(cols[dateIdx]);
      const close = parseFloat(cols[closeIdx]);
      if (!parsed || !Number.isFinite(close)) continue;
      rows.push({
        date: toISTDateKey(parsed),
        close: Math.round(close * 1000) / 1000,
      });
    }

    if (rows.length === 0) {
      console.warn(`[prices] BSE parsed 0 rows for ${symbol} (${scripCode})`);
      return [];
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  } catch (err) {
    console.warn(`[prices] BSE fetch failed for ${symbol}: ${err.message}`);
    return [];
  }
}
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// fetchFromYahoo
//
// Fallback source. Same null-filtering logic as before — skips any row
// where both close and adjClose are null (T2T days, corporate-action gaps)
// instead of letting NaN reach the DB layer.
// ----------------------------------------------------------------------------
async function fetchFromYahoo(symbol, from, to, exchangeSuffix) {
      try {
        const yahooSymbol = `${symbol}.${exchangeSuffix}`;
        const history = await yahooFinance.historical(yahooSymbol, {
          period1: from,
      period2: to,
          interval: "1d",
        });
        if (!history || history.length === 0) return [];
        const validRows = [];
        let skippedCount = 0;
        history.forEach(row => {
          const rawClose = row.adjClose ?? row.close;
          if (rawClose == null || Number.isNaN(rawClose)) {
            skippedCount++;
            return;
          }
          validRows.push({
          date: toISTDateKey(row.date),
        close: Math.round(rawClose * 1000) / 1000,
          });
        });
        if (skippedCount > 0) {
          console.warn(
            `[prices] ${yahooSymbol}: skipped ${skippedCount} row(s) with ` +
            `null close/adjClose (likely T2T/illiquid trading day)`
          );
        }
        return validRows;
      } catch {
        return []; // silently ignore Yahoo errors
      }
}
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Concurrency + pacing config (env-tunable; safe defaults for NSE/Yahoo)
// ----------------------------------------------------------------------------
const PRICE_FETCH_CONCURRENCY =
  Number(process.env.PRICE_FETCH_CONCURRENCY) || 3;
const PRICE_FETCH_MIN_DELAY_MS =
  Number(process.env.PRICE_FETCH_MIN_DELAY_MS) || 250;
const PRICE_FETCH_MAX_RETRIES =
  Number(process.env.PRICE_FETCH_MAX_RETRIES) || 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Jitter avoids a synchronized request cadence that itself looks bot-like.
const jitter = (base) => base + Math.floor(Math.random() * base);
// ----------------------------------------------------------------------------
// mapWithConcurrency
// Runs `worker` over `items` with at most `limit` in flight at once.
// Preserves input order in the returned array. No external deps.
// ----------------------------------------------------------------------------
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
// ----------------------------------------------------------------------------
// fetchOneSymbol
// Fallback chain: NSE -> BSE(scrip_code) -> Yahoo(.NS) -> Yahoo(.BO), with
// retry. Empty result triggers backoff+retry (treats throttle/empty as
// transient). scrip_code arrives on the range object from the frontend
// payload; when absent, fetchFromBSE returns [] and the chain skips to Yahoo.
// ----------------------------------------------------------------------------
async function fetchOneSymbol({ symbol, from, to, scrip_code }) {
  const end = new Date(to);
  end.setDate(end.getDate() + 1);
  const toStr = end.toISOString().slice(0, 10);
  for (let attempt = 1; attempt <= PRICE_FETCH_MAX_RETRIES; attempt++) {
    let history = await fetchFromNSE(symbol, from, toStr);
    let source = "nse";
    if (!history.length) {
      history = await fetchFromBSE(symbol, from, toStr, scrip_code);
      source = "bse";
    }
    if (!history.length) {
      history = await fetchFromYahoo(symbol, from, toStr, "NS");
      source = "yahoo-ns";
    }
    if (!history.length) {
      history = await fetchFromYahoo(symbol, from, toStr, "BO");
      source = "yahoo-bo";
    }
    if (history.length) {
      console.log(
        `[prices] ${symbol}: fetched ${history.length} row(s) from ${source} (attempt ${attempt})`,
      );
      return { symbol, history };
    }
    if (attempt < PRICE_FETCH_MAX_RETRIES) {
      const backoff = jitter(PRICE_FETCH_MIN_DELAY_MS * 2 ** attempt); // 500→1000→2000ms + jitter
      console.warn(
        `[prices] ${symbol}: empty (attempt ${attempt}/${PRICE_FETCH_MAX_RETRIES}), backing off ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
  console.warn(
    `[prices] ${symbol}: no data after ${PRICE_FETCH_MAX_RETRIES} attempts for range ${from} → ${to}`,
  );
  return { symbol, history: [] };
}
// ----------------------------------------------------------------------------
// fetchStockPrices
// Bounded concurrency + inter-request jitter. Replaces the unbounded
// Promise.all(map(...)) burst that was triggering NSE/Yahoo rate limiting.
// ----------------------------------------------------------------------------
async function fetchStockPrices(symbolRanges) {
  return mapWithConcurrency(
    symbolRanges,
    PRICE_FETCH_CONCURRENCY,
    async (range) => {
      const result = await fetchOneSymbol(range);
      await sleep(jitter(PRICE_FETCH_MIN_DELAY_MS)); // space out the next dispatch on this runner
      return result;
    },
  );
}
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
router.post("/update_stocks", async (req, res) => {
  try {
    const symbols = req.body; // [{ symbol, from, to, scrip_code }, ...]
    // fetch missing prices — NSE → BSE → Yahoo(NS) → Yahoo(BO) (see fetchOneSymbol)
    const rows = await fetchStockPrices(symbols);
    // flatten for DB storage
    const flatRows = rows.flatMap(stock =>
      stock.history.map(h => ({
        symbol: stock.symbol,
        date: h.date,
        close: h.close
      }))
    );
    if (flatRows.length > 0) {
      await savePriceHistory(flatRows, pool);
    }
    // return same data to UI
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Price update failed" });
  }
});
// ----------------------------------------------------------------------------
// ============================================================================
// ============================================================================
// INDICES API
const INDICES = [
  { symbol: "NIFTY50", yahoo: "^NSEI" },
  { symbol: "MIDCAP", yahoo: "^NSEMDCP50" },
];
// ----------------------------------------------------------------------------
router.post("/update_indices", async (req, res) => {
  try {
    const ranges = req.body; // [{ symbol, from, to }, ...]
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return res.status(400).json({ error: "No ranges provided" });
    }
    // -------------------------
    // Build a lookup: symbol → yahoo ticker
    // -------------------------
    const indexMap = {};
    INDICES.forEach(index => {
      indexMap[index.symbol] = index.yahoo;
    });
    // -------------------------
    // Fetch + collect all rows
    // -------------------------
    const allRows = [];
    for (const { symbol, from, to } of ranges) {
      const yahooTicker = indexMap[symbol];
      if (!yahooTicker) {
        console.warn(`Unknown index symbol: ${symbol}, skipping.`);
        continue;
      }
      const end = new Date(to);
      end.setDate(end.getDate() + 1);
      const history = await yahooFinance.historical(yahooTicker, {
        period1: new Date(from),
        period2: new Date(end),
        interval: "1d"
      });
      history
        .filter(d => d.close !== null)
        .forEach(d => {
          allRows.push({
            symbol,
            date: d.date.toISOString().split("T")[0],
            close: d.close
          });
        });
    }
    if (allRows.length === 0) {
      return res.json({ status: "no new rows to insert" });
    }
    // -------------------------
    // Bulk insert
    // -------------------------
    const placeholders = allRows
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(", ");
    const values = allRows.flatMap(r => [r.symbol, r.date, r.close]);
    await pool.query(
      `
      INSERT INTO index_price_history (symbol, date, close)
      VALUES ${placeholders}
      ON CONFLICT (symbol, date) DO NOTHING
      `,
      values
    );
    res.json({ status: "index prices updated", inserted: allRows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to fetch index prices" });
  }
});
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// This API returns all index price history stored in our DB, grouped by symbol.
router.get("/get_indices", async (req, res) => {
  try {
    const symbols = req.query.symbols
      ? req.query.symbols.split(",")
      : ["NIFTY50", "MIDCAP"];
    const result = await pool.query(
      `
      SELECT symbol, date, close
      FROM index_price_history
      WHERE symbol = ANY($1)
      ORDER BY date
      `,
      [symbols]
    );
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.symbol]) grouped[row.symbol] = [];
      grouped[row.symbol].push({
        date: row.date,
        close: Number(row.close)
      });
    }
    res.json(grouped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to fetch index prices" });
  }
});
// ----------------------------------------------------------------------------
// ============================================================================
module.exports = router; // Export the router to be used in the main app
