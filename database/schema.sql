CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    capital NUMERIC(12,2) DEFAULT 100000,
    risk_per_trade_percent NUMERIC(5,2) DEFAULT 1,
    max_daily_loss NUMERIC(12,2) DEFAULT 2000,
    daily_loss_limit_percent NUMERIC(5,2) DEFAULT 2,
    daily_profit_lock_percent NUMERIC(5,2) DEFAULT 4,
    max_trades_per_day INTEGER DEFAULT 5,
    max_open_positions INTEGER DEFAULT 2,
    auto_squareoff_time TIME DEFAULT '15:15:00',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE risk_settings
ADD COLUMN IF NOT EXISTS max_daily_loss NUMERIC(12,2) DEFAULT 2000;

ALTER TABLE risk_settings
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS strategies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    symbol VARCHAR(100) NOT NULL,
    instrument_type VARCHAR(50),
    side VARCHAR(10),
    quantity INTEGER,
    entry_price NUMERIC(12,2),
    exit_price NUMERIC(12,2),
    stop_loss NUMERIC(12,2),
    target NUMERIC(12,2),
    pnl NUMERIC(12,2),
    status VARCHAR(30) DEFAULT 'OPEN',
    entry_reason TEXT,
    exit_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    exited_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watchlists (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    exchange VARCHAR(20) DEFAULT 'NSE',
    symbol_token VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS watchlists_symbol_exchange_unique
ON watchlists (UPPER(symbol), UPPER(exchange));

CREATE TABLE IF NOT EXISTS paper_trades (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    exchange VARCHAR(20) DEFAULT 'NSE',
    trade_type VARCHAR(10) NOT NULL,
    entry_price NUMERIC(12,2) NOT NULL,
    quantity INTEGER NOT NULL,
    stop_loss NUMERIC(12,2),
    target_price NUMERIC(12,2),
    status VARCHAR(20) DEFAULT 'OPEN',
    exit_price NUMERIC(12,2),
    pnl NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER REFERENCES paper_trades(id),
    symbol VARCHAR(50),
    exchange VARCHAR(20),
    side VARCHAR(10),
    quantity INTEGER,
    average_price NUMERIC(12,2),
    current_price NUMERIC(12,2),
    unrealized_pnl NUMERIC(12,2) DEFAULT 0,
    realized_pnl NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS positions_trade_id_unique
ON positions (trade_id);

INSERT INTO positions (
    trade_id,
    symbol,
    exchange,
    side,
    quantity,
    average_price,
    current_price,
    unrealized_pnl,
    realized_pnl,
    status,
    created_at
)
SELECT
    id,
    symbol,
    exchange,
    trade_type,
    quantity,
    entry_price,
    COALESCE(exit_price, entry_price),
    0,
    COALESCE(pnl, 0),
    status,
    created_at
FROM paper_trades
ON CONFLICT (trade_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trade_journal (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER REFERENCES paper_trades(id),
    symbol VARCHAR(50),
    side VARCHAR(10),
    entry_price NUMERIC(12,2),
    exit_price NUMERIC(12,2),
    quantity INTEGER,
    pnl NUMERIC(12,2),
    result VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_journal_trade_id_unique
ON trade_journal (trade_id);

INSERT INTO trade_journal (
    trade_id,
    symbol,
    side,
    entry_price,
    exit_price,
    quantity,
    pnl,
    result,
    created_at
)
SELECT
    id,
    symbol,
    trade_type,
    entry_price,
    exit_price,
    quantity,
    pnl,
    CASE
        WHEN pnl > 0 THEN 'WIN'
        WHEN pnl < 0 THEN 'LOSS'
        ELSE 'BREAKEVEN'
    END,
    COALESCE(closed_at, created_at)
FROM paper_trades
WHERE status = 'CLOSED'
ON CONFLICT (trade_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50),
    exchange VARCHAR(20),
    side VARCHAR(10),
    order_type VARCHAR(20),
    quantity INTEGER,
    price NUMERIC(12,2),
    status VARCHAR(30) DEFAULT 'BLOCKED',
    broker_order_id VARCHAR(100),
    mode VARCHAR(20) DEFAULT 'PAPER',
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS expected_price NUMERIC(12,2);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS executed_price NUMERIC(12,2);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(30) NOT NULL CHECK (
        alert_type IN (
            'PRICE_ABOVE',
            'PRICE_BELOW',
            'PROFIT_TARGET',
            'LOSS_LIMIT'
        )
    ),
    symbol VARCHAR(50),
    exchange VARCHAR(20),
    target_value NUMERIC(14,2) NOT NULL CHECK (target_value > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (
        status IN ('ACTIVE', 'TRIGGERED')
    ),
    triggered_value NUMERIC(14,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    triggered_at TIMESTAMP,
    CHECK (
        (
            alert_type IN ('PRICE_ABOVE', 'PRICE_BELOW')
            AND symbol IS NOT NULL
            AND exchange IS NOT NULL
        )
        OR (
            alert_type IN ('PROFIT_TARGET', 'LOSS_LIMIT')
            AND symbol IS NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS alerts_status_type_index
ON alerts (status, alert_type);

CREATE TABLE IF NOT EXISTS risk_rules (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    daily_loss_lock BOOLEAN NOT NULL DEFAULT TRUE,
    max_position_size INTEGER NOT NULL DEFAULT 1000 CHECK (
        max_position_size > 0
    ),
    max_capital_allocation_per_trade NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (
        max_capital_allocation_per_trade > 0
        AND max_capital_allocation_per_trade <= 100
    ),
    max_open_positions INTEGER NOT NULL DEFAULT 5 CHECK (
        max_open_positions > 0
    ),
    kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
    orders_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strategy_optimizations (
    id SERIAL PRIMARY KEY,
    strategy_name VARCHAR(100) NOT NULL,
    parameter_set JSONB NOT NULL,
    trades_analyzed INTEGER NOT NULL,
    win_rate NUMERIC(6,2) NOT NULL,
    profit_factor NUMERIC(12,4),
    avg_profit NUMERIC(14,2) NOT NULL,
    avg_loss NUMERIC(14,2) NOT NULL,
    max_drawdown NUMERIC(14,2) NOT NULL,
    score NUMERIC(6,2) NOT NULL CHECK (score >= 0 AND score <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS strategy_optimizations_score_index
ON strategy_optimizations (score DESC, created_at DESC);

INSERT INTO strategies (name, description, is_active)
VALUES (
    'EMA VWAP Breakout Strategy',
    '20 EMA > 50 EMA, price above VWAP, breakout confirmation, volume confirmation.',
    true
);
