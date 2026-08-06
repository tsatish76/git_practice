# Portfolio Engine — Context for New Chat

I am building a **production-grade, ledger-driven portfolio analytics engine for Indian investments**. This is not a CRUD portfolio tracker.

I want you to reason like a **portfolio accounting engineer / trading-system architect**, prioritizing financial correctness, deterministic computation, and clean architecture.

## Core Principles

```text
Trade Ledger = Source of Truth
Allocations  = Deterministic Projection
Holdings     = Derived State
NAV          = Derived State
Performance  = Derived State
Market Data  = Canonical External Data
```

Rules:

* Trades are append-only except corrections.
* BUY trades are never modified when shares are sold.
* SELL trades are independent ledger events.
* SELL → BUY lot matching is stored separately using FIFO allocations.
* Holdings are reconstructed, not permanently stored.
* `symbol` is the canonical instrument identifier.
* Historical portfolio state must always be reproducible.

## Stack

Frontend:

* React + Vite
* Recharts
* Framer Motion
* Vercel

Backend:

* Node.js + Express
* PostgreSQL / Neon
* yahoo-finance2

## Main Data Model

### Trade Ledger: `stocks`

```text
id
symbol
name
price
quantity
order_type (BUY / SELL)
date
...
```

### FIFO Allocations: `trade_allocations`

```text
buy_order_id
sell_order_id
quantity
```

Remaining BUY quantity is derived from BUY quantity minus SELL allocations.

### Instrument Registry: `instruments`

```text
symbol PK
name
asset_type (EQ / MF)
```

Contains ~5,000 Indian listed companies.

### Historical Prices

```text
stock_price_history
symbol
date
close
PK(symbol,date)
```

Prices are stored locally as canonical external data for deterministic historical reconstruction.

---

# Current Functionality

Implemented:

* BUY/SELL trade ledger
* FIFO lot allocation
* holdings reconstruction
* realized/unrealized P&L
* historical stock-price ingestion
* historical portfolio valuation
* expandable positions/orders
* portfolio allocation
* investment thesis
* CSV export
* portfolio performance chart
* benchmark comparison

## Benchmark System

Added:

```text
index_price_history
symbol
date
close
PK(symbol,date)
```

Currently comparing against:

* Nifty 50
* Midcap

More indices will be added later.

Users can select/deselect benchmarks.

---

# Important Performance Distinction

We discovered that **portfolio value growth cannot directly be compared with index returns**.

Example:

```text
Yesterday portfolio = ₹1,00,000
New BUY today       = ₹50,000
Portfolio today     = ₹1,53,000
```

The portfolio did NOT return 53%. Most of that increase is new capital.

Therefore we now distinguish two modes.

### Portfolio-only mode

When no benchmark is selected:

```text
Show actual portfolio market value (NAV)
```

Example:

```text
₹1,00,000 → ₹1,20,000 → ₹1,50,000
```

### Benchmark comparison mode

When benchmarks are selected:

```text
Portfolio → cash-flow-adjusted performance index
Benchmark → normalized performance index
```

Both start at:

```text
100
```

Example:

```text
Portfolio   100 → 118
Nifty 50    100 → 110
Midcap      100 → 114
```

---

# Current Performance Calculation Problem

Daily NAV is already reconstructed from:

```text
historical holdings × historical closing prices
```

For benchmark comparison we are working on removing the effect of capital flows.

Current proposed formula:

```text
dailyReturn =
(NAV_today - NAV_previous - cashFlow_today)
/
NAV_previous
```

where approximately:

```text
BUY  → positive cash flow
SELL → negative cash flow
```

Then:

```text
performanceIndex[0] = 100

performanceIndex[t] =
performanceIndex[t-1] × (1 + dailyReturn[t])
```

However, this methodology is **still being validated**.

Important unresolved issues:

* correct BUY/SELL cash-flow treatment
* trade timing within a day
* whether daily TWR, true sub-period TWR, or Modified Dietz is appropriate
* whether SELL proceeds should count as external cash flow if a cash account is eventually modeled
* correct handling of range boundaries

Do not assume the current formula is automatically correct.

---

# PerformanceChart Current Flow

```text
Trade Ledger + Price History
        ↓
Daily Portfolio NAV
        ↓
Merge Index Prices
        ↓
Range Selection
1W / 1M / 6M / 1Y / 2Y / 5Y / ALL
        ↓
No benchmark → ₹ NAV chart
Benchmark selected → return comparison chart
```

A key requirement is that selecting/deselecting benchmarks should **not trigger expensive holdings/NAV reconstruction** unnecessarily.

---

# Architecture Direction

Financial computation currently exists partly inside React components such as `PerformanceChart.jsx`.

This is temporary.

Target structure:

```text
/portfolio-engine
    allocations.js
    holdings.js
    nav.js
    cashFlows.js
    returns.js
    benchmarks.js
    analytics.js
```

React should eventually handle presentation and interaction, not portfolio accounting.



