-- ============================================================
-- trading_platform schema
-- PostgreSQL 16
-- ============================================================

-- ------------------------------------------------------------------
-- INSTRUMENTS : every tradeable symbol (EQ, FUT, crypto, FX, ...)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instruments (
    id            SERIAL PRIMARY KEY,
    symbol        VARCHAR(20)  NOT NULL UNIQUE,
    name          VARCHAR(120) NOT NULL,
    exchange      VARCHAR(10)  NOT NULL DEFAULT 'NSE',
    segment       VARCHAR(12)  NOT NULL DEFAULT 'EQ',      -- EQ | FUT | CRYPTO | FX | COMMODITY
    sector        VARCHAR(60),
    industry      VARCHAR(80),
    base_price    NUMERIC(14,4) NOT NULL,
    lot_size      INT          NOT NULL DEFAULT 1,
    tick_size     NUMERIC(8,2) NOT NULL DEFAULT 0.05,
    market_cap    NUMERIC(18,2),
    volatility    NUMERIC(8,4) NOT NULL DEFAULT 0.02,      -- daily stdev used by the simulator
    status        VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- CANDLES : OHLCV bars per timeframe (1m, 5m, 15m, 1h, 1d, ...)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candles (
    instrument_id INT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    timeframe     VARCHAR(6) NOT NULL,
    ts            TIMESTAMPTZ NOT NULL,
    open          NUMERIC(14,4) NOT NULL,
    high          NUMERIC(14,4) NOT NULL,
    low           NUMERIC(14,4) NOT NULL,
    close         NUMERIC(14,4) NOT NULL,
    volume        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (instrument_id, timeframe, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_ts ON candles (timeframe, ts);

-- ------------------------------------------------------------------
-- TICKS : raw market data events
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticks (
    id            BIGSERIAL PRIMARY KEY,
    instrument_id INT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    ts            TIMESTAMPTZ NOT NULL,
    price         NUMERIC(14,4) NOT NULL,
    volume        BIGINT NOT NULL DEFAULT 0,
    side          VARCHAR(4)  -- BUY | SELL
);

-- ------------------------------------------------------------------
-- FUNDAMENTALS : company profile + ratios + investability score
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fundamentals (
    instrument_id        INT PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
    sector               VARCHAR(60),
    industry             VARCHAR(80),
    description          TEXT,
    market_cap           NUMERIC(18,2),
    pe                   NUMERIC(12,2),
    pb                   NUMERIC(12,2),
    ps                   NUMERIC(12,2),
    peg                  NUMERIC(12,2),
    roe                  NUMERIC(10,2),
    roce                 NUMERIC(10,2),
    roa                  NUMERIC(10,2),
    debt_to_equity       NUMERIC(10,2),
    current_ratio        NUMERIC(10,2),
    quick_ratio          NUMERIC(10,2),
    gross_margin         NUMERIC(10,2),
    operating_margin     NUMERIC(10,2),
    net_margin           NUMERIC(10,2),
    revenue              NUMERIC(18,2),
    revenue_growth       NUMERIC(10,2),
    net_income           NUMERIC(18,2),
    net_income_growth    NUMERIC(10,2),
    employees            INT,
    dividend_yield       NUMERIC(10,2),
    eps                  NUMERIC(12,2),
    book_value           NUMERIC(12,2),
    beta                 NUMERIC(10,2),
    fifty_two_week_high  NUMERIC(14,4),
    fifty_two_week_low   NUMERIC(14,4),
    avg_volume           BIGINT,
    promoter_holding     NUMERIC(8,2),
    fii_holding          NUMERIC(8,2),
    investability_score  NUMERIC(6,2),
    investability_grade  VARCHAR(4),   -- A+ A B C
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- COMPANY_RELATIONS : suppliers / vendors / buyers / peers graph
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_relations (
    id             SERIAL PRIMARY KEY,
    instrument_id  INT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    relation_type  VARCHAR(16) NOT NULL,   -- SUPPLIER | VENDOR | BUYER | PEER | SUBSIDIARY
    entity_name    VARCHAR(120) NOT NULL,
    entity_symbol  VARCHAR(20),
    weight         NUMERIC(8,2),           -- dependency / revenue share %
    note           VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_relations_inst ON company_relations (instrument_id, relation_type);

-- ------------------------------------------------------------------
-- SIGNALS : algorithm engine output
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signals (
    id                BIGSERIAL PRIMARY KEY,
    instrument_id     INT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    strategy          VARCHAR(40) NOT NULL,
    direction         VARCHAR(6)  NOT NULL,   -- BUY | SELL
    price             NUMERIC(14,4) NOT NULL,
    strength          NUMERIC(6,2),
    reason            VARCHAR(255),
    indicator_snapshot JSONB,
    ts                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signals_inst_ts ON signals (instrument_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals (ts DESC);

-- ------------------------------------------------------------------
-- ACCOUNTS : paper trading accounts
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(60) NOT NULL,
    cash_balance    NUMERIC(16,2) NOT NULL DEFAULT 1000000,
    initial_capital NUMERIC(16,2) NOT NULL DEFAULT 1000000,
    equity          NUMERIC(16,2) NOT NULL DEFAULT 1000000,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- ORDERS : paper orders
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id            BIGSERIAL PRIMARY KEY,
    account_id    INT NOT NULL DEFAULT 1 REFERENCES accounts(id),
    instrument_id INT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    side          VARCHAR(4) NOT NULL,          -- BUY | SELL
    order_type    VARCHAR(8) NOT NULL DEFAULT 'MARKET', -- MARKET | LIMIT
    quantity      INT NOT NULL,
    limit_price   NUMERIC(14,4),
    status        VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING|PARTIAL|FILLED|REJECTED|CANCELLED
    filled_qty    INT NOT NULL DEFAULT 0,
    avg_price     NUMERIC(14,4),
    strategy      VARCHAR(40),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);

-- ------------------------------------------------------------------
-- TRADES : executions
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
    id            BIGSERIAL PRIMARY KEY,
    order_id      BIGINT REFERENCES orders(id) ON DELETE SET NULL,
    account_id    INT NOT NULL DEFAULT 1 REFERENCES accounts(id),
    instrument_id INT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    side          VARCHAR(4) NOT NULL,
    quantity      INT NOT NULL,
    price         NUMERIC(14,4) NOT NULL,
    realized_pnl  NUMERIC(14,4) NOT NULL DEFAULT 0,
    strategy      VARCHAR(40),
    ts            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades (ts DESC);

-- ------------------------------------------------------------------
-- POSITIONS : aggregate holdings
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
    id            SERIAL PRIMARY KEY,
    account_id    INT NOT NULL DEFAULT 1 REFERENCES accounts(id),
    instrument_id INT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    quantity      INT NOT NULL DEFAULT 0,
    avg_price     NUMERIC(14,4) NOT NULL DEFAULT 0,
    realized_pnl  NUMERIC(14,4) NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, instrument_id)
);

-- ------------------------------------------------------------------
-- EQUITY_CURVE : portfolio mark-to-market history
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equity_curve (
    id         BIGSERIAL PRIMARY KEY,
    account_id INT NOT NULL DEFAULT 1 REFERENCES accounts(id),
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    equity     NUMERIC(16,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_equity_ts ON equity_curve (account_id, ts);

-- ------------------------------------------------------------------
-- WATCHLISTS
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watchlists (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(60) NOT NULL DEFAULT 'Default',
    instrument_ids INT[] NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- NEWS_EVENTS : stock news / market events affecting price
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news_events (
    id            BIGSERIAL PRIMARY KEY,
    instrument_id INT REFERENCES instruments(id) ON DELETE CASCADE, -- NULL => market-wide
    symbol        VARCHAR(20),
    headline      TEXT NOT NULL,
    summary       TEXT,
    source        VARCHAR(60) NOT NULL DEFAULT 'NSE',
    sentiment     VARCHAR(10) NOT NULL DEFAULT 'NEUTRAL', -- BULLISH | BEARISH | NEUTRAL
    impact        VARCHAR(8)  NOT NULL DEFAULT 'LOW',     -- HIGH | MEDIUM | LOW
    category      VARCHAR(24) NOT NULL DEFAULT 'NEWS',    -- NEWS | EARNINGS | DIVIDEND | SPLIT | BUYBACK | ANNOUNCEMENT | MACRO
    tags          TEXT[] DEFAULT '{}',
    event_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_news_symbol ON news_events (symbol, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_ts ON news_events (published_at DESC);

-- ------------------------------------------------------------------
-- ALGORITHM_CONFIGS : strategy registry
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS algorithm_configs (
    id         SERIAL PRIMARY KEY,
    strategy   VARCHAR(40) NOT NULL UNIQUE,
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    params     JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
