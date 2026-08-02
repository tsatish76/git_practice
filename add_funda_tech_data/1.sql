-- ============================================================================
-- stockscurrentdata migration — indicator layer
-- Append these statements to createTables() inside the BEGIN/COMMIT block,
-- after the existing stockscurrentdata CREATE TABLE. All are idempotent
-- (IF NOT EXISTS / guarded rename), matching the instruments-enrichment style.
-- ============================================================================

-- one-time rename: nse_scrip_code (now holds the symbol) -> symbol
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'stockscurrentdata' AND column_name = 'nse_scrip_code')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'stockscurrentdata' AND column_name = 'symbol') THEN
    ALTER TABLE stockscurrentdata RENAME COLUMN nse_scrip_code TO symbol;
  END IF;
END $$;

-- symbol is the canonical upsert key
CREATE UNIQUE INDEX IF NOT EXISTS uq_stockscurrentdata_symbol
  ON stockscurrentdata(symbol);

-- (thesis_last_updated confirmed TIMESTAMPTZ in live DB — no type fix needed)

-- drop dead scrip-code / price-snapshot / metadata columns
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS price;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS marketcap;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS exchange;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS date;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS time;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS bse_scrip_code;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS fullname;
ALTER TABLE stockscurrentdata DROP COLUMN IF EXISTS name;

-- cadence stamps
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS fundamentals_updated_at TIMESTAMPTZ;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS technicals_updated_at   TIMESTAMPTZ;

-- valuation (quarterly)
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS pe_ratio            NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS forward_pe          NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS pb_ratio            NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS peg_ratio           NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS market_cap          BIGINT;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS market_cap_category TEXT;

-- quality (quarterly)
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS roe              NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS debt_to_equity   NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS operating_margin NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_margin    NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS eps_ttm          NUMERIC;

-- growth + trend (quarterly)
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS revenue_growth_yoy    NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_growth_yoy     NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS margin_trend          TEXT;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS margin_history        JSONB;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_growth_trend   TEXT;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS profit_growth_history JSONB;

-- technical (daily)
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

-- exit reference (auto-fill unless manually overridden)
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS analyst_target        NUMERIC;
ALTER TABLE stockscurrentdata ADD COLUMN IF NOT EXISTS analyst_target_manual BOOLEAN DEFAULT false;
