// ============================================================================
// indexService.js
// ----------------------------------------------------------------------------
// Historical index (benchmark) data for the portfolio tracker.
//
// WHY A SEPARATE MODULE:
//   Index history is NOT served by nseindia.com the way equity history is.
//   NSE's /api/historical/indicesHistory proxy is WAF-throttled (503) and
//   partially deprecated. The TRUE origin of all Nifty index data is
//   niftyindices.com (NSE Indices Ltd). We therefore emulate the exact XHR
//   call that niftyindices' own "Historical Data" page makes to itself:
//
//       POST /Backpage.aspx/getHistoricaldatatabletoString
//
//   This is the same "undocumented internal endpoint" model the stock pipeline
//   already relies on — just pointed at the data's real owner.
//
// SOURCE STRATEGY (per index):
//   PRIMARY  : niftyindices.com  (covers ALL three indices)
//   FALLBACK : Yahoo Finance     (ONLY where a ticker exists → Nifty 50 = ^NSEI)
//              Midcap 150 / Smallcap 250 have no Yahoo series, so niftyindices
//              is their single source; if it is down they simply don't update.
//
// PUBLIC API:
//   INDICES                      → config array [{ symbol, nse, yahoo }]
//   fetchIndexHistory(sym,f,t)   → [{ date:"YYYY-MM-DD", close:number }] by DB symbol
//   fetchIndexHistoryByName(...)  → same, by raw NSE index name
// ============================================================================
const axios = require("axios");
const YahooFinance = require("yahoo-finance2").default;

const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical"],
});

// ----------------------------------------------------------------------------
// CONFIG — single source of truth: DB symbol -> exact NSE index name + optional
// Yahoo ticker. The `nse` string MUST match niftyindices' canonical spelling.
// ----------------------------------------------------------------------------
const INDICES = [
  { symbol: "NIFTY50",     nse: "NIFTY 50",           yahoo: "^NSEI" },
  { symbol: "MIDCAP150",   nse: "NIFTY MIDCAP 150",   yahoo: null    },
  { symbol: "SMALLCAP250", nse: "NIFTY SMALLCAP 250", yahoo: null    },
];

const BY_SYMBOL = Object.fromEntries(INDICES.map((i) => [i.symbol, i]));

// ----------------------------------------------------------------------------
// Pacing (env-tunable). niftyindices informally throttles ~3 req/s; we chunk
// yearly and jitter between chunks to stay well under that.
// ----------------------------------------------------------------------------
const INDEX_FETCH_MIN_DELAY_MS =
  Number(process.env.INDEX_FETCH_MIN_DELAY_MS) || 300;
const INDEX_FETCH_MAX_RETRIES =
  Number(process.env.INDEX_FETCH_MAX_RETRIES) || 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * base);

// ----------------------------------------------------------------------------
// Date helpers
// ----------------------------------------------------------------------------
const NIFTY_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Exchange-local (IST) key. TZ-safe regardless of server timezone.
function toISTDateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt); // "YYYY-MM-DD"
}

