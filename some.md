    // ── COMPARISON MODE (TWR normalized to base 100) ──────────────────────
    // SINGLE RETURN ENGINE (parity with StockPerformanceChart FIX #3).
    // Chain-link the SAME market-only daily return (row.returns === returnPct
    // from buildMFPortfolioSeries) that solo-mode summaryStats.pctGain uses,
    // so the plotted line == the header TWR% and can never diverge.
    //
    // OLD BUG: inline Modified Dietz used cf = row.cashFlow, whose MF sign is
    // XIRR-convention (BUY negative). Modified Dietz expects BUY positive, so
    // every BUY double-counted the contribution as return — inflating the
    // portfolio line while the naive base-100 benchmark stayed flat.
    // buildMFPortfolioSeries already neutralises flow: gain = V(T)-V(T-1)+cashFlow,
    // giving a clean market-only returnPct. Just compound it.
    const benchmarkBase = {};
    activeBenchmarks.forEach(b => {
      const first = filteredSeries.find(r => r[b] != null);
      benchmarkBase[b] = first ? first[b] : null;
    });
    let twrIndex = 100;
    return filteredSeries.map((row, i) => {
      const point = { date: row.date };
      // Portfolio TWR (base-100) — chain-linked daily market return.
      if (i === 0) {
        point.portfolio = 100;
      } else if (row.portfolio > 0) {
        twrIndex *= (1 + (row.returns ?? 0) / 100);
        point.portfolio = parseFloat(twrIndex.toFixed(4));
      } else {
        // Non-NAV day (weekend/holiday): carry index forward — mirrors the
        // skip in summaryStats.pctGain so the two stay identical.
        point.portfolio = parseFloat(twrIndex.toFixed(4));
      }
      // Cash-flow marker metadata only (display sign: + = invested/BUY).
      point.cashFlow = -(row.cashFlow ?? 0);
      // Benchmark normalization (base-100) — unchanged; index has no flows.
      activeBenchmarks.forEach(b => {
        if (row[b] != null && benchmarkBase[b] != null) {
          point[b] = parseFloat(((row[b] / benchmarkBase[b]) * 100).toFixed(4));
        } else {
          point[b] = null;
        }
      });
      return point;
    });
