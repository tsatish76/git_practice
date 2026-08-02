// ============================================================================
// stockIndicatorService.js   (place in routes/ — same dir as indexService.js)
// ----------------------------------------------------------------------------
// Fetches + computes the fundamental & technical indicator layer for held
// stocks and returns plain scalar objects ready for UPSERT into
// stockscurrentdata. NO DB writes here (route owns persistence).
//
// SOURCES
//   quoteSummary(summaryDetail, defaultKeyStatistics, financialData, price)
//     -> valuation, quality, growth, DMA, 52w, volume, beta, price, target
//   fundamentalsTimeSeries(type:'quarterly', module:'financials')
//     -> operating-margin & net-income series -> margin/profit-growth trend
//   rsi_14 -> COMPUTED (Wilder) from stored closes (gap-fill), never from Yahoo
//
// DESIGN
//   - Symbol resolution: .NS first, .BO fallback (same order as price chain).
//   - Missing Yahoo fields -> null (never coerced to 0).
//   - Self-contained concurrency/jitter/retry: prices.js does not export its
//     helpers, so they are replicated here rather than reaching across modules.
//   - Two payload classes returned separately so the route can stamp
//     fundamentals_updated_at vs technicals_updated_at independently.
//
// COMPAT NOTE (yahoo-finance2 v3.x, resolved from ^3.11.2):
//   fundamentalsTimeSeries IS available in v3. The `module` enum is
//   financials | balance-sheet | cash-flow | all (NOT "income_statement").
//   Returned row keys differ by minor version: some emit UNPREFIXED
//   (totalRevenue, netIncome), others PREFIXED (quarterlyTotalRevenue,
//   quarterlyNetIncome). Both are read defensively below.
// ============================================================================

const YahooFinance = require("yahoo-finance2").default;
const yahooFinance = new YahooFinance({ suppressNotices: ["ripHistorical"] });

// ── concurrency / pacing (env-tunable) ──────────────────────────────────────
const IND_CONCURRENCY  = Number(process.env.INDICATOR_FETCH_CONCURRENCY) || 2;
const IND_MIN_DELAY_MS = Number(process.env.INDICATOR_FETCH_MIN_DELAY_MS) || 400;
const IND_MAX_RETRIES  = Number(process.env.INDICATOR_FETCH_MAX_RETRIES) || 3;

const sleep  = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * base);

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
    }
  );
  await Promise.all(runners);
  return results;
}

// ── small numeric guards ─────────────────────────────────────────────────────
const num = (v) =>
  v == null || Number.isNaN(Number(v)) || !Number.isFinite(Number(v))
    ? null
    : Number(v);

// yahoo-finance2 sometimes returns { raw, fmt } objects; unwrap defensively.
const raw = (v) => (v && typeof v === "object" && "raw" in v ? v.raw : v);

// pick first non-null among candidate keys, unwrapping raw
const pick = (obj, keys) => {
  for (const k of keys) {
    const val = num(raw(obj?.[k]));
    if (val != null) return val;
  }
  return null;
};

// ── RSI-14 (Wilder) ──────────────────────────────────────────────────────────
// closes MUST be ascending, deduped. Needs >= period+1 points; else null.
function computeRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

// ── market-cap category (heuristic, ₹) ───────────────────────────────────────
// Rough SEBI-style buckets by absolute market cap. Not exchange-official; a
// constituent-list join would be exact but is out of scope for this pass.
function marketCapCategory(marketCapRupees) {
  const cr = marketCapRupees != null ? marketCapRupees / 1e7 : null; // ₹ -> Cr
  if (cr == null) return null;
  if (cr >= 50000) return "Large";
  if (cr >= 15000) return "Mid";
  return "Small";
}

// ── trend direction from an ascending value series ───────────────────────────
// Compares latest vs mean of prior points; flat band = ±2% relative.
function trendDirection(series) {
  const vals = (series || []).filter((v) => num(v) != null).map(Number);
  if (vals.length < 2) return null;
  const latest = vals[vals.length - 1];
  const prior = vals.slice(0, -1);
  const priorMean = prior.reduce((s, v) => s + v, 0) / prior.length;
  if (priorMean === 0) return null;
  const rel = (latest - priorMean) / Math.abs(priorMean);
  if (rel > 0.02) return "up";
  if (rel < -0.02) return "down";
  return "flat";
}

