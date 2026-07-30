// ============================================================================
// indexService.js
// ----------------------------------------------------------------------------
// Historical index (benchmark) data for the portfolio tracker.
//
// SOURCE: niftyindices.com (NSE Indices Ltd — the ORIGIN of all Nifty index
//   history). We emulate the exact XHR its own "Historical Data" page fires:
//       POST https://www.niftyindices.com/Backpage.aspx/getHistoricaldatatabletoString
//
// TWO LOAD-BEARING REQUIREMENTS (verified wire spec):
//   1. HOST MUST BE www.niftyindices.com.
//      The bare host (niftyindices.com) 301-redirects to www; axios follows the
//      redirect but a POST body/method is not preserved across 3xx → server
//      gets no cinfo → returns empty. This silently broke ALL indices.
//   2. cinfo MUST be a SINGLE-QUOTED pseudo-JSON string (ASP.NET ScriptService
//      convention): {'name':'NIFTY 50',...}. Standard JSON (double quotes)
//      returns {"d":"[]"} — no error, just empty.
//
// UA TRAP: a non-browser User-Agent does NOT 403 — the server accepts the POST
//   then never sends a body (client stalls to timeout). UA must start "Mozilla/5.0".
//
// NAME MATCHING: `name` must match the dropdown spelling EXACTLY, else d:"[]".
//   Broad-market names are spaced uppercase: NIFTY 50 / NIFTY MIDCAP 150 /
//   NIFTY SMALLCAP 250 (all verified, ~5,243 rows since 01-Apr-2005).
//
// SOURCE STRATEGY (per index):
//   PRIMARY  : niftyindices  (covers all three)
//   FALLBACK : Yahoo         (ONLY where a ticker exists → Nifty 50 = ^NSEI)
//
// PUBLIC API:
//   INDICES                       → [{ symbol, nse, yahoo }]
//   fetchIndexHistory(sym,f,t)    → [{ date:"YYYY-MM-DD", close:number }] by DB symbol
//   fetchIndexHistoryByName(...)  → same, by raw NSE index name
// ============================================================================
const axios = require("axios");
const YahooFinance = require("yahoo-finance2").default;

const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical"],
});

// ----------------------------------------------------------------------------
// CONFIG — single source of truth: DB symbol -> exact NSE index name + Yahoo.
// ----------------------------------------------------------------------------
const INDICES = [
  { symbol: "NIFTY50",     nse: "NIFTY 50",           yahoo: "^NSEI" },
  { symbol: "MIDCAP150",   nse: "NIFTY MIDCAP 150",   yahoo: null    },
  { symbol: "SMALLCAP250", nse: "NIFTY SMALLCAP 250", yahoo: null    },
];

const BY_SYMBOL = Object.fromEntries(INDICES.map((i) => [i.symbol, i]));

// niftyindices base — MUST be the www host (see header note #1).
const NIFTY_BASE = "https://www.niftyindices.com";

// ----------------------------------------------------------------------------
// Pacing (env-tunable). Spec: ~1s between calls, exp backoff on 4xx/5xx.
// ----------------------------------------------------------------------------
const INDEX_FETCH_MIN_DELAY_MS =
  Number(process.env.INDEX_FETCH_MIN_DELAY_MS) || 1000;
const INDEX_FETCH_MAX_RETRIES =
  Number(process.env.INDEX_FETCH_MAX_RETRIES) || 3;

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

