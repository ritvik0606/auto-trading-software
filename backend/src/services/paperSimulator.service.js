const pool = require("../config/db");
const { getSymbolQuote } = require("./market.service");
const {
  evaluateRisk,
  validateNewTrade,
} = require("./riskEngine.service");
const strategyGenerator = require("./strategyGenerator.service");

const DEFAULT_BALANCE = 100000;
const ALLOWED_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
let schemaReady = null;

class PaperSimulatorError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "PaperSimulatorError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new PaperSimulatorError(`${fieldName} must be a positive number`, 400);
  }
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new PaperSimulatorError(`${fieldName} must be a positive integer`, 400);
  }
  return number;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS paper_simulator_account (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          initial_balance DECIMAL NOT NULL DEFAULT 100000,
          cash_balance DECIMAL NOT NULL DEFAULT 100000,
          realized_pnl DECIMAL NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS paper_simulator_positions (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(50) NOT NULL,
          exchange VARCHAR(20) NOT NULL DEFAULT 'NSE',
          side VARCHAR(10) NOT NULL,
          quantity INTEGER NOT NULL,
          average_price DECIMAL NOT NULL,
          current_price DECIMAL NOT NULL,
          unrealized_pnl DECIMAL NOT NULL DEFAULT 0,
          realized_pnl DECIMAL NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
          strategy_template_id INTEGER,
          strategy_name VARCHAR(120) NOT NULL DEFAULT 'MANUAL',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          closed_at TIMESTAMP
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS paper_simulator_orders (
          id SERIAL PRIMARY KEY,
          position_id INTEGER REFERENCES paper_simulator_positions(id),
          symbol VARCHAR(50) NOT NULL,
          exchange VARCHAR(20) NOT NULL DEFAULT 'NSE',
          side VARCHAR(10) NOT NULL,
          order_action VARCHAR(10) NOT NULL,
          quantity INTEGER NOT NULL,
          price DECIMAL NOT NULL,
          amount DECIMAL NOT NULL,
          pnl DECIMAL NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'FILLED',
          strategy_template_id INTEGER,
          strategy_name VARCHAR(120) NOT NULL DEFAULT 'MANUAL',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS paper_simulator_equity (
          id SERIAL PRIMARY KEY,
          cash_balance DECIMAL NOT NULL,
          equity DECIMAL NOT NULL,
          realized_pnl DECIMAL NOT NULL,
          unrealized_pnl DECIMAL NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`
        ALTER TABLE trade_journal
        ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'PAPER_TRADE'
      `);
      await pool.query(`
        ALTER TABLE trade_journal
        ADD COLUMN IF NOT EXISTS simulator_position_id INTEGER
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
          trade_journal_simulator_position_unique
        ON trade_journal (simulator_position_id)
        WHERE simulator_position_id IS NOT NULL
      `);
      await pool.query(
        `INSERT INTO paper_simulator_account (id)
         VALUES (1)
         ON CONFLICT (id) DO NOTHING`
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function normalizeSymbol(value) {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!symbol || symbol.length > 50 || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new PaperSimulatorError("Symbol is invalid", 400);
  }
  return symbol;
}

function normalizeExchange(value) {
  const exchange =
    typeof value === "string" && value.trim()
      ? value.trim().toUpperCase()
      : "NSE";
  if (!ALLOWED_EXCHANGES.has(exchange)) {
    throw new PaperSimulatorError(
      `Exchange must be one of: ${Array.from(ALLOWED_EXCHANGES).join(", ")}`,
      400
    );
  }
  return exchange;
}

function optionalPrice(value) {
  if (value === undefined || value === null || value === "") return null;
  return positiveNumber(value, "price");
}

async function resolvePrice(symbol, exchange, price) {
  if (price !== null) return price;
  if (exchange !== "NSE") {
    throw new PaperSimulatorError(
      "A manual price is required for non-NSE simulator orders",
      400
    );
  }

  try {
    const quote = await getSymbolQuote(symbol);
    return positiveNumber(quote.ltp, "Market price");
  } catch (error) {
    throw new PaperSimulatorError(
      "Market price unavailable. Submit a manual paper price.",
      503
    );
  }
}

async function resolveStrategy(input = {}) {
  if (input.strategyTemplateId === undefined || input.strategyTemplateId === null) {
    const name =
      typeof input.strategyName === "string" && input.strategyName.trim()
        ? input.strategyName.trim().slice(0, 120)
        : "MANUAL";
    return { strategyTemplateId: null, strategyName: name };
  }

  const strategyTemplateId = positiveInteger(
    input.strategyTemplateId,
    "strategyTemplateId"
  );
  await strategyGenerator.getHistory();
  const result = await pool.query(
    `SELECT id, strategy_name
     FROM strategy_generator_templates
     WHERE id = $1`,
    [strategyTemplateId]
  );
  if (result.rows.length === 0) {
    throw new PaperSimulatorError("Saved strategy template not found", 404);
  }
  return {
    strategyTemplateId,
    strategyName: result.rows[0].strategy_name,
  };
}

function mapPosition(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.side,
    quantity: Number(row.quantity),
    averagePrice: Number(row.average_price),
    currentPrice: Number(row.current_price),
    unrealizedPnl: Number(row.unrealized_pnl),
    realizedPnl: Number(row.realized_pnl),
    positionValue: round(Number(row.current_price) * Number(row.quantity)),
    status: row.status,
    strategyTemplateId: row.strategy_template_id,
    strategyName: row.strategy_name,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    positionId: row.position_id,
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.side,
    action: row.order_action,
    quantity: Number(row.quantity),
    price: Number(row.price),
    amount: Number(row.amount),
    pnl: Number(row.pnl),
    status: row.status,
    strategyTemplateId: row.strategy_template_id,
    strategyName: row.strategy_name,
    createdAt: row.created_at,
  };
}

async function refreshPosition(row) {
  let currentPrice = Number(row.current_price);
  let priceSource = "LAST_KNOWN";

  if (row.exchange === "NSE") {
    try {
      const quote = await getSymbolQuote(row.symbol);
      currentPrice = Number(quote.ltp);
      priceSource = "LIVE";
    } catch {
      priceSource = "LAST_KNOWN";
    }
  }

  const direction = row.side === "BUY" ? 1 : -1;
  const unrealizedPnl = round(
    (currentPrice - Number(row.average_price)) *
      Number(row.quantity) *
      direction
  );
  const result = await pool.query(
    `UPDATE paper_simulator_positions
     SET current_price = $1, unrealized_pnl = $2
     WHERE id = $3
     RETURNING *`,
    [currentPrice, unrealizedPnl, row.id]
  );

  return { ...mapPosition(result.rows[0]), priceSource };
}

async function getPositions() {
  await ensureSchema();
  const result = await pool.query(
    `SELECT *
     FROM paper_simulator_positions
     WHERE status = 'OPEN'
     ORDER BY created_at DESC, id DESC`
  );
  return Promise.all(result.rows.map(refreshPosition));
}

async function recordEquity(client) {
  const result = await client.query(
    `SELECT
       account.cash_balance,
       account.realized_pnl,
       COALESCE(SUM(positions.average_price * positions.quantity), 0)
         AS reserved_capital,
       COALESCE(SUM(positions.unrealized_pnl), 0) AS unrealized_pnl
     FROM paper_simulator_account account
     LEFT JOIN paper_simulator_positions positions
       ON positions.status = 'OPEN'
     WHERE account.id = 1
     GROUP BY account.cash_balance, account.realized_pnl`
  );
  const row = result.rows[0];
  const equity =
    Number(row.cash_balance) +
    Number(row.reserved_capital) +
    Number(row.unrealized_pnl);

  await client.query(
    `INSERT INTO paper_simulator_equity (
       cash_balance, equity, realized_pnl, unrealized_pnl
     )
     VALUES ($1, $2, $3, $4)`,
    [
      row.cash_balance,
      round(equity),
      row.realized_pnl,
      row.unrealized_pnl,
    ]
  );
}

async function getAccount() {
  await ensureSchema();
  const positions = await getPositions();
  const result = await pool.query(
    `SELECT * FROM paper_simulator_account WHERE id = 1`
  );
  const account = result.rows[0];
  const reservedCapital = positions.reduce(
    (sum, position) => sum + position.averagePrice * position.quantity,
    0
  );
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0
  );
  const equity =
    Number(account.cash_balance) + reservedCapital + unrealizedPnl;
  const risk = await evaluateRisk();

  return {
    mode: "PAPER_ONLY",
    initialBalance: Number(account.initial_balance),
    virtualBalance: round(equity),
    cashBalance: Number(account.cash_balance),
    reservedCapital: round(reservedCapital),
    realizedPnl: Number(account.realized_pnl),
    unrealizedPnl: round(unrealizedPnl),
    totalPnl: round(Number(account.realized_pnl) + unrealizedPnl),
    openPositions: positions.length,
    riskStatus: risk.status,
    tradingAllowed: risk.tradingAllowed,
    updatedAt: account.updated_at,
  };
}

async function validateSimulatorRisk(quantity, price) {
  const risk = await validateNewTrade({ quantity, entryPrice: price });
  const result = await pool.query(
    `SELECT
       COUNT(positions.id) FILTER (
         WHERE positions.status = 'OPEN'
       ) AS open_positions,
       COUNT(*) FILTER (
         WHERE orders.order_action = 'OPEN'
           AND orders.created_at::date = CURRENT_DATE
       ) AS daily_trades
     FROM paper_simulator_positions positions
     FULL JOIN paper_simulator_orders orders ON FALSE`
  );
  const simulatorOpen = Number(result.rows[0].open_positions);
  const simulatorDaily = Number(result.rows[0].daily_trades);

  if (
    risk.metrics.openPositions + simulatorOpen >=
    risk.config.maxOpenPositions
  ) {
    throw new PaperSimulatorError("Maximum open positions reached", 423);
  }
  if (
    risk.metrics.dailyTrades + simulatorDaily >=
    risk.config.maxDailyTrades
  ) {
    throw new PaperSimulatorError("Maximum daily trades reached", 423);
  }
  return risk;
}

async function openPosition(input) {
  const symbol = normalizeSymbol(input.symbol);
  const exchange = normalizeExchange(input.exchange);
  const side =
    typeof input.side === "string" ? input.side.trim().toUpperCase() : "";
  if (!["BUY", "SELL"].includes(side)) {
    throw new PaperSimulatorError("side must be BUY or SELL", 400);
  }
  const quantity = positiveInteger(input.quantity, "quantity");
  const price = await resolvePrice(symbol, exchange, optionalPrice(input.price));
  const strategy = await resolveStrategy(input);
  await validateSimulatorRisk(quantity, price);
  await ensureSchema();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accountResult = await client.query(
      `SELECT * FROM paper_simulator_account WHERE id = 1 FOR UPDATE`
    );
    const account = accountResult.rows[0];
    const amount = round(price * quantity);
    if (Number(account.cash_balance) < amount) {
      throw new PaperSimulatorError("Insufficient virtual cash balance", 400);
    }

    const positionResult = await client.query(
      `INSERT INTO paper_simulator_positions (
         symbol, exchange, side, quantity, average_price, current_price,
         strategy_template_id, strategy_name
       )
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
       RETURNING *`,
      [
        symbol,
        exchange,
        side,
        quantity,
        price,
        strategy.strategyTemplateId,
        strategy.strategyName,
      ]
    );
    const position = positionResult.rows[0];
    const orderResult = await client.query(
      `INSERT INTO paper_simulator_orders (
         position_id, symbol, exchange, side, order_action, quantity,
         price, amount, strategy_template_id, strategy_name
       )
       VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        position.id,
        symbol,
        exchange,
        side,
        quantity,
        price,
        amount,
        strategy.strategyTemplateId,
        strategy.strategyName,
      ]
    );
    await client.query(
      `UPDATE paper_simulator_account
       SET cash_balance = cash_balance - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [amount]
    );
    await recordEquity(client);
    await client.query("COMMIT");

    return {
      order: mapOrder(orderResult.rows[0]),
      position: mapPosition(position),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closePosition(input) {
  const positionId = positiveInteger(input.positionId, "positionId");
  await ensureSchema();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const positionResult = await client.query(
      `SELECT *
       FROM paper_simulator_positions
       WHERE id = $1
       FOR UPDATE`,
      [positionId]
    );
    if (positionResult.rows.length === 0) {
      throw new PaperSimulatorError("Simulator position not found", 404);
    }
    const position = positionResult.rows[0];
    if (position.status !== "OPEN") {
      throw new PaperSimulatorError("Simulator position is already closed", 409);
    }

    const price = await resolvePrice(
      position.symbol,
      position.exchange,
      optionalPrice(input.price)
    );
    const direction = position.side === "BUY" ? 1 : -1;
    const pnl = round(
      (price - Number(position.average_price)) *
        Number(position.quantity) *
        direction
    );
    const reservedAmount = round(
      Number(position.average_price) * Number(position.quantity)
    );
    const closeSide = position.side === "BUY" ? "SELL" : "BUY";
    const closedPosition = await client.query(
      `UPDATE paper_simulator_positions
       SET current_price = $1,
           unrealized_pnl = 0,
           realized_pnl = $2,
           status = 'CLOSED',
           closed_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [price, pnl, positionId]
    );
    const orderResult = await client.query(
      `INSERT INTO paper_simulator_orders (
         position_id, symbol, exchange, side, order_action, quantity,
         price, amount, pnl, strategy_template_id, strategy_name
       )
       VALUES ($1, $2, $3, $4, 'CLOSE', $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        positionId,
        position.symbol,
        position.exchange,
        closeSide,
        position.quantity,
        price,
        round(price * Number(position.quantity)),
        pnl,
        position.strategy_template_id,
        position.strategy_name,
      ]
    );
    await client.query(
      `UPDATE paper_simulator_account
       SET cash_balance = cash_balance + $1 + $2,
           realized_pnl = realized_pnl + $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [reservedAmount, pnl]
    );
    await client.query(
      `INSERT INTO trade_journal (
         trade_id, symbol, side, entry_price, exit_price, quantity,
         pnl, result, notes, source, simulator_position_id
       )
       VALUES (
         NULL, $1, $2, $3, $4, $5, $6, $7,
         $8, 'PAPER_SIMULATOR', $9
       )
       ON CONFLICT (simulator_position_id) WHERE simulator_position_id IS NOT NULL
       DO UPDATE SET
         exit_price = EXCLUDED.exit_price,
         pnl = EXCLUDED.pnl,
         result = EXCLUDED.result,
         notes = EXCLUDED.notes`,
      [
        position.symbol,
        position.side,
        position.average_price,
        price,
        position.quantity,
        pnl,
        pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN",
        `Paper simulator strategy: ${position.strategy_name}`,
        positionId,
      ]
    );
    await recordEquity(client);
    await client.query("COMMIT");

    return {
      order: mapOrder(orderResult.rows[0]),
      position: mapPosition(closedPosition.rows[0]),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function placeOrder(input = {}) {
  const action =
    typeof input.action === "string"
      ? input.action.trim().toUpperCase()
      : "OPEN";
  if (action === "OPEN") return openPosition(input);
  if (action === "CLOSE") return closePosition(input);
  throw new PaperSimulatorError("action must be OPEN or CLOSE", 400);
}

async function getHistory() {
  await ensureSchema();
  const [orders, equity] = await Promise.all([
    pool.query(
      `SELECT *
       FROM paper_simulator_orders
       ORDER BY created_at DESC, id DESC
       LIMIT 500`
    ),
    pool.query(
      `SELECT id, cash_balance, equity, realized_pnl, unrealized_pnl, created_at
       FROM paper_simulator_equity
       ORDER BY created_at, id`
    ),
  ]);

  return {
    orders: orders.rows.map(mapOrder),
    equityCurve: equity.rows.map((row) => ({
      id: row.id,
      cashBalance: Number(row.cash_balance),
      equity: Number(row.equity),
      realizedPnl: Number(row.realized_pnl),
      unrealizedPnl: Number(row.unrealized_pnl),
      timestamp: row.created_at,
    })),
  };
}

async function resetSimulator(input = {}) {
  if (input.confirm !== "RESET") {
    throw new PaperSimulatorError(
      'Reset requires {"confirm":"RESET"}',
      400
    );
  }
  const initialBalance =
    input.initialBalance === undefined
      ? DEFAULT_BALANCE
      : positiveNumber(input.initialBalance, "initialBalance");
  await ensureSchema();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM trade_journal WHERE source = 'PAPER_SIMULATOR'`
    );
    await client.query("TRUNCATE paper_simulator_orders RESTART IDENTITY CASCADE");
    await client.query("TRUNCATE paper_simulator_positions RESTART IDENTITY CASCADE");
    await client.query("TRUNCATE paper_simulator_equity RESTART IDENTITY");
    await client.query(
      `UPDATE paper_simulator_account
       SET initial_balance = $1,
           cash_balance = $1,
           realized_pnl = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [initialBalance]
    );
    await recordEquity(client);
    await client.query("COMMIT");
    return getAccount();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  PaperSimulatorError,
  ensureSchema,
  getAccount,
  placeOrder,
  getPositions,
  getHistory,
  resetSimulator,
};