// ============================================================================
// quoteSummary fetch (.NS -> .BO), with retry/backoff on transient failure.
// Returns the merged modules object or null.
// ============================================================================
async function fetchQuoteSummary(symbol) {
  const modules = [
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "price",
  ];
  for (let attempt = 1; attempt <= IND_MAX_RETRIES; attempt++) {
    for (const suffix of ["NS", "BO"]) {
      try {
        const res = await yahooFinance.quoteSummary(`${symbol}.${suffix}`, {
          modules,
        });
        if (res && res.price) return res;
      } catch {
        /* try next suffix / attempt */
      }
    }
    if (attempt < IND_MAX_RETRIES) {
      await sleep(jitter(IND_MIN_DELAY_MS * 2 ** attempt));
    }
  }
  return null;
}

// ============================================================================
// fundamentalsTimeSeries -> last-4-quarter operating margin & net income.
// Non-fatal: returns { marginHistory:[], profitHistory:[] } on any failure so
// the fundamentals payload still ships with trend = null.
// ============================================================================
async function fetchQuarterlyTrends(symbol) {
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 2); // ~8 quarters headroom
  const opts = {
    period1,
    type: "quarterly",
    module: "financials", // valid enum; income-statement lives under "financials"
  };
  for (const suffix of ["NS", "BO"]) {
    try {
      const rows = await yahooFinance.fundamentalsTimeSeries(
        `${symbol}.${suffix}`,
        opts
      );
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // ascending by date
      const asc = [...rows].sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      );
      const last4 = asc.slice(-4);

      // keys vary by minor version: unprefixed OR quarterly-prefixed
      const revOf = (r) => pick(r, ["totalRevenue", "quarterlyTotalRevenue"]);
      const opOf  = (r) => pick(r, ["operatingIncome", "quarterlyOperatingIncome"]);
      const niOf  = (r) => pick(r, ["netIncome", "quarterlyNetIncome"]);

      const marginHistory = last4
        .map((r) => {
          const rev = revOf(r);
          const op = opOf(r);
          return rev && op != null
            ? parseFloat(((op / rev) * 100).toFixed(2))
            : null;
        })
        .filter((v) => v != null);

      const profitHistory = last4.map(niOf).filter((v) => v != null);

      if (marginHistory.length || profitHistory.length) {
        return { marginHistory, profitHistory };
      }
    } catch {
      /* try next suffix */
    }
  }
  return { marginHistory: [], profitHistory: [] };
}

// ============================================================================
// buildFundamentals(symbol) -> scalar payload for the quarterly cadence.
// ============================================================================
async function buildFundamentals(symbol) {
  const qs = await fetchQuoteSummary(symbol);
  if (!qs) return null;

  const sd = qs.summaryDetail || {};
  const ks = qs.defaultKeyStatistics || {};
  const fd = qs.financialData || {};

  const marketCap = num(raw(sd.marketCap ?? qs.price?.marketCap));

  const { marginHistory, profitHistory } = await fetchQuarterlyTrends(symbol);

  return {
    symbol,
    // valuation
    pe_ratio: num(raw(sd.trailingPE)),
    forward_pe: num(raw(ks.forwardPE ?? sd.forwardPE)),
    pb_ratio: num(raw(ks.priceToBook)),
    peg_ratio: num(raw(ks.pegRatio)),
    market_cap: marketCap != null ? Math.round(marketCap) : null,
    market_cap_category: marketCapCategory(marketCap),
    // quality
    roe: num(raw(fd.returnOnEquity)),
    debt_to_equity: num(raw(fd.debtToEquity)),
    operating_margin: num(raw(fd.operatingMargins)),
    profit_margin: num(raw(fd.profitMargins ?? ks.profitMargins)),
    eps_ttm: num(raw(ks.trailingEps)),
    // growth
    revenue_growth_yoy: num(raw(fd.revenueGrowth)),
    profit_growth_yoy: num(raw(fd.earningsGrowth)),
    // trends
    margin_trend: trendDirection(marginHistory),
    margin_history: marginHistory.length ? marginHistory : null,
    profit_growth_trend: trendDirection(profitHistory),
    profit_growth_history: profitHistory.length ? profitHistory : null,
    // exit reference (auto value; route decides whether to apply based on flag)
    analyst_target: num(raw(fd.targetMeanPrice)),
  };
}

