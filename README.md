# Kite Aurora — Algorithmic Trading Terminal

A high-throughput, event-driven trading platform for the Indian stock market (extensible to any tradable asset). Market data is simulated and streamed through **Apache Kafka**, persisted to **PostgreSQL**, consumed by a **strategy engine** that emits signals, executed by a **paper-trading engine**, and surfaced through a **real-time React dashboard** (REST + WebSocket).

> **Live preview** (when the stack is running locally): frontend on `http://127.0.0.1:5173`, API on `http://127.0.0.1:8080`.

## Stack

| Layer | Technology |
|---|---|
| Streaming | Apache Kafka 3.9 (single-node KRaft) |
| Database | PostgreSQL 16 |
| Backend | Node.js 20 + TypeScript microservices (KafkaJS, Fastify, `pg`) |
| Frontend | React 18 + Vite + TypeScript + Zustand + TradingView lightweight-charts |
| Language | TypeScript (strict, ESM) — run with `tsx` |

## Architecture

```
                            ┌───────────────────────────────┐
                            │        algorithm-engine       │
                            │  5 strategies on 1m candles   │
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

**Topics** (`market.*`): `ticks`, `candles`, `snapshots`, `signals`, `orders`, `trades`, `news`, `fundamentals`, `equity`. All topics are created automatically on boot by `kafkaReady()`.

## Services

| Service | Responsibility |
|---|---|
| `market-data` | Seeds 52 NSE instruments, backfills ~29k candles, simulates live 1m bars every 3s (aggregated to 5m/15m/1h/1d), publishes snapshots incl. a synthetic NIFTY50 index |
| `fundamentals` | Deterministic company profiles: ratios, investability score/grade, supplier/vendor/buyer/peer graph |
| `news` | Streaming market news/events with sentiment (BULLISH/BEARISH/NEUTRAL) and impact (HIGH/MEDIUM/LOW) |
| `algorithm-engine` | 5 strategies — `ma_cross`, `rsi_reversal`, `macd_cross`, `bb_breakout`, `supertrend` — emit BUY/SELL signals with reasons and strength |
| `executor` | Paper broker: atomic order fill, limit orders, slippage model, positions, equity curve, auto-trades signals (risk 3% per trade, max 15 concurrent positions) |
| `api` | Fastify REST + WebSocket hub; in-memory live market store fed by Kafka consumers |
| `frontend` | Vite dev server proxying `/api` and `/ws` to the API |

## Quick Start (Windows)

Prerequisites: Node 20+, PostgreSQL 16 running on `127.0.0.1:5432`, Java 21+ for Kafka.

```powershell
# 1. Environment — copy and adjust credentials
Copy-Item .env.example .env

# 2. Create the database role + database, then apply the schema
psql -U postgres -c "CREATE ROLE trading_app LOGIN PASSWORD 'trading_pass';"
psql -U postgres -c "CREATE DATABASE trading_platform OWNER trading_app;"
psql -U trading_app -d trading_platform -f scripts/db/schema.sql

# 3. Start Kafka (KRaft single node)
powershell -ExecutionPolicy Bypass -File scripts/kafka/start-kafka.ps1

# 4. Install workspace dependencies
npm install
npm --prefix frontend install

# 5. Launch all services (market-data, fundamentals, news, algorithm-engine, executor, api, frontend)
powershell -ExecutionPolicy Bypass -File scripts/run-all.ps1

# 6. Open the dashboard
start http://127.0.0.1:5173
```

Service lifecycle: `scripts/restart.ps1 -Name api,frontend`, `scripts/stop-all.ps1`. Logs land in `.infra\logs\`, pids in `.infra\service-pids.json`.

## REST API (highlights)

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health + WS status |
| `GET /api/market/overview` | NIFTY index, advancers/decliners, sector performance, gainers/losers |
| `GET /api/instruments` | All instruments |
| `GET /api/instruments/:symbol/candles?timeframe=1m&limit=280` | OHLCV candles (1m/5m/15m/1h/1d) |
| `GET /api/instruments/:symbol/indicators?timeframe=1m&limit=280` | SMA/EMA/RSI/MACD/Bollinger/ATR/Stochastic/SuperTrend |
| `GET /api/instruments/:symbol/fundamentals` | Company profile + investability score |
| `GET /api/instruments/:symbol/relations` | Supplier/vendor/buyer/peer graph |
| `GET /api/instruments/:symbol/signals` · `/news` | Signal & news history for a symbol |
| `GET /api/signals` · `/api/news` | Global feeds (filterable) |
| `GET /api/portfolio` | Account, positions (live marked), equity curve |
| `GET/POST /api/orders`, `GET /api/trades` | Order book, executions; `POST /api/orders` places a paper order |
| `GET /api/algorithms` · `PATCH /api/algorithms/:strategy` | Strategy configs, enable/disable |
| `GET/POST/DELETE /api/watchlist/:symbol` | Watchlist management |

## WebSocket

`/ws` streams `{ type, payload, ts }` events: `ready`, `snapshot` (52 quotes per tick), `candle`, `signal`, `news`, `order`, `trade`, `equity`.

## Simulation Tuning (`.env`)

- `SIM_SPEED=6` — market-seconds per real second (acceleration factor)
- `CANDLE_INTERVAL_SEC=3` — real seconds between 1m candle closes
- `SIM_SEED` — deterministic data generation seed
- `AUTO_RISK_PCT` / `MAX_POSITIONS` — executor risk controls (`services/executor/src/engine.ts`)

## Repository Layout

```
scripts/db/schema.sql        # full PostgreSQL schema
scripts/kafka/               # Kafka KRaft setup + start script
scripts/run-all.ps1          # start all 7 services
services/shared/src/         # config, logger, kafka/db helpers, indicators, instrument data
services/*/src/              # microservices
frontend/src/                # React dashboard (pages, charts, live WS store)
```
