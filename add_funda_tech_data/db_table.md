All files digested. Critical correction to my earlier assumptions, from the real DDL and frontend:

Reality of stockscurrentdata today
Table is stockscurrentdata (double-s), PK = id SERIAL.
Post scrip-code-removal it is effectively a thesis-only table. The frontend keys thesis by rec.nse_scrip_code (which now holds the symbol) and reads only thesis_markdown / thesis_last_updated. Price is derived from stock_price_history, name/fullname from instruments.
Therefore price, marketcap, exchange, date, time, bse_scrip_code, fullname are dead in the current holdings path (only the legacy /api/stocks/bulk + stockCurrentData POST/PUT still write them).
thesis_last_updated TIMESTAMPZ in the DDL is an invalid type (TIMESTAMPZ ≠ TIMESTAMPTZ). The live table must predate this exact block (CREATE TABLE IF NOT EXISTS skipped it), else boot would throw. Verify the live column's real type.
Keying decision

Keep id as PK (so PUT /thesis/:id and stockID = selectedStock.id keep working) and rename nse_scrip_code → symbol + UNIQUE as the upsert key. Clean name, zero thesis breakage.

Final column set (keep / drop / add)

Keep: id (PK), name (drop NOT NULL — instruments is the metadata source), thesis_markdown, thesis_last_updated. Rename: nse_scrip_code → symbol (UNIQUE). Drop: price, exchange, date, time, bse_scrip_code, fullname, marketcap.

Add — cadence & source:

Column	Type	Source	Cadencefundamentals_updated_at	TIMESTAMPTZ	—	quarterly
technicals_updated_at	TIMESTAMPTZ	—	daily
pe_ratio	NUMERIC	summaryDetail.trailingPE	fund
forward_pe	NUMERIC	defaultKeyStatistics.forwardPE	fund
pb_ratio	NUMERIC	priceToBook	fund
peg_ratio	NUMERIC	pegRatio	fund
market_cap	BIGINT	marketCap (raw ₹)	fund
market_cap_category	TEXT	derive vs index constituents	fund
roe	NUMERIC	financialData.returnOnEquity	fund
debt_to_equity	NUMERIC	financialData.debtToEquity	fund
operating_margin	NUMERIC	financialData.operatingMargins	fund
profit_margin	NUMERIC	profitMargins	fund
eps_ttm	NUMERIC	trailingEps	fund
revenue_growth_yoy	NUMERIC	financialData.revenueGrowth	fund
profit_growth_yoy	NUMERIC	financialData.earningsGrowth	fund
margin_trend	TEXT	derived from fundamentalsTimeSeries	fund
margin_history	JSONB	last 4 qtr op-margins	fund
profit_growth_trend	TEXT	derived	fund
profit_growth_history	JSONB	last 4 qtr net income	fund
current_price	NUMERIC	price.regularMarketPrice	tech
prev_close	NUMERIC	regularMarketPreviousClose	tech
day_change_pct	NUMERIC	regularMarketChangePercent	tech
week52_high / week52_low	NUMERIC	summaryDetail.fiftyTwoWeek*	tech
dma_50 / dma_200	NUMERIC	fiftyDayAverage / twoHundredDayAverage	tech
avg_volume	BIGINT	averageDailyVolume3Month	tech
rsi_14	NUMERIC	computed (gap-fill from stock_price_history)	tech
beta	NUMERIC	defaultKeyStatistics.beta	tech
analyst_target	NUMERIC	financialData.targetMeanPrice (auto)	fund
analyst_target_manual	BOOLEAN	user-edit flag	—

Yahoo field availability per prior source audit. Not stored (derive on read): pct_from_52w_high/low, price_vs_200dma, pct_to_target.

analyst_target rule: sync fills it only whenanalyst_target_manual = false; the edit endpoint sets the flag true → auto-sync never clobbers a manual value. Deterministic, editable.

Migration (append to createTables(), matches your IF NOT EXISTS / instruments-enrichment style)
-- one-time rename: nse_scrip_code (holds symbol) -> symbol
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='stockscurrentdata' AND column_name='nse_scrip_code')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='stockscurrentdata' AND column_name='symbol') THEN
    ALTER TABLE stockscurrentdata RENAME COLUMN nse_scrip_code TO symbol;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stockscurrentdata_symbol
  ON stockscurrentdata(symbol);

ALTER TABLE stockscurrentdata ALTER COLUMN name DROP NOT NULL;

-- fix invalid type if the live column is TIMESTAMPZ/text
ALTER TABLE stockscurrentdata
  ALTER COLUMN thesis_last_updated TYPE TIMESTAMPTZ
  USING thesis_last_updated::timestamptz;

-- drop dead scrip-code / price-snapshot columns
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS price;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS marketcap;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS exchange;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS date;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS time;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS bse_scrip_code;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS fullname;

-- cadence stamps
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS fundamentals_updated_at TIMESTAMPTZ;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS technicals_updated_at   TIMESTAMPTZ;

-- valuation
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS pe_ratio    NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS forward_pe  NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS pb_ratio    NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS peg_ratio   NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS market_cap  BIGINT;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS market_cap_category TEXT;

-- quality
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS roe              NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS debt_to_equity   NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS operating_margin NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_margin    NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS eps_ttm          NUMERIC;

-- growth + trend
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS revenue_growth_yoy    NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_growth_yoy     NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS margin_trend          TEXT;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS margin_history        JSONB;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_growth_trend   TEXT;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_growth_history JSONB;

-- technical
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS current_price  NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS prev_close     NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS day_change_pct NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS week52_high    NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS week52_low     NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS dma_50         NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS dma_200        NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS avg_volume     BIGINT;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS rsi_14         NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS beta           NUMERIC;

-- exit reference
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS analyst_target        NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS analyst_target_manual BOOLEAN DEFAULT false;

Lockstep code changes the migration forces (must ship together)
stockCurrentData.js — GET/POST/PUT select+write dropped columns (price, marketcap, exchange, date, time, nse_scrip_code, bse_scrip_code, fullname). Rewrite: GET returns symbol + thesis + indicators; add an UPSERT-by-symbol indicator writer; keep /thesis/:id.
server.js /api/stocks/bulk — legacy scrip-code price snapshot writer; retire it (holdings price now comes from stock_price_history).
stocklist.jsx — stockThesisData.find(rec => rec.nse_scrip_code === …) and thesisBySymbol keying → change nse_scrip_code to symbol (2 refs).
stockService.js — updateScripCodes (writes to /stockscurrentdata/:id) is dead; replace with getStockCurrentData() + refreshIndicators() calls.
Two firm calls (reversible)
Drop promoter_holding_pct — no clean yahoo-finance2 source for NSE tickers (same reason pledge/ROCE were dropped). Keeping in-Yahoo boundary; re-add via NSE/Screener later if wanted.
name kept but nullable; can be dropped entirely later since instruments is the metadata source.
Next

Backend service skeleton, in this order: services/stockIndicatorService.js (quoteSummary + fundamentalsTimeSeries + RSI gap-fill, reusing prices.js concurrency/jitter/retry pattern) → indicator UPSERT route in stockCurrentData.js → wire in server.js.

Confirm the two firm calls and I'll emit the service + route (full files, not snippets), reusing mapWithConcurrency/toISTDateKey from prices.js rather than reinventing them.