// yyyy-mm-dd -> DD-Mon-YYYY (niftyindices param format, e.g. "01-Jul-2026")
function toNiftyDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${NIFTY_MONTHS[Number(m) - 1]}-${y}`;
}

// niftyindices "HistoricalDate" arrives as "01 Jul 2026" / "01-Jul-2026".
// JS Date parses "01 Jul 2026" fine; normalise dashes to spaces first.
function parseNiftyDate(raw) {
  if (!raw) return null;
  const dt = new Date(String(raw).trim().replace(/-/g, " "));
  return isNaN(dt.getTime()) ? null : dt;
}

// ----------------------------------------------------------------------------
// niftyindices request scaffolding
// ----------------------------------------------------------------------------
const NIFTY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const NIFTY_HEADERS = {
  "User-Agent": NIFTY_UA,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Content-Type": "application/json; charset=UTF-8",
  Origin: "https://niftyindices.com",
  Referer: "https://niftyindices.com/reports/historical-data",
  "X-Requested-With": "XMLHttpRequest",
};

// Prime the ASP.NET session cookie. niftyindices rejects POSTs (503/forbidden)
// without a cookie obtained by first loading the historical-data page.
async function primeNiftyCookie() {
  try {
    const r = await axios.get(
      "https://niftyindices.com/reports/historical-data",
      { headers: { "User-Agent": NIFTY_UA }, timeout: 30000 }
    );
    const sc = r.headers["set-cookie"];
    return Array.isArray(sc) ? sc.map((c) => c.split(";")[0]).join("; ") : "";
  } catch (e) {
    console.warn(`[indices] cookie prime failed: ${e.message}`);
    return "";
  }
}

// Single niftyindices POST for one (already-chunked) date window.
async function niftyPost(nseName, fromIso, toIso, cookie) {
  const body = {
    cinfo: JSON.stringify({
      name: nseName,
      startDate: toNiftyDate(fromIso),
      endDate: toNiftyDate(toIso),
      indexName: nseName,
    }),
  };

  const resp = await axios.post(
    "https://niftyindices.com/Backpage.aspx/getHistoricaldatatabletoString",
    body,
    {
      headers: { ...NIFTY_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
      timeout: 30000,
    }
  );

  // resp.data.d is (usually) a JSON string array of records.
  const raw = resp?.data?.d;
  const recs =
    typeof raw === "string"
      ? JSON.parse(raw)
      : Array.isArray(raw)
      ? raw
      : Array.isArray(resp?.data)
      ? resp.data
      : [];

  const out = [];
  recs.forEach((r) => {
    const closeRaw = r.CLOSE ?? r.Close ?? r.close ?? r.EOD_CLOSE_INDEX_VAL;
    const dateRaw =
      r.HistoricalDate ?? r.Historical_Date ?? r.EOD_TIMESTAMP ?? r.Date;
    const close = Number(String(closeRaw ?? "").replace(/,/g, ""));
    const parsed = parseNiftyDate(dateRaw);
    if (!Number.isFinite(close) || !parsed) return;
    out.push({ date: toISTDateKey(parsed), close });
  });
  return out;
}

// ----------------------------------------------------------------------------
// fetchFromNifty
// Historical daily close from niftyindices (PRIMARY). Chunked yearly (server
// caps long ranges), retried on transient failure, deduped + sorted ascending.
// ----------------------------------------------------------------------------
async function fetchFromNifty(nseName, from, to) {
  const cookie = await primeNiftyCookie();
  const rows = [];
  let start = new Date(from);
  const end = new Date(to);

  while (start <= end) {
    const chunkEnd = new Date(start);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    const cEnd = chunkEnd < end ? chunkEnd : end;

    const fromIso = start.toISOString().slice(0, 10);
    const toIso = cEnd.toISOString().slice(0, 10);

    let got = [];
    for (let attempt = 1; attempt <= INDEX_FETCH_MAX_RETRIES; attempt++) {
      try {
        got = await niftyPost(nseName, fromIso, toIso, cookie);
        if (got.length) break;
      } catch (e) {
        console.warn(
          `[indices] niftyindices ${nseName} ${fromIso}->${toIso} ` +
            `attempt ${attempt}/${INDEX_FETCH_MAX_RETRIES} failed: ${e.message}`
        );
        if (attempt < INDEX_FETCH_MAX_RETRIES) {
          await sleep(jitter(INDEX_FETCH_MIN_DELAY_MS * 2 ** attempt));
        }
      }
    }
    rows.push(...got);

    start = new Date(cEnd);
    start.setDate(start.getDate() + 1);
    await sleep(jitter(INDEX_FETCH_MIN_DELAY_MS)); // pace chunks
  }

  return dedupeSort(rows);
}

// ----------------------------------------------------------------------------
// fetchFromYahooIndex
// Fallback (ONLY for indices with a ticker — Nifty 50). Yahoo has no series for
// Midcap 150 / Smallcap 250, so those never reach here.
// ----------------------------------------------------------------------------
async function fetchFromYahooIndex(ticker, from, to) {
  try {
    const end = new Date(to);
    end.setDate(end.getDate() + 1); // Yahoo period2 is exclusive
    const history = await yahooFinance.historical(ticker, {
      period1: new Date(from),
      period2: end,
      interval: "1d",
    });
    const rows = (history || [])
      .filter((d) => d.close != null && !Number.isNaN(d.close))
      .map((d) => ({
        date: toISTDateKey(d.date),
        close: Math.round(d.close * 1000) / 1000,
      }));
    return dedupeSort(rows);
  } catch (e) {
    console.warn(`[indices] Yahoo fetch failed for ${ticker}: ${e.message}`);
    return [];
  }
}

function dedupeSort(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (r.date) map.set(r.date, r.close);
  });
  return [...map.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ----------------------------------------------------------------------------
// fetchIndexHistoryByName — niftyindices primary, Yahoo fallback if provided.
// ----------------------------------------------------------------------------
async function fetchIndexHistoryByName(nseName, from, to, yahooTicker = null) {
  let rows = await fetchFromNifty(nseName, from, to);
  let source = "niftyindices";

  if (!rows.length && yahooTicker) {
    rows = await fetchFromYahooIndex(yahooTicker, from, to);
    source = "yahoo";
  }

  console.log(
    `[indices] ${nseName}: ${rows.length} row(s) from ${source} ` +
      `(${from} → ${to})`
  );
  return rows;
}

// ----------------------------------------------------------------------------
// fetchIndexHistory — public entry keyed by DB symbol (NIFTY50 / MIDCAP150 / …).
// Returns [] for unknown symbols (caller logs + skips).
// ----------------------------------------------------------------------------
async function fetchIndexHistory(symbol, from, to) {
  const def = BY_SYMBOL[symbol];
  if (!def) {
    console.warn(`[indices] unknown index symbol: ${symbol}`);
    return [];
  }
  return fetchIndexHistoryByName(def.nse, from, to, def.yahoo);
}

module.exports = {
  INDICES,
  fetchIndexHistory,
  fetchIndexHistoryByName,
};
