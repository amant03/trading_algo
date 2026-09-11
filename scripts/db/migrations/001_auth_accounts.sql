-- ============================================================
-- 001_auth_accounts.sql — Epic 1.1 (auth & per-user accounts)
--
-- Non-destructive: every statement is IF NOT EXISTS-guarded, so it is safe
-- to run against a live deployed database that already holds paper-trading
-- history. Pre-auth rows keep user_id NULL and keep working through the
-- legacy global account (id = 1).
-- Run via: npx tsx scripts/db/apply-schema.ts   (runs schema.sql first,
-- then every pending file in scripts/db/migrations/ in filename order)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    email          VARCHAR(255) NOT NULL,
    password_hash  TEXT,
    display_name   VARCHAR(80)  NOT NULL,
    auth_provider  VARCHAR(10)  NOT NULL DEFAULT 'email',
    has_onboarded  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ,
    UNIQUE (email)
);

ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS user_id INT NULL REFERENCES users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_user ON accounts(user_id);

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS user_id INT NULL REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);

ALTER TABLE trades
    ADD COLUMN IF NOT EXISTS user_id INT NULL REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades (user_id, ts DESC);

ALTER TABLE positions
    ADD COLUMN IF NOT EXISTS user_id INT NULL REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE equity_curve
    ADD COLUMN IF NOT EXISTS user_id INT NULL REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE watchlists
    ADD COLUMN IF NOT EXISTS user_id INT NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE watchlists
    ADD COLUMN IF NOT EXISTS symbol VARCHAR(20);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watchlists_owner_ck') THEN
        ALTER TABLE watchlists
            ADD CONSTRAINT watchlists_owner_ck CHECK (user_id IS NULL OR symbol IS NOT NULL);
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_watchlists_user_symbol ON watchlists(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists (user_id);

-- Repair accounts_id_seq: the legacy executor inserts account id = 1 with an
-- explicit id, which never advances the SERIAL sequence. The next
-- sequence-driven insert (first per-user account) would then collide with
-- id 1. Called at the end so it also covers fresh installs.
SELECT setval('accounts_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM accounts), 1));
