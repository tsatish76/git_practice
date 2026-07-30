// ============================================================================
// _diagIndex.js — standalone niftyindices probe (run OUTSIDE the app)
// ----------------------------------------------------------------------------
// Purpose: isolate the endpoint from Express/DB so we see the RAW server reply.
// Run:  node services/_diagIndex.js
// It prints, for each index: HTTP status, the raw `d` preview, and parsed count.
// This tells us definitively whether the fix works and, if not, the exact
// server response (empty array vs 403 vs redirect vs wrong field names).
// ============================================================================
const axios = require("axios");

const BASE = "https://www.niftyindices.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Content-Type": "application/json; charset=UTF-8",
  Origin: BASE,
  Referer: `${BASE}/reports/historical-data`,
  "X-Requested-With": "XMLHttpRequest",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const toNiftyDate = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};

async function prime() {
  try {
    const r = await axios.get(`${BASE}/reports/historical-data`, {
      headers: { "User-Agent": UA },
      timeout: 5000,
    });
    const sc = r.headers["set-cookie"];
    return Array.isArray(sc) ? sc.map((c) => c.split(";")[0]).join("; ") : "";
  } catch (e) {
    console.log(`  [prime] skipped: ${e.message}`);
    return "";
  }
}

async function probe(name, from, to, cookie) {
  const cinfo =
    `{'name':'${name}',` +
    `'startDate':'${toNiftyDate(from)}',` +
    `'endDate':'${toNiftyDate(to)}',` +
    `'indexName':'${name}'}`;

  console.log(`\n=== ${name} (${from} → ${to}) ===`);
  console.log(`  cinfo: ${cinfo}`);

  try {
    const resp = await axios.post(
      `${BASE}/Backpage.aspx/getHistoricaldatatabletoString`,
      { cinfo },
      {
        headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
        timeout: 60000,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      }
    );

    console.log(`  HTTP: ${resp.status}`);
    const raw = resp?.data?.d;
    console.log(`  typeof d: ${typeof raw}`);

    if (typeof raw === "string") {
      console.log(`  d preview: ${raw.slice(0, 220)}`);
      let recs = [];
      try { recs = JSON.parse(raw); } catch (e) { console.log(`  JSON.parse(d) failed: ${e.message}`); }
      console.log(`  parsed records: ${recs.length}`);
      if (recs.length) console.log(`  sample record:`, recs[0]);
    } else {
      console.log(`  resp.data preview: ${JSON.stringify(resp?.data ?? {}).slice(0, 220)}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    if (e.response) {
      console.log(`  status: ${e.response.status}`);
      const b = e.response.data;
      console.log(`  body: ${(typeof b === "string" ? b : JSON.stringify(b)).slice(0, 220)}`);
    }
  }
}

(async () => {
  const from = "2026-07-01";
  const to = "2026-07-28";
  const cookie = await prime();
  console.log(`cookie: ${cookie ? "obtained" : "(none)"}`);

  await probe("NIFTY 50", from, to, cookie);
  await new Promise((r) => setTimeout(r, 1200));
  await probe("NIFTY MIDCAP 150", from, to, cookie);
  await new Promise((r) => setTimeout(r, 1200));
  await probe("NIFTY SMALLCAP 250", from, to, cookie);
})();