// ============================================================================
// buildTechnicals(symbol, storedCloses) -> scalar payload for daily cadence.
// storedCloses: ascending [{date, close}] from stock_price_history (trusted).
// RSI is computed from storedCloses; a small gap fetch runs ONLY when there
// are < period+1 usable closes.
// ============================================================================
async function buildTechnicals(symbol, storedCloses = []) {
  const qs = await fetchQuoteSummary(symbol);
  if (!qs) return null;

  const sd = qs.summaryDetail || {};
  const ks = qs.defaultKeyStatistics || {};
  const pr = qs.price || {};

  // ── RSI: reuse stored closes; gap-fetch only if insufficient ──────────────
  let closes = (storedCloses || [])
    .filter((r) => r && r.close != null && r.date)
    .map((r) => ({ date: String(r.date).slice(0, 10), close: Number(r.close) }))
    .filter((r) => Number.isFinite(r.close));

  if (closes.length < 15) {
    const fetched = await fetchRecentCloses(symbol, 45);
    const merged = new Map();
    [...closes, ...fetched].forEach((r) => merged.set(r.date, r.close));
    closes = [...merged.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, close]) => ({ date, close }));
  } else {
    // enforce deterministic order + dedupe even for trusted data
    const m = new Map();
    closes.forEach((r) => m.set(r.date, r.close));
    closes = [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, close]) => ({ date, close }));
  }

  const rsi_14 = computeRSI(closes.map((r) => r.close), 14);

  const dayChange = num(raw(pr.regularMarketChangePercent));

  return {
    symbol,
    current_price: num(raw(pr.regularMarketPrice)),
    prev_close: num(raw(pr.regularMarketPreviousClose ?? sd.regularMarketPreviousClose)),
    // Yahoo returns change percent as a fraction (0.0123) -> store as 1.23
    day_change_pct: dayChange != null ? parseFloat((dayChange * 100).toFixed(2)) : null,
    week52_high: num(raw(sd.fiftyTwoWeekHigh)),
    week52_low: num(raw(sd.fiftyTwoWeekLow)),
    dma_50: num(raw(sd.fiftyDayAverage)),
    dma_200: num(raw(sd.twoHundredDayAverage)),
    avg_volume: num(raw(sd.averageDailyVolume3Month))
      ? Math.round(num(raw(sd.averageDailyVolume3Month)))
      : null,
    rsi_14,
    beta: num(raw(ks.beta ?? sd.beta)),
  };
}

// ── minimal trailing-close fetch, RSI gap-fill only (not persisted) ──────────
async function fetchRecentCloses(symbol, calendarDays = 45) {
  const period1 = new Date(Date.now() - calendarDays * 864e5);
  for (const suffix of ["NS", "BO"]) {
    try {
      const chart = await yahooFinance.chart(`${symbol}.${suffix}`, {
        period1,
        interval: "1d",
      });
      const quotes = chart?.quotes || [];
      const rows = quotes
        .filter((q) => q && q.date && q.close != null)
        .map((q) => ({
          date: new Date(q.date).toISOString().slice(0, 10),
          close: Number(q.close),
        }))
        .filter((r) => Number.isFinite(r.close));
      if (rows.length) return rows;
    } catch {
      /* try next suffix */
    }
  }
  return [];
}

// ============================================================================
// Batch entry points. `symbols` = ['INFY', ...]; storedClosesMap keyed by symbol.
// Bounded concurrency + inter-request jitter (mirrors prices.js discipline).
// Returns { data:[payload...], failed:[symbol...] }.
// ============================================================================
async function refreshFundamentals(symbols) {
  const failed = [];
  const data = (
    await mapWithConcurrency(symbols, IND_CONCURRENCY, async (symbol) => {
      const payload = await buildFundamentals(symbol);
      await sleep(jitter(IND_MIN_DELAY_MS));
      if (!payload) failed.push(symbol);
      return payload;
    })
  ).filter(Boolean);
  return { data, failed };
}

async function refreshTechnicals(symbols, storedClosesMap = {}) {
  const failed = [];
  const data = (
    await mapWithConcurrency(symbols, IND_CONCURRENCY, async (symbol) => {
      const payload = await buildTechnicals(symbol, storedClosesMap[symbol] || []);
      await sleep(jitter(IND_MIN_DELAY_MS));
      if (!payload) failed.push(symbol);
      return payload;
    })
  ).filter(Boolean);
  return { data, failed };
}

module.exports = {
  refreshFundamentals,
  refreshTechnicals,
  // exported for unit tests / reuse
  computeRSI,
  trendDirection,
  marketCapCategory,
  buildFundamentals,
  buildTechnicals,
};