// yyyy-mm-dd -> DD-Mon-YYYY (niftyindices request format, e.g. "01-Jul-2026")
function toNiftyDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${NIFTY_MONTHS[Number(m) - 1]}-${y}`;
}

// Response date is "DD MMM YYYY" (spaces, e.g. "22 May 2026") OR "DD-MMM-YYYY".
// Normalise dashes to spaces; JS Date parses "22 May 2026" reliably.
function parseNiftyDate(raw) {
  if (!raw) return null;
  const dt = new Date(String(raw).trim().replace(/-/g, " "));
  return isNaN(dt.getTime()) ? null : dt;
}

// ----------------------------------------------------------------------------
// Request scaffolding (www host everywhere)
// ----------------------------------------------------------------------------
const NIFTY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const NIFTY_HEADERS = {
  "User-Agent": NIFTY_UA,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Content-Type": "application/json; charset=UTF-8",
  Origin: NIFTY_BASE,
  Referer: `${NIFTY_BASE}/reports/historical-data`,
  "X-Requested-With": "XMLHttpRequest",
};

// Defensive cookie bootstrap (Akamai). Short sub-timeout: when Akamai is
// hostile the HTML page can hang while the API endpoint still answers.
async function primeNiftyCookie() {
  try {
    const r = await axios.get(`${NIFTY_BASE}/reports/historical-data`, {
      headers: { "User-Agent": NIFTY_UA },
      timeout: 5000,
    });
    const sc = r.headers["set-cookie"];
    return Array.isArray(sc) ? sc.map((c) => c.split(";")[0]).join("; ") : "";
  } catch (e) {
    console.warn(`[indices] cookie prime skipped: ${e.message}`);
    return "";
  }
}

// Single niftyindices POST for one (already-chunked) date window.
async function niftyPost(nseName, fromIso, toIso, cookie) {
  // Single-quoted pseudo-JSON (NOT JSON.stringify — see header note #2).
  const cinfo =
    `{'name':'${nseName}',` +
    `'startDate':'${toNiftyDate(fromIso)}',` +
    `'endDate':'${toNiftyDate(toIso)}',` +
    `'indexName':'${nseName}'}`;

  const resp = await axios.post(
    `${NIFTY_BASE}/Backpage.aspx/getHistoricaldatatabletoString`,
    { cinfo },
    {
      headers: { ...NIFTY_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
      timeout: 60000,
      maxRedirects: 0, // never let a 3xx silently swallow the POST body
      validateStatus: (s) => s >= 200 && s < 400,
    }
  );

  // resp.data.d is a JSON-encoded string array; axios already parsed the envelope.
  const raw = resp?.data?.d;
  const recs =
    typeof raw === "string"
      ? JSON.parse(raw)
      : Array.isArray(raw)
      ? raw
      : Array.isArray(resp?.data)
      ? resp.data
      : [];

  // Diagnostic: distinguish "empty result" from "wrong shape/name" without guessing.
  if (!recs.length) {
    const preview =
      typeof resp?.data === "string"
        ? resp.data.slice(0, 200)
        : JSON.stringify(resp?.data ?? {}).slice(0, 200);
    console.warn(
      `[indices] ${nseName} ${fromIso}->${toIso}: 0 records. ` +
        `HTTP ${resp.status}. Response preview: ${preview}`
    );
  }

  const out = [];
  recs.forEach((r) => {
    const closeRaw =
      r.CLOSE ?? r.Close ?? r.close ?? r.EOD_CLOSE_INDEX_VAL;
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
// fetchFromNifty  (PRIMARY)
// Spec verifies single-call multi-year ranges succeed (~7K rows), so no yearly
// chunking is needed — one POST per index. Retboth on transient failure.
// ----------------------------------------------------------------------------
async function fetchFromNifty(nseName, from, to) {
  const cookie = await primeNiftyCookie();
  const fromIso = new Date(from).toISOString().slice(0, 10);
  const toIso = new Date(to).toISOString().slice(0, 10);

  let rows = [];
  for (let attempt = 1; attempt <= INDEX_FETCH_MAX_RETRIES; attempt++) {
    try {
      rows = await niftyPost(nseName, fromIso, toIso, cookie);
      if (rows.length) break;
    } catch (e) {
      console.warn(
        `[indices] niftyindices ${nseName} attempt ` +
          `${attempt}/${INDEX_FETCH_MAX_RETRIES} failed: ${e.message}`
      );
    }
    if (attempt < INDEX_FETCH_MAX_RETRIES) {
      await sleep(jitter(INDEX_FETCH_MIN_DELAY_MS * 2 ** (attempt - 1))); // 1s→2s→4s
    }
  }
  return dedupeSort(rows);
}

// ----------------------------------------------------------------------------
// fetchFromYahooIndex  (FALLBACK — ticker-gated; Nifty 50 only)
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
    `[indices] ${nseName}: ${rows.length} row(s) from ${source} (${from} → ${to})`
  );
  return rows;
}

// ----------------------------------------------------------------------------
// fetchIndexHistory — public entry keyed by DB symbol.
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
