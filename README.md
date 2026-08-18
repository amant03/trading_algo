# trading_algo

A high-throughput technical trading platform for the Indian stock market (extensible to any tradable asset).

Event-driven architecture powered by Apache Kafka streaming, PostgreSQL persistence, paper-trading execution engine, algorithmic strategy engine, and a real-time React dashboard.

## Stack

- **Streaming:** Apache Kafka (KRaft mode)
- **Database:** PostgreSQL 16
- **Backend:** Node.js + TypeScript microservices (KafkaJS, Fastify, `pg`)
- **Frontend:** React + Vite + TypeScript + TradingView lightweight-charts

## Architecture

```
market-data  → Kafka (market.candles) → algorithm-engine → Kafka (signals)
                                                        ↘  executor → Kafka (orders/trades) → PostgreSQL
fundamentals → PostgreSQL → api (REST + WebSocket) ←── Kafka ←───────────────────────────────┘
```

## Quick Start

See `docs/` and `scripts/` for setup. Coming soon.
