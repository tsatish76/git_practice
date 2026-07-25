**Issue**
`fetchStockPrices` in `prices.js` fires every symbol concurrently:

```js
const promises = symbolRanges.map(async ({ symbol, from, to }) => { ... });
return Promise.all(promises);
```

For a 20–40 stock portfolio, that's 20–40 simultaneous requests hitting NSE (and Yahoo on fallback) in the same tick.

**Root Cause**
NSE's public JSON endpoints and Yahoo both apply per-IP anti-bot rate limiting. `Promise.all` over `.map` has **no concurrency cap and no spacing** — a burst of N parallel requests from one IP looks like scraping and gets throttled/denied (429 / connection reset / empty body). Your dual-source fallback then also fires in the same burst, doubling pressure. This is why failures are intermittent and correlated with portfolio size, not specific symbols.

Indices are unaffected — `/update_indices` already loops sequentially with `await`.

**Fix**
Bound concurrency to a small pool (default 3), add inter-request jitter, and retry rate-limited symbols with exponential backoff. Deterministic ordering preserved; only the dispatch is throttled. All three knobs are env-tunable.

**Code** — drop-in replacement for the `fetchStockPrices` section in `prices.js` (and the two helpers above it stay as-is):

```js
// ----------------------------------------------------------------------------
// Concurrency + pacing config (env-tunable; safe defaults for NSE/Yahoo)
// ----------------------------------------------------------------------------
const PRICE_FETCH_CONCURRENCY = Number(process.env.PRICE_FETCH_CONCURRENCY) || 3;
const PRICE_FETCH_MIN_DELAY_MS = Number(process.env.PRICE_FETCH_MIN_DELAY_MS) || 250;
const PRICE_FETCH_MAX_RETRIES = Number(process.env.PRICE_FETCH_MAX_RETRIES) || 3;

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
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// ----------------------------------------------------------------------------
// fetchOneSymbol
// NSE → Yahoo(NS) → Yahoo(BO) fallback for a single symbol, with retry.
// Empty result triggers backoff+retry (treats throttle/empty as transient).
// ----------------------------------------------------------------------------
async function fetchOneSymbol({ symbol, from, to }) {
  const end = new Date(to);
  end.setDate(end.getDate() + 1);
  const toStr = end.toISOString().slice(0, 10);

  for (let attempt = 1; attempt <= PRICE_FETCH_MAX_RETRIES; attempt++) {
    let history = await fetchFromNSE(symbol, from, toStr);
    let source = "nse";
    if (!history.length) { history = await fetchFromYahoo(symbol, from, toStr, "NS"); source = "yahoo-ns"; }
    if (!history.length) { history = await fetchFromYahoo(symbol, from, toStr, "BO"); source = "yahoo-bo"; }

    if (history.length) {
      console.log(`[prices] ${symbol}: fetched ${history.length} row(s) from ${source} (attempt ${attempt})`);
      return { symbol, history };
    }

    if (attempt < PRICE_FETCH_MAX_RETRIES) {
      const backoff = jitter(PRICE_FETCH_MIN_DELAY_MS * 2 ** attempt); // 500→1000→2000ms + jitter
      console.warn(`[prices] ${symbol}: empty (attempt ${attempt}/${PRICE_FETCH_MAX_RETRIES}), backing off ${backoff}ms`);
      await sleep(backoff);
    }
  }

  console.warn(`[prices] ${symbol}: no data after ${PRICE_FETCH_MAX_RETRIES} attempts for range ${from} → ${to}`);
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
    }
  );
}
```

**What changed**

* Max **3** symbols in flight instead of all N.
* **250–500 ms jittered gap** between requests on each runner.
* Failed/empty symbols retried up to **3×** with 500→1000→2000 ms jittered backoff (recovers the throttled ones instead of losing them).
* Output array order unchanged; `/update_stocks` handler and `savePriceHistory` need no edits.

**Tuning** (`.env`, if still throttled): drop `PRICE_FETCH_CONCURRENCY=2`, raise `PRICE_FETCH_MIN_DELAY_MS=500`.

**Trade-off**
40 stocks now take roughly `40 / 3 × (~fetch + ~350 ms)` ≈ several seconds longer per full refresh. Acceptable — price ingestion is a background/manual action, and the current failure mode is dropped data, not slowness. If you later need speed back, the right lever is server-side caching of already-fetched `(symbol, date)` ranges (you already dedupe on `ON CONFLICT DO NOTHING`), not higher concurrency.

One caveat: this throttles per **server process**. On Vercel/serverless with concurrent invocations the effective rate is per-instance, not global — if you still see denials under parallel user actions, we'd need a shared token-bucket (Redis/Neon-backed). Flag it and I'll spec that.
