Feature add — cash-flow markers on the portfolio line in **comparison mode** (solo mode already has them). Marker data only; does not touch return math.

## Change 1 — carry `cashFlow` into comparison-mode `chartData`

In the `chartData` useMemo, **COMPARISON MODE** branch, add one line inside the `.map`:

```js
    return filteredSeries.map((row, i) => {
      const point = { date: row.date };

      // Portfolio TWR (Modified Dietz)
      const nav = row.portfolio;
      const cf  = row.cashFlow ?? 0;
      if (prevNav === null || prevNav === 0) {
        prevNav = nav;
        point.portfolio = 100;
      } else {
        const denom      = prevNav + 0.5 * cf;
        const dailyRet   = denom > 0 ? (nav - prevNav - cf) / denom : 0;
        twrIndex         = twrIndex * (1 + dailyRet);
        prevNav          = nav;
        point.portfolio  = parseFloat(twrIndex.toFixed(4));
      }

      // Cash-flow marker metadata (display sign: + = invested/BUY, − = sold/SELL)
      point.cashFlow = -(row.cashFlow ?? 0);   // matches solo-mode convention

      // Benchmark normalization
      activeBenchmarks.forEach(b => {
        if (row[b] != null && benchmarkBase[b] != null) {
          point[b] = parseFloat(((row[b] / benchmarkBase[b]) * 100).toFixed(4));
        } else {
          point[b] = null;
        }
      });
      return point;
    });
```

`point.cashFlow` is metadata for the dot renderer — it is **not** fed into `dailyRet`. Sign is negated to match solo mode (`+` = BUY/invested, `−` = SELL/sold), so the color logic below is identical in both modes.

## Change 2 — render BUY/SELL dots on the portfolio TWR line

You currently render `ReferenceDot`s only when `activeBenchmarks.length === 0`. Add a second block for comparison mode, plotted at `y={r.portfolio}` (the TWR index value):

```jsx
              {/* BUY/SELL reference dots — SOLO mode (existing) */}
              {activeBenchmarks.length === 0 &&
                chartData
                  .filter(r => r.cashFlow !== 0)
                  .map(r => (
                    <ReferenceDot
                      key={`cf-${r.date}`}
                      x={r.date}
                      y={r.portfolio}
                      r={4}
                      fill={r.cashFlow > 0 ? "#30c550" : "#f97316"}
                      stroke="none"
                      isFront
                    />
                  ))
              }

              {/* BUY/SELL reference dots — COMPARISON mode (new) */}
              {activeBenchmarks.length > 0 &&
                chartData
                  .filter(r => r.cashFlow !== 0)
                  .map(r => (
                    <ReferenceDot
                      key={`cf-cmp-${r.date}`}
                      x={r.date}
                      y={r.portfolio}
                      r={4}
                      fill={r.cashFlow > 0 ? "#30c550" : "#f97316"}
                      stroke="none"
                      isFront
                    />
                  ))
              }
```

## Change 3 — show the cash-flow event in the comparison tooltip

In `CustomTooltip`, the `!isSolo` branch, append a cash-flow row to the portfolio entry. Inside the `payload.map(entry => {...})`, after the `spread` block, before `</div>`:

```jsx
              {entry.dataKey === "portfolio" && entry.payload?.cashFlow !== 0 &&
                entry.payload?.cashFlow != null && (
                <div className="flex justify-between gap-4 ml-3.5 mt-0.5">
                  <span className={entry.payload.cashFlow > 0 ? "text-green-500" : "text-orange-500"}>
                    {entry.payload.cashFlow > 0 ? "● Invested" : "● Sold"}
                  </span>
                  <span className={entry.payload.cashFlow > 0 ? "text-green-500" : "text-orange-500"}>
                    ₹{Math.abs(Math.round(entry.payload.cashFlow)).toLocaleString("en-IN")}
                  </span>
                </div>
              )}
```

## Notes

* Dots sit **on the portfolio line only** in both modes — benchmarks have no cash flows by definition, so this stays consistent with "don't mix portfolio and benchmark."
* Legend already renders BUY/SELL keys in solo mode. If you want the same legend in comparison mode, drop the `activeBenchmarks.length === 0 &&` guard around the BUY/SELL legend block.
* Marker sign uses the display convention (`+` = invested). This is independent of the Modified-Dietz sign issue flagged earlier — that fix is still pending and unaffected by this change.
