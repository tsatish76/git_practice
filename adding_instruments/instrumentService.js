/**
 * ============================================================================
 * INSTRUMENT SERVICE - API Abstraction Layer
 * ============================================================================
 * Mirrors stockService.js: pure API communication, no state, no setState.
 * Throws meaningful errors; callers handle them.
 *
 * Endpoints:
 *   fetchInstruments()        GET  /instruments
 *   previewInstrumentSync()   POST /instruments/sync/preview
 *   commitInstrumentSync()    POST /instruments/sync/commit
 * ============================================================================
 */

const BASE_URL = import.meta.env.VITE_BACKEND_URL;

const handle = async (response, fallbackMessage) => {
  if (!response.ok) {
    let msg = fallbackMessage;
    try {
      const err = await response.json();
      if (err && err.error) msg = err.error;
    } catch {
      /* keep fallback */
    }
    throw new Error(msg);
  }
  return response.json();
};

/**
 * Fetch all instruments (EQ + MF), including isin + scrip_code.
 * @returns {Promise<Array<{symbol,name,asset_type,isin,scrip_code}>>}
 */
export const fetchInstruments = async () => {
  const response = await fetch(`${BASE_URL}/instruments`);
  return handle(response, "Failed to fetch instruments");
};

/**
 * Read-only preview of the master sync.
 * @returns {Promise<{stats, toAdd, toEnrich}>}
 */
export const previewInstrumentSync = async () => {
  const response = await fetch(`${BASE_URL}/instruments/sync/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return handle(response, "Failed to preview instrument sync");
};

/**
 * Commit selected rows from the preview.
 * @param {{toAdd:Array, toEnrich:Array}} payload
 * @returns {Promise<{status, added, enriched}>}
 */
export const commitInstrumentSync = async (payload) => {
  const response = await fetch(`${BASE_URL}/instruments/sync/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(response, "Failed to commit instrument sync");
};
