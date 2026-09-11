# Kite Aurora — Algorithmic Trading Terminal — Complete Technical Documentation

> Generated: 2026-09-11 | Workspace root: `C:\projects\backend`
> Stack: Apache Kafka 3.9 (KRaft) + PostgreSQL 16 + Node.js 20 + TypeScript microservices + React 18 + Vite + Zustand + lightweight-charts

---

## Table of Contents

1. [Project Overview & Purpose](#1-project-overview--purpose)
2. [Technology Stack — What Was Used and Why](#2-technology-stack--what-was-used-and-why)
3. [System Architecture & Data Flow](#3-system-architecture--data-flow)
4. [Monorepo Layout](#4-monorepo-layout)
5. [Shared Library (`services/shared`)](#5-shared-library-servicesshared)
6. [Service: market-data (Price Simulator & Seeder)](#6-service-market-data-price-simulator--seeder)
7. [Service: fundamentals (Company Financials)](#7-service-fundamentals-company-financials)
8. [Service: news (News Wire)](#8-service-news-news-wire)
9. [Service: algorithm-engine (Strategy / Signal Engine)](#9-service-algorithm-engine-strategy--signal-engine)
10. [Service: executor (Paper Broker)](#10-service-executor-paper-broker)
11. [Service: api (REST + WebSocket Gateway)](#11-service-api-rest--websocket-gateway)
12. [Frontend (`frontend/`)](#12-frontend-frontend)
13. [REST API Reference](#13-rest-api-reference)
14. [WebSocket Protocol](#14-websocket-protocol)
15. [PostgreSQL Schema](#15-postgresql-schema)
16. [Kafka Topics & Consumer Groups](#16-kafka-topics--consumer-groups)
17. [Configuration (.env) & Simulation Tuning](#17-configuration-env--simulation-tuning)
18. [Scripts, Local Ops & CI/CD / Deployment](#18-scripts-local-ops--cicd--deployment)
19. [How to Run (Windows Quick Start)](#19-how-to-run-windows-quick-start)
20. [Design Decisions / Why This Way](#20-design-decisions--why-this-way)

---

## 1. Project Overview & Purpose

**Kite Aurora** is a high-throughput, event-driven **paper-trading platform for the Indian stock market (NSE, extensible to any asset)**.

What it does end-to-end:

| # | Functionality |
|---|---|
| 1 | Seeds **52–53 NSE instruments** (NIFTY50 + extras) with base price, sector, lot size, volatility |
| 2 | Backfills **~29k–58k historical candles** (daily 260d + intraday 1m/5m/15m/1h) deterministically |
| 3 | **Simulates live market**: geometric-Brownian + momentum + mean-reversion + shocks, emits 1m candles every 3s real time, aggregates to 5m/15m/1h/1d + synthetic **NIFTY50 index** snapshot |
| 4 | Optionally overlays **real Yahoo Finance data** (`REAL_DATA=1`, no API key) |
| 5 | Generates **deterministic company fundamentals**: P/E, P/B, ROE, margins, growth, D/E, beta, promoter/FII holding, investability score/grade (A+/A/B/C), plus supplier/vendor/buyer/peer/subsidiary graph |
| 6 | Streams **synthetic market news** with sentiment (BULLISH/BEARISH/NEUTRAL) + impact (HIGH/MEDIUM/LOW) + category (EARNINGS/DIVIDEND/BUYBACK/SPLIT/ANNOUNCEMENT/NEWS/MACRO) |
| 7 | Runs **8 strategy signal engine** on 1m candles: `ma_cross`, `rsi_reversal`, `macd_cross`, `bb_breakout`, `supertrend`, `stoch_cross`, `vwap_reversion`, `donchian_breakout` — emits BUY/SELL with reason + strength (5–99) + indicator snapshot |
| 8 | **Paper broker execution**: atomic fills, MARKET + LIMIT orders, 0.05% slippage, 3% risk/trade, max 15 concurrent positions, positions/equity-curve/accounts tracking, auto-trades signals |
| 9 | **REST + WebSocket gateway**: market overview, candles, on-the-fly indicators, fundamentals/relations, signals/news feeds, portfolio/orders/trades, algorithm config, watchlist, order placement |
| 10 | **React dashboard**: Dashboard, Stock detail (6 tabs + offline AI analyst), Trading console, Algorithms, Watchlist, Paper Lab — live via WS → polling → relay → CDN snapshot → offline degradation chain |
| 11 | **CI automation + static hosting**: GitHub Actions pre/post-market jobs produce `snapshot/analysis/news/signals/dependencies/paper` JSON to `automation-data` branch; Vercel serverless relays (`/api/live|chart|search|news|funda|import`) + CDN JSON let the frontend work without a live backend |

---

## 2. Technology Stack — What Was Used and Why

### 2.1 Backend / Infra

| Technology | Version / Path | Usage / Method | Why used |
|---|---|---|---|
| **Node.js** | `>=20` (`package.json:engines`) | Runtime for all 6 microservices | Native ESM, `fetch`, performance; single language with frontend |
| **TypeScript (strict, ESM)** | `^5.4.5`, `tsconfig.json: strict, ES2022, Bundler, noEmit` | All `services/**/*.ts`; typecheck via `npm run typecheck` | Type safety for domain types (`Candle/Signal/Order/...`); catches Kafka/DB contract errors |
| **tsx** | `^4.7.2` | Dev runner: `tsx watch services/<svc>/src/index.ts` | Run TS directly without build step; fast HMR-like restart |
| **Apache Kafka (KRaft single-node)** | `3.9`, `scripts/kafka/`, `127.0.0.1:9092` | Event backbone for `market.*` topics | High-throughput streaming, decoupled microservices, replayable; KRaft = no ZooKeeper needed locally |
| **KafkaJS** | `kafkajs@2.2.4` (`services/shared`) | `getKafka()`, `getProducer()`, `consumeTopic()`, `publish/publishBatch()`, `ensureTopics()`, `kafkaReady()` | Pure-JS Kafka client, no native deps on Windows; idempotent producer + GZIP compression + keyed partitioning |
| **PostgreSQL** | `16`, `127.0.0.1:5432/trading_platform` | System of record: `scripts/db/schema.sql` (239 lines) | Relational integrity for candles/orders/trades/positions; `ON CONFLICT` upserts; `DISTINCT ON` latest-price queries |
| **pg (node-postgres)** | `pg@8.11.5` + `@types/pg` | `pool`, `query()`, `withTransaction()`, `dbReady()`, `waitForInstruments/Candles()` | Standard PG driver; pool + slow-query log (>100ms) + txn helper for atomic fills |
| **Fastify** | `fastify@4.28.1` (`services/api`) | REST server `bodyLimit:1MB`, `listen(port, 0.0.0.0)` | Faster JSON serialization than Express; schema-ready; low overhead for high-frequency reads |
| **@fastify/cors** | `^9.0.1` | `origin:true` | Allow Vite dev `:5173` → API `:8080` during local dev |
| **@fastify/websocket + ws** | `^8.3.1` + `@types/ws` | `GET /ws` → `WsHub.add(ws)` fan-out | Push `snapshot/candle/signal/news/order/trade/equity` at tick rate; browser-native WS, no Socket.IO overhead |
| **pino** | `pino@8.19.0` | Shared `logger.ts` (`isoTime`, `level=config.logLevel`) | Fastest structured JSON logger; cheap per-tick logging |
| **dotenv** | — | `import 'dotenv/config'` in `shared/src/config.ts` | Single `.env` drives PG/Kafka/API/sim params |
| **pdf-parse** | `^1.1.1` (root) | Annual-report parsing (dependencies CI job) | Extract supplier/RPT tables for supply-chain graph |
| **PowerShell scripts** | `scripts/*.ps1` | `run-all/stop-all/restart/start-service-detached` | Windows-native process mgmt; per-service `.out/.err.log` + `service-pids.json` |
| **Java 21+** | prerequisite | Runs Kafka KRaft | Required by Kafka 3.9 |

### 2.2 Frontend

| Technology | Version | Usage / Method | Why used |
|---|---|---|---|
| **React + ReactDOM** | `^18.3.1` (`StrictMode`, hooks) | All UI | Component model; hooks for data fetching |
| **Vite** | `^5.3.4` | Dev server `:5173`, `build`, proxy `/api→:8080`, `/ws→ws://:8080`, custom `nseRelay()` plugin | Instant HMR; plugin lets dev reuse Vercel serverless logic locally |
| **@vitejs/plugin-react** | `^4.3.1` | Fast Refresh | DX |
| **TypeScript** | `^5.4.5`, `build: tsc --noEmit && vite build` | `src/types.ts` (538 lines) | Shared contract with backend |
| **react-router-dom** | `^6.26.0` | `HashRouter`, `Routes/Route/NavLink/useParams/useNavigate` in `App.tsx` | `HashRouter` chosen for static hosting (Vercel SPA fallback + `file://`/CDN-compatible, no server rewrites needed for deep links) |
| **zustand** | `^4.5.4` | Sole global store: `useLive` in `src/ws.ts` (729 lines) | No Redux/Context boilerplate; selectors `useLive(s=>s.snapshots)` = fine-grained re-renders at 52-quotes/tick rate |
| **lightweight-charts** | `^4.2.0` | `CandleChart.tsx` (candles + volume histogram + SMA overlays), `Panel.tsx` (RSI/MACD sub-panels), `Trading.tsx:EquityChart` (area) | TradingView-grade perf; handles incremental candle updates + `ResizeObserver` autosize |
| **Custom SVG charts** | hand-rolled (`AdvChart.tsx`, `Sparkline.tsx`) | `AdvChart`: 1D area + prevClose dashed + multi-range candles + SMA20/50/200 + EMA21 + volume + hover crosshair + live amber line; `Sparkline`: Dashboard movers | No lib needed for sparklines; full style control, zero dep weight |
| **Native fetch** | `src/api.ts:get/post/patch/del` | All REST; JSON error unwrap | No axios needed; keeps bundle small |
| **Custom CSS** | `index.css` + Google Fonts `Archivo` + `IBM Plex Mono` | Entire design system | No Tailwind — bespoke terminal aesthetic |
| **No chart.js / No LLM SDK** | — | Indicators + AI analyst are pure offline TS (`indicators.ts`, `ai.ts`) | Works offline on CDN snapshot; zero API cost/latency |

### 2.3 Data source

| Source | Method | Why |
|---|---|---|
| **Yahoo Finance (free, no key)** | `query1/2.finance.yahoo.com/v8/chart`, `/.NS` with `.BO` fallback, pool 6, 5–9s timeout, UA header | Free NSE data; used in `market-data/real-data.ts`, Vercel relays (`frontend/api/*`), `src/lib/nse.ts` |
| **Google News RSS** | `scripts/ci/news.ts` (40 market-hours / 150 deep) | Free news feed for static `news.json` |

---

## 3. System Architecture & Data Flow

```
                            ┌───────────────────────────────┐
                            │        algorithm-engine       │
                            │  8 strategies on 1m candles   │
                            └──────────────┬────────────────┘
                                           │ market.signals
┌──────────────┐  market.candles  ┌───────▼────────┐  market.orders   ┌──────────────┐
│  market-data │ ───────────────▶ │    executor    │ ───────────────▶ │  PostgreSQL  │
│  simulator   │ ───────────────▶ │  paper broker  │  market.trades   │              │
└──────────────┘  market.ticks    └───────▲────────┘                  └──────▲───────┘
┌──────────────┐  market.news     │      │                                  │
│    news      │ ───────────────▶ └──────┼──────────────────────────────────┘
└──────────────┘                         │
┌──────────────┐  market.fundamentals    │
│ fundamentals │ ───────────────────────▶│
└──────────────┘                         ▼
                                 ┌───────────────┐  REST + WebSocket
                                 │  api gateway  │ ◀────────────────── ▶ React dashboard
                                 └───────────────┘        (Vite dev proxy :5173 → :8080)
```

**End-to-end (local live):**
`market-data tick (3s) → Kafka candles/ticks/snapshots → algorithm-engine → signals → executor (auto-trade) → orders/trades/equity → PostgreSQL + Kafka → api MarketStore + WsHub → React Zustand → Dashboard/Stock/Trading`

**End-to-end (static/prod without backend):**
`GH Actions (Postgres:16 + Kafka:3.9 services, REAL_DATA=1) → report.ts + fundamentals/management/news/signals/deps/paper jobs → automation-data branch (snapshot/analysis/news/signals/dependencies/paper/*.json) → frontend relay (live Yahoo) + CDN snapshot → Zustand → pages`

---

## 4. Monorepo Layout

```
C:\projects\backend\
  package.json            # workspaces: services/*, frontend; scripts dev:*, typecheck, build, start:all/stop:all/restart
  tsconfig.json           # strict, ES2022, Bundler, include services/**/*.ts, exclude frontend
  vercel.json             # root ignoreCommand — disables git auto-builds; deploys only via .github/workflows/deploy.yml
  .env                    # PG/Kafka/API/sim params (see §17)
  services/shared/src/    # config, logger, kafka/db helpers, indicators, instruments-data, types, topics
  services/{market-data,fundamentals,news,algorithm-engine,executor,api}/src/
  services/*/package.json # each depends on @trading/shared (+ fastify/ws only in api)
  frontend/src/           # main, App, api, ws (store), types, ai, indicators, format, lib/, components/, pages/
  frontend/api/           # Vercel serverless: live, chart, search, news, funda, import
  frontend/vite.config.ts # react() + nseRelay(), proxy /api + /ws
  scripts/db/schema.sql   # full PG schema
  scripts/kafka/          # KRaft setup + start scripts + server.properties
  scripts/run-all.ps1 | stop-all.ps1 | restart.ps1 | start-service-detached.ps1
  scripts/ci/ (19 files)  # universe, fundamentals, management, heal, validate, news, signals, deps, paper, paper-daily, report, import-stock, persist-artifacts, ...
  .infra/                 # kafka binary, kafka-data/, logs/, service-pids.json, cloudflared.exe
  .github/workflows/      # deploy.yml, automation.yml, dependencies.yml, import-symbol.yml
  reports/                # run-<ts>-<id>.json + latest.json (e.g. 2026-09-10: 52 inst, 58144 candles, 244 signals, 56 orders/trades, 8 open, 145 news, equity ₹80821.33)
```

Root `package.json` scripts method:

| Script | Method | Why |
|---|---|---|
| `dev:<svc>` | `tsx watch services/<svc>/src/index.ts` | Per-service hot reload |
| `dev:frontend` | `npm --prefix frontend run dev` | Vite |
| `typecheck` | `tsc -p tsconfig.json --noEmit && npm --prefix frontend run build` | Backend + frontend checks |
| `build` | `tsc -p tsconfig.json` | Backend emit |
| `start:all / stop:all / restart` | PowerShell scripts | One-command 7-service lifecycle on Windows |

---

## 5. Shared Library (`services/shared`)

Imported as `@trading/shared` by every service. `services/shared/package.json`: `dotenv, kafkajs@2.2.4, pg@8.11.5, pino@8.19.0`.

| File | Key exports / Methods | Usage & Why |
|---|---|---|
| `src/index.ts` | Barrel re-export | Single import surface |
| `src/config.ts` | `config:{pg, kafka{brokers,clientId,groupIdPrefix,retries}, api{port}, sim{speed,candleIntervalSec,seed}, logLevel}` via `dotenv/config` | Env-driven; one place to tune DB/Kafka/sim |
| `src/logger.ts` | `logger = pino({level, timestamp: isoTime})` | `pino` = fastest structured JSON logging for per-tick volume |
| `src/topics.ts` | `TOPICS` const + `Topic` type: `market.ticks|candles|snapshots|signals|orders|trades|news|fundamentals|equity` | Canonical topic names; avoids string typos |
| `src/types.ts` | `Timeframe, Side, OrderType, OrderStatus, SignalDirection, Sentiment, Impact, Candle, Tick, Instrument, Snapshot, Fundamentals, CompanyRelation, Signal, NewsEvent, Order, Trade, Position, PortfolioSummary, AlgorithmConfig, EquityPoint, IndicatorResult, KafkaMessage` | Single domain contract backend↔DB↔Kafka |
| `src/kafka.ts` | `getKafka()` cached client w/ retry; `ensureTopics()` admin create (3 partitions, repl 1); `getProducer(label)` idempotent (`maxInFlightRequests:5`); `consumeTopic<T>(topic,service,handler,opts)` durable group `${prefix}-${service}`, 30-attempt reconnect, `eachBatch/eachMessage`, JSON-parse guard; `publish/publishBatch()` GZIP + key; `kafkaReady(60s)` poll + ensure | `kafkajs` = pure-JS, Windows-friendly; idempotence + GZIP = safe high-throughput ticks; keyed partitioning keeps per-symbol order |
| `src/db.ts` | `pool(pg.Pool max, 30s idle, 5s conn timeout)`, `query<T>()` timed + slow-log >100ms, `withTransaction(fn)` BEGIN/COMMIT/ROLLBACK, `dbReady()`, `closeDb()`, `waitForInstruments(120s)`, `waitForCandles(180s)` | `pg` = standard driver; txn helper = atomic fills; wait helpers = cross-service boot ordering |
| `src/seededRandom.ts` | `SeededRng(mulberry32)`, `round2/round4/clamp` | Deterministic sim/backfill/fundamentals/news (`SIM_SEED`) → reproducible runs |
| `src/indicators.ts` | Pure math, zero deps: `sma, ema (SMA-seeded), rsi (Wilder 14), macd{macd,signal,histogram}, bollinger{upper,middle,lower}, atr (Wilder TR), stochastic{k,d}, supertrend{line,direction}, last(), finite()` | Hand-rolled (not `technicalindicators` lib) = deterministic, NaN-aligned, shared by engine + API + frontend parity |
| `src/instruments-data.ts` | `INSTRUMENTS: InstrumentSeed[]` ~53 NIFTY50+ stocks `{symbol,name,exchange,segment,sector,industry,basePrice,lotSize,marketCapCr,volatility}` | Static universe; single source of truth seeded to DB |

---

## 6. Service: market-data (Price Simulator & Seeder)

**Responsibility:** Source of truth for `instruments` + `candles`. Seeds universe, backfills history, simulates live 1m bars.

**Files:**

| File | Purpose |
|---|---|
| `src/index.ts` | Orchestrator: `seedAndLoadInstruments`, NIFTY50 synthesis, `tick()` loop, graceful flush |
| `src/simulator.ts` | `class InstrumentSimulator` — GBM + momentum + mean-reversion + shocks |
| `src/backfill.ts` | Deterministic 260d daily + 3-day 1m + 5m/15m/1h aggregates + `insertCandles` |
| `src/real-data.ts` | Optional Yahoo overlay (`REAL_DATA=1`), native `fetch` |
| `package.json` | Deps: `@trading/shared`, `dotenv` only; no web framework; `setInterval` loop |

**Key methods / logic & why:**

- `InstrumentSimulator` state: `price, prevClose, momentum, dayOpen/High/Low/Volume, dayBarCount, volPerBar, avgDailyVolume, accumulators:Map<Timeframe,Accum>`.
  - `constructor(inst, seed)`: `volPerBar=(volatility/sqrt(78))*0.45`, volume from `marketCapCr`. Why: scales intraday vol to ~78 5-min bars/day equivalent.
  - `step(ts):{closed:Candle[], snapshot:Snapshot}`: `ret = momentum*0.55 + volPerBar*gauss + meanRevert*0.04 + shock(p=0.006, ×4.2)`, clamp `0.8×prevClose..1.2×prevClose` (circuit-breaker realism), tick-size rounding, day rollover at `BARS_PER_DAY=78`. Emits 1m + closed aggregates + `Snapshot`.
  - `resetDayAccumulators()`: 5m/15m/1h/1d rollups.
- `backfill.ts`: `generateDaily(inst,days,seed)` Gaussian returns backward so last close == basePrice; `generateIntraday(inst,seed,234 bars)` converges to base; `aggregate(bars,size,tf)` OHLCV rollup; `insertCandles(rows)` 500-row chunks `ON CONFLICT(instrument_id,timeframe,ts) DO UPDATE`; `backfillInstruments()` per-instrument daily+1m+5m+15m+1h.
- `index.ts`: `seedAndLoadInstruments()` upsert `ON CONFLICT(symbol) DO UPDATE`; `computeIndexScale()/makeIndexSnapshot()` market-cap-weighted synthetic `NIFTY50 (instrumentId:0)` scaled to `TARGET_INDEX=24700`; `main()` = `dbReady→kafkaReady→seed→backfill→[REAL_MODE?syncRealHistory]→setInterval(candleIntervalSec*1000, tick)`; `tick()` builds candles/ticks/snaps, `publishBatch` in parallel, DB flush every 3s; `refreshRealQuotes` every 60s.
- `real-data.ts` (why `fetch` to Yahoo — free, no key): `yahooSymbol(s)=>s.NS`, `yahooJson(url)` UA + 20s timeout; `syncRealHistory()` `v8/chart?range=2y&interval=1d` → `candles 1d`, `UPDATE instruments SET base_price=lastClose`; `refreshRealQuotes()` 8-worker pool `range=1d` meta → `Snapshot[]` → `publishBatch(snapshots)`.

**Kafka/DB/REST:**

- Produces: `market.candles` (key=symbol), `market.ticks`, `market.snapshots`.
- Consumes: none.
- DB: `SELECT COUNT(*) FROM instruments`, `INSERT INTO instruments ON CONFLICT`, `SELECT ... WHERE status='ACTIVE'`, `INSERT INTO candles`, `UPDATE instruments SET base_price`.
- REST: none.

---

## 7. Service: fundamentals (Company Financials)

**Responsibility:** Deterministic company profiles + supply-chain graph.

| File | Purpose |
|---|---|
| `src/index.ts` | `loadInstruments`, `upsertFundamentals`, `replaceRelations`, 5-min refresh loop |
| `src/generate.ts` | `generateCompany(inst,peers):{fundamentals,relations}` — accounting-consistent ratios + investability score |
| `src/sectors.ts` | `SECTOR_TEMPLATES` (PE/PB/ROE/margin/growth/D-E/beta/promoter/FII ranges ×19 sectors) + `SECTOR_POOLS` (supplier/vendor/buyer/subsidiary names) |
| `package.json` | `@trading/shared` only |

**Methods & math:**

- `loadInstruments()`: `SELECT ... WHERE status='ACTIVE'`.
- `upsertFundamentals(f)`: 34-col `INSERT ... ON CONFLICT(instrument_id) DO UPDATE`.
- `replaceRelations()`: `DELETE WHERE instrument_id` + multi-row `INSERT`.
- `runOnce()`: per-inst `generateCompany` → DB + `publishBatch(fundamentals)`.
- `main()`: `dbReady→kafkaReady→waitForInstruments→runOnce→setInterval(5min,runOnce)`.
- `generateCompany` accounting chain: `pe→netIncome=mc/pe→netMargin→revenue→roe→equity→pb→bookValue→eps`, `ps,peg,avgVolume,52wHigh/Low`, `investabilityScore = value*.2+growth*.2+profit*.2+safety*.15+momentum*.15+scale*.1` → grade `A+/A/B/C`; relations: 4 suppliers + 3 vendors + 4 buyers + 3 same-sector PEER (symbol-linked) + 2 subsidiaries, seeded `100000+id*104729`.

**Kafka/DB:** Produces `market.fundamentals`; consumes none; reads `instruments`, writes `fundamentals` + `company_relations`.

---

## 8. Service: news (News Wire)

| File | Purpose |
|---|---|
| `src/index.ts` | `loadInstruments`, `insertNews`, `seedBacklog`, 12s live `emit` loop |
| `src/generator.ts` | `generateNewsEvent(rng,inst)` from 21 templates |
| `package.json` | `@trading/shared` only |

**Methods:**

- `TEMPLATES:{category:EARNINGS|DIVIDEND|BUYBACK|SPLIT|ANNOUNCEMENT|NEWS|MACRO, impacts[], text(vars)}` with `NewsVars{symbol,name,sector,pct,amount,quarter}`; `SOURCES=[NSE Wire,Moneycontrol,Reuters India,...]`; `CATEGORY_BASE_SENTIMENT` (e.g. EARNINGS→BULLISH) + 30% random override.
- `generateNewsEvent()`: pick template/impact, headline interpolation, `tags=[category,impact,sector]`, `eventTime=publishedAt=now`.
- `insertNews()`: bulk `INSERT ... ON CONFLICT DO NOTHING RETURNING id`.
- `seedBacklog()`: seeded `777001`, 3–7/instrument + 10 macro, backdated 5min–7d.
- `main()`: `dbReady→kafkaReady→if count==0 seedBacklog→setInterval(12s, emit)`; `emit`: 18% macro else random instrument → DB + `publishBatch`.

**Kafka/DB:** Produces `market.news` (key=symbol or `MACRO`); reads `instruments`, writes `news_events`.

---

## 9. Service: algorithm-engine (Strategy / Signal Engine)

**Files:**

| File | Purpose |
|---|---|
| `src/index.ts` | Boot: seed configs, warmup history, Kafka consumer, 30s config refresh |
| `src/engine.ts` | `class AlgorithmEngine` — 8 strategies + cooldown + indicator snapshot |
| `package.json` | `@trading/shared` only; math from shared `indicators` |

**Configs (`DEFAULT_CONFIGS`):** `ma_cross{fast20,slow50}`, `rsi_reversal{14,30,70}`, `macd_cross{12,26,9}`, `bb_breakout{20,2}`, `supertrend{10,3}`, `stoch_cross{14,3,20,80}`, `vwap_reversion{lookback60,buffer0.05%}`, `donchian_breakout{20}`.

**Class methods:**

- `windows:Map<id,Candle[]> (WINDOW=300)`, `states:Map<id:strategy,{lastSignalBarTs,signalCount}>`, `configs, instruments, totalSignals`.
- `setInstruments/setConfigs/getConfigs/warmup()` — warmup sorts + slices last 300 1m bars.
- `onCandle(candle):Signal[]` — ignore non-1m, upsert by `ts`, require 60 bars, `computeIndicators`, loop enabled strategies → `evaluateStrategy` → `COOLDOWN_BARS=4` check → emit `Signal{strategy,direction,price,strength,reason,indicatorSnapshot}`.
- `computeIndicators(window)` — `sma20/50, rsi14, macdHist, boll, atr, stoch, supertrend` + snapshot.
- `evaluateStrategy(...)`:
  - `ma_cross`: golden/death cross (SMA20 × SMA50)
  - `rsi_reversal`: oversold/overbought exit (30/70)
  - `macd_cross`: histogram sign flip
  - `bb_breakout`: close outside band
  - `supertrend`: direction flip
  - `stoch_cross`: %K/%D cross near extremes (20/80)
  - `vwap_reversion`: reclaim/lose VWAP (±0.05%)
  - `donchian_breakout`: close beyond N-bar high/low
  - `strength = clamp(base + |movePct|*12 + atr*2, 5, 99)`.
- `index.ts`: `seedDefaultConfigs (ON CONFLICT DO NOTHING)`, `loadConfigs/loadInstruments/loadHistory (300×1m DESC)`, `persistSignals (INSERT RETURNING id → publishBatch)`, `consumeTopic(candles, eachBatch:false)`.

**Kafka/DB:** Consumes `market.candles` (group `trading-algorithm-engine`); produces `market.signals`; reads `algorithm_configs/instruments/candles`, writes `signals`. Config edited via API service.

---

## 10. Service: executor (Paper Broker)

| File | Purpose |
|---|---|
| `src/index.ts` | Wiring: symbol map, price prime, 3 parallel consumers |
| `src/engine.ts` | `class PaperBroker` — cash/positions/limit orders/equity |
| `package.json` | `@trading/shared` only; atomicity via `withTransaction` |

**Class (`ACCOUNT_ID=1, AUTO_RISK_PCT=3%, MAX_POSITIONS=15, SLIPPAGE=0.05%`):**

- State: `cash, initialCapital, equity, realizedPnl, lastPrices:Map, positions:Map, limitOrders:LimitOrder[], symbols`.
- `init()` — `INSERT INTO accounts(1,'Paper Account',100k) ON CONFLICT DO NOTHING`, load cash + non-zero positions.
- `applySnapshot(s)` — update price + `checkLimitOrders()`.
- `recomputeEquity() = cash + Σ qty*price`, `maybeSaveEquity(force)` — throttle 5s → `INSERT INTO equity_curve` + `UPDATE accounts` + `publish(equity)`.
- `onSignal(signal)` — BUY if no long & `<MAX_POSITIONS`, `qty = min(floor(equity*3%/price), floor(cash/price))`; SELL if long → full close. Creates `PENDING` then `fillOrder` at last price.
- `onOrder(order)` — MARKET → immediate `fillOrder`; LIMIT → `UPDATE PENDING` + queue (no republish to avoid loop).
- `checkLimitOrders()` — BUY fills when `price<=trigger`, SELL when `price>=trigger`.
- `createOrder()` — `INSERT INTO orders RETURNING id`.
- `fillOrder(order,marketPrice)` — slippage-adjusted price, `withTransaction`: reject if already FILLED/CANCELLED, BUY checks cash / upserts `positions` + `trades(pnl0)`, SELL checks qty / realizes `pnl=(price-avg)*qty` / deletes or updates position + `trades`, `UPDATE orders FILLED`, `UPDATE accounts`; on insufficient funds/qty persists REJECTED outside txn; then `publish(orders filled)+publish(trades)+maybeSaveEquity`.

**`index.ts`:** `loadSymbolMap`, `loadLatestPrices (DISTINCT ON instrument_id 1m)`, `waitForCandles`, three `consumeTopic`: `signals→onSignal`, `orders→onOrder`, `snapshots(eachBatch:true)→applySnapshot+maybeSaveEquity`.

**Kafka/DB:** Consumes `market.signals` (`executor-signals`), `market.orders` (`executor-orders`), `market.snapshots` (`executor-snapshots`); produces `market.orders` (filled), `market.trades`, `market.equity`; touches `accounts/positions/orders/trades/equity_curve/instruments/candles`.

---

## 11. Service: api (REST + WebSocket Gateway)

| File | Purpose |
|---|---|
| `src/index.ts` | Fastify boot + 7 Kafka consumers → `MarketStore` + `hub.broadcast` |
| `src/routes.ts` | All REST endpoints (~500 lines) |
| `src/market-store.ts` | `class MarketStore` — live snapshots/candles/signals/news/trades/orders/equity |
| `src/hub.ts` | `class WsHub` — fan-out to `ws` clients |
| `package.json` | `fastify@4.28.1` (fast JSON), `@fastify/cors@9`, `@fastify/websocket@8`, `@trading/shared` |

**Key classes:**

- `MarketStore`: `snapshots:Map, indexSnapshot, lastCandles:Map<id:tf>, signals[300], news[300], latestTrades[50], latestOrders[50], equityPoints[500]` with `onSnapshot/onCandle/onSignal/onNews/onTrade/onOrder/onEquity/getSnapshot/getLastCandle`.
- `WsHub`: `add(ws)` + `ready`, `broadcast(type,payload)` as `{type,payload,ts}`.
- `index.ts`: `loadInstruments`, `Fastify{bodyLimit:1MB}+cors+websocket`, `GET /ws→hub.add`, `registerRoutes`, `listen(port,0.0.0.0)`, 7× `consumeTopic(eachBatch:true)`.

**Kafka:** Consumes `snapshots/candles/signals/news/trades/orders/equity` (groups `api-*`) → store + WS broadcast. Produces `market.orders` via `POST /api/orders → publish`. DB: read-heavy (`instruments/candles/fundamentals/relations/signals/news/accounts/positions/equity/orders/trades/algorithms/watchlists`) + writes for orders/algorithms/watchlist.

---

## 12. Frontend (`frontend/`)

**Identity:** `trading-frontend@1.0.0`, title `TradeAlgo — Algorithmic Trading Terminal` (`index.html` + `Archivo` + `IBM Plex Mono`).

### 12.1 Routes (`src/App.tsx` shell: `Topbar + StatusBanner + Ticker + Sidebar + <Routes> + Toasts`, grain overlay)

| Route | Page (`src/pages/`) | Functionality |
|---|---|---|
| `/` | `Dashboard.tsx` | NIFTY50, Adv/Dec breadth, Live Signals count, News Sentiment, Market Movers (gainers + `SparkHistory`), Sector Performance bars, Top Losers, Live News, `TripleScreener`, `SignalFeed` (25) |
| `/stock/:symbol` | `Stock.tsx` (~958 lines) | 6 tabs: Overview / Fundamentals / Dependencies / Technical / AI Analyst / News. Verdict gauge, `VerdictBar` fair-value band, dual verdict (Technical short-term vs Fundamental 3–5y), Buffett/Lynch/Graham screens, `ScreenerPanel`, `KeyRatios`, `ManagementPanel`, `CompetitionPanel`, `ReportsPanel`, `DependenciesPanel`, `AIAnalyst`, signal history, OHLC strip, watchlist toggle, on-demand `Import` button (`/api/import?symbol=`) |
| `/trading` | `Trading.tsx` | Paper console: equity/cash/unrealized/day-PnL cards, `EquityChart` (area), Place Order form (BUY/SELL, MARKET/LIMIT, qty, est. notional), Open Positions, Order Book (40), Executions (40). Merges REST + live WS orders/trades by `id` |
| `/algorithms` | `Algorithms.tsx` | 8-strategy cards, accent border, enable/disable switch, params chips, 5 recent signals each. `FALLBACK_CONFIGS` mirrors engine defaults for static deploy. `PATCH /api/algorithms/:strategy` |
| `/watchlist` | `Watchlist.tsx` | Local-first table. Union map: `universe + instruments + fundamentals + snapshots`. Add via `datalist` (40 filtered), regex `^[A-Z0-9][A-Z0-9&-]{0,19}$`, `refreshSymbols()+toggleWatch()` |
| `/paper` | `Paper.tsx` (~700 lines) | Paper Lab — Daily intraday + Swing Lab. Reads `paper/daily.json` + `paper/latest.json` from `automation-data` CDN (30s/60s refresh). `PnLStatement`, `DailyTradesTable`/`SwingTradesTable` (sortable), `Spark` SVG equity, `MethodGuide` (Investopedia links), strategy scorecards (₹20k/bucket), open positions, full ledger. 8% SL / 12% trailing / 20-day max hold |

### 12.2 `src/` structure & method

```
src/
  main.tsx        # HashRouter + connectLive() on boot
  App.tsx         # Shell + 6 Routes
  api.ts          # BASE='' fetch wrapper get/post/patch/del
  ws.ts           # Zustand store + feed logic (729 lines)
  types.ts        # Instrument, Snapshot, MarketOverview, Candle, Fundamentals, Signal, NewsItem, Order/Position/Portfolio/Trade, StockAnalysis/Screener/Finology, DepRow/Entry/File, NewsArticle, HistoryRow, MgmtAnalysis
  ai.ts           # Offline AI analyst: computeTech(), patternList(), answer() Q&A router + verdict/valuation/levels/trend/mgmt/news/metrics/compare
  indicators.ts   # Pure SMA/EMA/RSI(Wilder)/MACD/BB/ATR/Stoch/Supertrend/VWAP + bias helpers
  format.ts       # fmt/fmtPct/fmtCompact(Cr/L)/fmtMoney(₹)/fmtTime/Date/timeAgo/cls
  lib/nse.ts      # Re-export liquid + NSE_UNIVERSE(52), Yahoo helpers, isIstMarketHours, fetchChart/Quotes
  lib/liquid.ts   # LIVE_SYMBOLS (~122 top mcap)
  lib/funda.ts    # Screener/funda helpers
  components/ Topbar, Sidebar, Ticker, StatusBanner, StockSearch, Toasts, Badge, SignalFeed, NewsFeed, Sparkline, ScreenerPanel, TripleScreener, KeyRatios, CompetitionPanel, ReportsPanel, DependenciesPanel, AIAnalyst, charts/{CandleChart,Panel,AdvChart}
  pages/ (6 as above)
```

- `Topbar`: nav + `StockSearch` + live clock + `LIVE FEED/LIVE QUOTES/REST POLLING/LAST CI SNAPSHOT/OFFLINE` pill.
- `Sidebar`: watchlist + Top Movers 6.
- `StatusBanner`: explains polling/snapshot/offline.
- `AIAnalyst`: uses `ai.ts` context (snap+analysis+news+rows+peers+tech) — fully offline Q&A.
- `CandleChart.tsx`: lightweight-charts candlestick (up `#00d68f`/down `#ff5c5c`), volume histogram, line overlays, autosize, dark grid.
- `Panel.tsx`: generic indicator sub-panels with min/max lock + threshold bands.
- `AdvChart.tsx`: bespoke SVG intraday area vs multi-range candles, SMA/EMA overlays, OHLCV footer, IST axis.
- `indicators.ts + ai.ts:computeTech`: client RSI/MACD/Stoch/BB/ATR/Supertrend/VWAP/SMA + breakout/trend/volume/gap → verdict `BUY/HOLD/SELL + conviction + UPTREND/DOWNTREND/SIDEWAYS`.

### 12.3 State management (`src/ws.ts` → `useLive`)

Zustand `create<LiveState>`: `mode:FeedMode='offline'`, `ready, lastEventAt, overview, snapshots{}, candles{}, signals[], news[], orders[], trades[], instruments[], universe[], snapshotAt, fundamentals{}, sparklines{}, newsBySymbol{}, watchlist[]` (hydrated `localStorage tradealgo.watchlist.v1`).

Actions: `setMode/setReady/touch/setOverview/setInstruments/setUniverse/setSnapshotAt/setAnalysis/setNewsBySymbol/setWatchlist/toggleWatch` (persists + `POST/DEL /api/watchlist` best-effort + `ensureFundamentals()` priority), `updateSnapshots/updateCandles/addSignal/addNews/addOrder/addTrade/replaceSignals/replaceNews` (cap 200).

**Feed priority (`connectLive()` from `main.tsx`):**

1. `seedInstrumentsIfEmpty()` from `NSE_UNIVERSE` → `loadUniverse()` (`/universe.json` → jsdelivr → raw github) → `ensureSnapshot()` (30s retry) → `startRelay()` → `syncWatchlist()` → `loadAnalysis()/loadNews()` + 10-min refresh + watchlist subscription.
2. **WS** (`VITE_WS_URL ?? ws://host/ws`): skipped if `PROD && !VITE_WS_URL`. Handles `ready/snapshot/candle/signal/news/order/trade`. Backoff `min(1000*2^retry,15000)`. If mode `snapshot|relay`, no reconnect; else `startPolling()`.
3. **Relay** (`/api/live`, 8s in IST session else 25s): `overviewFromQuotes()` builds adv/dec, sectorPerformance, gainers/losers/topVolume client-side. Falls back relay→snapshot.
4. **Polling** (`/api/instruments + /api/market/overview + /api/signals`, 4s): only if WS attempted and backend reachable.
5. **Snapshot** (`automation-data` CDN → raw → `/snapshot.json`): `snapshot.json + analysis.json + news.json` → mode `snapshot`.
6. **Offline**: initial + failure state.

Helpers: `refreshSymbols(syms)` (`/api/live?symbols=` ≤24), `fetchRelayNews(sym?)` (`/api/news`), `ensureFundamentals(syms)` (`/api/funda?symbols=` batch 8, dedupe), `loadJson()` skips `text/html`.

### 12.4 REST/WS consumption

- `api.ts`: `get/post/patch/del(path)` → `fetch(BASE+path)` JSON.
- Backend (local `:8080` via Vite proxy, prod same-origin): `/api/instruments`, `/api/instruments/:sym/signals|news`, `/api/market/overview`, `/api/signals?limit=60`, `/api/portfolio|orders|trades`, `POST /api/orders`, `/api/algorithms` + `PATCH`, `/api/watchlist` (+`POST/DEL :sym`).
- Serverless relays (Vercel + Vite `nseRelay`): `GET /api/live[?symbols=]` (TTL 12s + dedupe), `GET /api/chart?symbol=&range=` (`1d:1m,5d:15m,1mo:60m,6mo/1y:1d,5y:1wk`, TTL 20s, IST 09:15–15:30 filter), `/api/search`, `/api/news`, `/api/funda?symbols=` (batch 8), `/api/import?symbol=` (dispatches `import-symbol.yml`).
- Static CDN (no redeploy): `universe.json`, `snapshot.json`, `analysis.json`, `news.json`, `signals.json`, `dependencies.json`, `paper/latest.json|daily.json|state.json` — order `cdn.jsdelivr@automation-data → raw.githubusercontent automation-data → main/bundle`.
- WS `ws:///ws` `{type,payload}` only when backend present; degrades gracefully.

---

## 13. REST API Reference

Base `http://127.0.0.1:8080` (Vite proxies `/api`, `/ws`).

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | `{ok,time}` + WS status |
| `/api/market/overview` | GET | NIFTY index, advancers/decliners, sector performance, gainers/losers (from `MarketStore.snapshots`) |
| `/api/instruments` | GET | All instruments enriched with live snapshot (DB fallback on boot race) |
| `/api/instruments/:symbol` | GET | Instrument + snapshot + fundamentals |
| `/api/instruments/:symbol/candles?timeframe=1m&limit=280` | GET | OHLCV candles (1m/5m/15m/1h/1d), DB DESC→reverse |
| `/api/instruments/:symbol/indicators?timeframe=1m&limit=280` | GET | On-the-fly `sma20/50/200, ema12/26, rsi, macd/signal/hist, bbUpper/Mid/Lower, atr, stochK/D, stLine/Dir` via shared math |
| `/api/instruments/:symbol/fundamentals` | GET | Company profile + investability score |
| `/api/instruments/:symbol/relations` | GET | Supplier/vendor/buyer/peer graph |
| `/api/instruments/:symbol/signals` · `/news` | GET | Per-symbol history |
| `/api/signals` · `/api/news` | GET | Global feeds (filter `?limit&symbol&category&sentiment&impact`) |
| `/api/portfolio` | GET | Account + summary `{invested,unrealized,realized,dayPnl,totalPnl,%}` + positions (mark-to-market via store) + equityCurve (500) |
| `/api/orders` · `/api/trades` | GET | Order book, executions |
| `/api/orders` | POST | `{symbol, side:BUY\|SELL, orderType:MARKET\|LIMIT, quantity:int, limitPrice?}` → validate → `INSERT PENDING` → `publish(orders)` → 201 |
| `/api/algorithms` | GET | Strategy configs |
| `/api/algorithms/:strategy` | PATCH | `{enabled,params}` merge + `UPDATE` |
| `/api/watchlist` | GET | Watchlist |
| `/api/watchlist/:symbol` | POST/DELETE | Array append / `array_remove` |
| `/ws` | WS | Live frames (see §14) |

Serverless (Vercel, `frontend/api/`): `GET /api/live[?symbols=]`, `GET /api/chart?symbol=&range=`, `/api/search`, `/api/news`, `/api/funda?symbols=`, `/api/import?symbol=`.

---

## 14. WebSocket Protocol

Endpoint `/ws`, frames `{type, payload, ts}`:

| Type | Payload |
|---|---|
| `ready` | server hello |
| `snapshot` | 52 quotes per tick (`Snapshot[]` + NIFTY50) |
| `candle` | closed 1m (+ aggregated) `Candle` |
| `signal` | `Signal` with strategy/reason/strength |
| `news` | `NewsEvent` |
| `order` | `Order` (PENDING→FILLED/REJECTED) |
| `trade` | `Trade` execution |
| `equity` | `EquityPoint` |

---

## 15. PostgreSQL Schema

File `scripts/db/schema.sql` (239 lines). Applied via `psql ... -f scripts/db/schema.sql` or `scripts/db/apply-schema.ts` (uses `PG*` env).

| Table | Purpose / Key columns |
|---|---|
| `instruments` | Universe: `id, symbol UNIQUE, name, exchange, segment, sector, industry, base_price, lot_size, market_cap_cr, volatility, status` |
| `candles` | OHLCV: `PK(instrument_id,timeframe,ts)`, `open/high/low/close/volume` |
| `ticks` | Raw ticks (optional persist) |
| `fundamentals` | 34 cols: `pe,pb,roe,net_margin,revenue,net_income,equity,book_value,eps,ps,peg,avg_volume,52w_high/low, investability_score/grade, ...` (`FK instrument_id UNIQUE`) |
| `company_relations` | `instrument_id, kind(SUPPLIER/VENDOR/BUYER/PEER/SUBSIDIARY), name, symbol?, weight` |
| `signals` | `strategy, direction BUY/SELL, price, strength, reason, indicator_snapshot JSONB, ts` |
| `news_events` | `headline, body?, category, sentiment, impact, source, tags[], event_time, published_at` |
| `accounts` | `id=1 'Paper Account', cash, initial_capital` |
| `positions` | `account_id, instrument_id UNIQUE, qty, avg_price` |
| `orders` | `account_id, instrument_id, side, order_type, quantity, limit_price?, status PENDING/FILLED/REJECTED/CANCELLED, ts` |
| `trades` | `order_id, instrument_id, side, qty, price, pnl` |
| `equity_curve` | `account_id, ts, equity, cash` |
| `algorithm_configs` | `strategy UNIQUE, enabled, params JSONB` |
| `watchlists` | `id/user, symbols TEXT[]` |

---

## 16. Kafka Topics & Consumer Groups

All `market.*`, auto-created by `kafkaReady()/ensureTopics()` (3 partitions, RF 1):

| Topic | Producers | Consumers (group) |
|---|---|---|
| `market.ticks` | market-data | — (api optionally) |
| `market.candles` | market-data | algorithm-engine (`trading-algorithm-engine`), api (`api-candles`) |
| `market.snapshots` | market-data | executor (`executor-snapshots`), api (`api-snapshots`) |
| `market.signals` | algorithm-engine | executor (`executor-signals`), api (`api-signals`) |
| `market.orders` | api (POST), executor (filled) | executor (`executor-orders`), api (`api-orders`) |
| `market.trades` | executor | api (`api-trades`) |
| `market.news` | news | api (`api-news`) |
| `market.fundamentals` | fundamentals | api (cached/funda relay) |
| `market.equity` | executor | api (`api-equity`) |

Method: `publish/publishBatch` with GZIP + `key=symbol` (per-symbol ordering); `consumeTopic` with `eachBatch:true` for high-volume (snapshots/candles) else `eachMessage`.

---

## 17. Configuration (.env) & Simulation Tuning

`.env` (`NODE_ENV development, LOG_LEVEL info`):

| Key | Default | Effect |
|---|---|---|
| `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` | `127.0.0.1:5432 / trading_platform / trading_app / trading_pass` | `shared/src/config.ts → pg.Pool` |
| `KAFKA_BROKERS` | `127.0.0.1:9092` | `getKafka()` |
| `API_PORT / FRONTEND_PORT` | `8080 / 5173` | Fastify listen / Vite server |
| `SIM_SPEED` | `6` | Market-seconds per real second (acceleration) |
| `CANDLE_INTERVAL_SEC` | `3` | Real seconds between 1m candle closes (= 6× accelerated feel) |
| `SIM_SEED` | `20240818` | Deterministic `SeededRng` across sim/backfill/fundamentals/news |
| `AUTO_RISK_PCT / MAX_POSITIONS` | `3% / 15` | `executor/src/engine.ts` risk controls |
| `REAL_DATA` | `0` | `1` = Yahoo overlay (`real-data.ts`) |

---

## 18. Scripts, Local Ops & CI/CD / Deployment

### 18.1 `scripts/` (local ops)

| File | Method / Role |
|---|---|
| `run-all.ps1 [--Only]` | Kills old, launches 7 services hidden with per-service `.out/.err.log` in `.infra/logs`, writes `.infra/service-pids.json`. Order: `market-data, fundamentals, news, algorithm-engine, executor, api(:8080 via tsx), frontend(vite.js cwd=frontend :5173)`. 800ms stagger |
| `stop-all.ps1` | Kills PIDs from pid-file else `Win32_Process where CommandLine match tsx.*services\|vite.js` |
| `restart.ps1 -Name[]` | Selective restart, preserves other PIDs |
| `start-service-detached.ps1` | Single detached helper |
| `db/apply-schema.ts` | Applies `schema.sql` via `PG*` env |
| `kafka/download-kafka.ps1`, `start-kafka.ps1`, `start-kafka-filelog.ps1`, `server.properties` | Local Kafka `2.13-3.9.0` KRaft `127.0.0.1:9092` |
| `ci/` (19 files) | `universe.ts`, `fundamentals.ts` (DB seed + 40/night batch → `analysis.json`), `management.ts`, `heal-analysis.ts`, `validate-fundamentals.ts`, `verify-screener.ts`, `news.ts` (RSS → `news.json`), `signals.ts` (8 strategies on daily → `signals.json`), `dependencies.ts` (RPT supply-chain → `dependencies.json`), `paper.ts` (swing ₹1L, 5 buckets), `paper-daily.ts` (intraday 5m squared-off), `report.ts` + `monitor.ts`, `import-stock.ts` (on-demand single symbol), `persist-artifacts.mjs` (union merge), `regen-api-funda.mjs`, `api-funda-relay.ts.tpl` |

### 18.2 `.infra/`

`kafka_2.13-3.9.0/` binary, `kafka-data/`, `logs/` per-service, `service-pids.json`, `cloudflared.exe` tunnel helper.

### 18.3 `.github/workflows` (4)

- `deploy.yml`: on `push main` touching `frontend/**|vercel.json|deploy.yml` + manual. `node:22`, `npm ci`, `vercel deploy --prod` (`ORG team_oOhpBKL5…`, `PRJ prj_ADQh…`, `secrets.VERCEL_TOKEN`). Concurrency `vercel-deploy`.
- `automation.yml` (`Backend Automation`): cron `46 3 * * 1-5` (09:16 IST pre-open), `30 4,6,8 * * 1-5` (10/12/14 IST), `15 10 * * 1-5` (15:45 post-close) → `MODE=news`; `30 21 * * *` (03:00 IST) + manual → `MODE=full` (Postgres:16 + Kafka:3.9 services, schema, 6 services, health wait 120s, `monitor.ts`, `report.ts`, carry `analysis.json`, fundamentals batch, management, heal, validate, news 150, signals, deps 40, paper+paper-daily, persist union, commit `reports/run-<ts>-<id>.json + latest.json + snapshot/analysis/news/signals/dependencies/paper/` → force-push `automation-data`, promote to `main` on nightly/manual).
- `dependencies.yml`: Sunday `0 2 * * 0` (07:30 IST), `DEPS_PER_RUN 80`, commits only `dependencies.json` → `automation-data`.
- `import-symbol.yml`: manual `symbol` input → `import-stock.ts` → `analysis.json+news.json` → force-push `automation-data`.

### 18.4 Deployment config

- `frontend/vercel.json`: SPA `rewrites` (`/((?!api/).*)→/index.html`, explicit JSON passthroughs), `functions maxDuration` (`live/chart/funda 30s`, `search/news/import 15s`), `headers Cache-Control` (`/+index.html+snapshot/analysis/news/dependencies no-cache`, `universe.json max-age=3600`).
- Root `vercel.json`: `ignoreCommand` — disables auto root builds; deploys only via `deploy.yml`.
- `frontend/api/` (serverless, Vercel + Vite dev parity): `live.ts` (quotes+spark+index, cache/stale), `chart.ts` (OHLCV ranges), `search.ts`, `news.ts`, `funda.ts`, `import.ts` (dispatches `import-symbol.yml`).
- `frontend/vite.config.ts`: `react() + nseRelay()` (`/api/live|chart|search|news` via same `GET()`), `port 5173 host 0.0.0.0`, `proxy /api→8080` (bypass relay paths), `/ws ws:true`.

---

## 19. How to Run (Windows Quick Start)

Prerequisites: Node 20+, PostgreSQL 16 on `127.0.0.1:5432`, Java 21+ for Kafka.

```powershell
Copy-Item .env.example .env
psql -U postgres -c "CREATE ROLE trading_app LOGIN PASSWORD 'trading_pass';"
psql -U postgres -c "CREATE DATABASE trading_platform OWNER trading_app;"
psql -U trading_app -d trading_platform -f scripts/db/schema.sql
powershell -ExecutionPolicy Bypass -File scripts/kafka/start-kafka.ps1
npm install
npm --prefix frontend install
powershell -ExecutionPolicy Bypass -File scripts/run-all.ps1
start http://127.0.0.1:5173
```

Lifecycle: `scripts/restart.ps1 -Name api,frontend`, `scripts/stop-all.ps1`. Logs `.infra\logs\`, pids `.infra\service-pids.json`. Live preview (stack running): frontend `http://127.0.0.1:5173`, API `http://127.0.0.1:8080`.

---

## 20. Design Decisions / Why This Way

1. **Kafka + microservices (not monolith):** isolates hot paths (market-data ticks vs API reads); replayable topics; each service scales/restarts independently.
2. **Postgres (not Mongo/Redis):** relational joins (`signals JOIN instruments`, `orders JOIN instruments`), transactional fills, time-series candles with UPSERT dedupe.
3. **Fastify (not Express):** lower JSON overhead for polling + overview endpoints hit every 4s by many clients.
4. **Hand-rolled indicators (not lib):** identical math backend + frontend + CI signals; deterministic seeded runs; no native deps.
5. **Zustand (not Redux):** selector-level subscriptions survive 52-quote ticks without re-render storms.
6. **HashRouter (not BrowserRouter):** works on Vercel static + CDN JSON + `file://` with zero server rewrites except SPA fallback.
7. **Vite proxy + nseRelay + serverless parity:** same Yahoo relay code runs in dev (`vite.config.ts`), preview, and Vercel edge — no drift.
8. **CDN snapshot fallback:** dashboard stays useful (LAST CI SNAPSHOT mode) when Kafka/PG/backend are down; relay adds live quotes when market open.
9. **Deterministic seeds (`SIM_SEED`):** reproducible backtests/demos; `mulberry32` everywhere.
10. **PowerShell detached services + pid file:** Windows-native alternative to docker-compose for 7 Node processes + Kafka.

