  Error refreshing indicators: error: there is no unique or exclusion constraint matching the ON CONFLICT specification
    at D:\Work\Investment_Tracker\Portfolio-Tracker-Backend\node_modules\pg\lib\client.js:545:17
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async upsertFundamentals (D:\Work\Investment_Tracker\Portfolio-Tracker-Backend\routes\stockCurrentData.js:135:5)    at async D:\Work\Investment_Tracker\Portfolio-Tracker-Backend\routes\stockCurrentData.js:190:9 {
  length: 148,
  severity: 'ERROR',
  code: '42P10',
  detail: undefined,
  hint: undefined,
  position: undefined,
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'plancat.c',
  line: '948',
  routine: 'infer_arbiter_indexes'
}




-- 1. Confirm the column rename actually happened
SELECT column_name FROM information_schema.columns
WHERE table_name = 'stockscurrentdata' AND column_name IN ('symbol','nse_scrip_code');

-- 2. Find what blocked the unique index
SELECT symbol, COUNT(*) FROM stockscurrentdata GROUP BY symbol HAVING COUNT(*) > 1;
SELECT COUNT(*) AS null_symbols FROM stockscurrentdata WHERE symbol IS NULL;

-- 3. Collapse duplicates — keep the row with a thesis (else lowest id).
--    Indicators are re-fetchable, so preferring the thesis-bearing row is safe.
DELETE FROM stockscurrentdata a
USING stockscurrentdata b
WHERE a.symbol IS NOT NULL
  AND a.symbol = b.symbol
  AND (
        (b.thesis_markdown IS NOT NULL AND a.thesis_markdown IS NULL)
     OR (
          ((a.thesis_markdown IS NULL) = (b.thesis_markdown IS NULL))
          AND a.id > b.id
        )
      );

-- 4. Drop NULL-symbol orphans (can't be upsert targets, carry no symbol)
DELETE FROM stockscurrentdata WHERE symbol IS NULL AND thesis_markdown IS NULL;

-- 5. Now the unique index will build
CREATE UNIQUE INDEX IF NOT EXISTS uq_stockscurrentdata_symbol
  ON stockscurrentdata(symbol);


