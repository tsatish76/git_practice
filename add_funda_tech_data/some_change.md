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
