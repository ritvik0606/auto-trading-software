const pool = require("../config/db");
const { getSignal } = require("./signal.service");
const { getSymbolQuote } = require("./market.service");
const { createPaperTrade } = require("./paperTrade.service");
const { hasOpenPositionForSymbol } = require("./position.service");

const SUPPORTED_STRATEGIES = new Set(["EMA_RSI"]);
const TIMEFRAMES = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};
const runners = new Map();

class MultiStrategyError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "MultiStrategyError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function parseId(id) {
  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new MultiStrategyError(
      "Strategy ID must be a positive integer",
      400
    );
  }

  return numericId;
}

function normalizeInput(input = {}) {
  const strategyName =
    typeof input.strategyName === "string"
      ? input.strategyName.trim().toUpperCase()
      : "";
  const symbol =
    typeof input.symbol === "string"
      ? input.symbol.trim().toUpperCase()
      : "";
  const timeframe =
    typeof input.timeframe === "string"
      ? input.timeframe.trim().toLowerCase()
      : "";
  const capitalAllocated = Number(input.capitalAllocated);
  const maxTrades = Number(input.maxTrades);

  if (!SUPPORTED_STRATEGIES.has(strategyName)) {
    throw new MultiStrategyError(
      `strategyName must be one of: ${Array.from(
        SUPPORTED_STRATEGIES
      ).join(", ")}`,
      400
    );
  }

  if (!symbol || symbol.length > 50 || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new MultiStrategyError("Symbol is invalid", 400);
  }

  if (!TIMEFRAMES[timeframe]) {
    throw new MultiStrategyError(
      `timeframe must be one of: ${Object.keys(TIMEFRAMES).join(", ")}`,
      400
    );
  }

  if (!Number.isFinite(capitalAllocated) || capitalAllocated <= 0) {
    throw new MultiStrategyError(
      "capitalAllocated must be a positive number",
      400
    );
  }

  if (!Number.isInteger(maxTrades) || maxTrades <= 0) {
    throw new MultiStrategyError(
      "maxTrades must be a positive integer",
      400
    );
  }

  return {
    strategyName,
    symbol,
    timeframe,
    capitalAllocated,
    maxTrades,
  };
}

function mapStrategy(row) {
  const runner = runners.get(row.id);

  return {
    id: row.id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    status: row.status,
    timeframe: row.timeframe,
    capitalAllocated: Number(row.capital_allocated),
    maxTrades: row.max_trades,
    lastSignal: runner?.lastSignal || null,
    lastAction: runner?.lastAction || null,
    lastError: runner?.lastError || null,
    lastRunAt: runner?.lastRunAt || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getStrategyRow(id, client = pool) {
  const result = await client.query(
    `SELECT *
     FROM multi_strategies
     WHERE id = $1`,
    [parseId(id)]
  );

  if (result.rows.length === 0) {
    throw new MultiStrategyError("Strategy instance not found", 404);
  }

  return result.rows[0];
}

async function addStrategy(input) {
  const strategy = normalizeInput(input);
  const result = await pool.query(
    `INSERT INTO multi_strategies (
       strategy_name,
       symbol,
       status,
       timeframe,
       capital_allocated,
       max_trades
     )
     VALUES ($1, $2, 'STOPPED', $3, $4, $5)
     RETURNING *`,
    [
      strategy.strategyName,
      strategy.symbol,
      strategy.timeframe,
      strategy.capitalAllocated,
      strategy.maxTrades,
    ]
  );

  const savedStrategy = mapStrategy(result.rows[0]);
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "STRATEGY",
    action: "MULTI_STRATEGY_ADDED",
    severity: "INFO",
    entityType: "MULTI_STRATEGY",
    entityId: savedStrategy.id,
    message: "Multi-strategy instance added",
    metadata: savedStrategy,
  });
  return savedStrategy;
}

async function getUsage(strategyId) {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS trades_executed,
       COALESCE(
         SUM(entry_price * quantity) FILTER (WHERE status = 'OPEN'),
         0
       ) AS open_capital
     FROM paper_trades
     WHERE multi_strategy_id = $1`,
    [strategyId]
  );

  return {
    tradesExecuted: Number(result.rows[0].trades_executed),
    openCapital: Number(result.rows[0].open_capital),
  };
}

async function attachTradeToStrategy(tradeId, strategyId) {
  await pool.query(
    `UPDATE paper_trades
     SET multi_strategy_id = $1
     WHERE id = $2`,
    [strategyId, tradeId]
  );
}

async function executeCycle(runner) {
  if (runner.isRunning || !runners.has(runner.id)) {
    return;
  }

  runner.isRunning = true;
  runner.lastRunAt = new Date().toISOString();

  try {
    const strategy = await getStrategyRow(runner.id);
    if (strategy.status !== "ACTIVE") {
      runner.lastAction = "SKIPPED_NOT_ACTIVE";
      return;
    }

    const usage = await getUsage(strategy.id);
    if (usage.tradesExecuted >= strategy.max_trades) {
      runner.lastAction = "SKIPPED_MAX_TRADES";
      return;
    }

    if (await hasOpenPositionForSymbol(strategy.symbol)) {
      runner.lastAction = "SKIPPED_OPEN_POSITION";
      return;
    }

    const signal = await getSignal(strategy.symbol);
    runner.lastSignal = signal.signal;

    if (signal.signal === "HOLD") {
      runner.lastAction = "NO_ACTION";
      runner.lastError = null;
      return;
    }

    const quote = await getSymbolQuote(strategy.symbol);
    const remainingCapital =
      Number(strategy.capital_allocated) - usage.openCapital;

    if (quote.ltp > remainingCapital) {
      runner.lastAction = "SKIPPED_CAPITAL_LIMIT";
      runner.lastError = null;
      return;
    }

    const trade = await createPaperTrade(signal.signal, {
      symbol: strategy.symbol,
      exchange: "NSE",
      quantity: 1,
      price: quote.ltp,
    });
    await attachTradeToStrategy(trade.id, strategy.id);

    runner.lastAction = `PAPER_${trade.tradeType}_CREATED`;
    runner.lastError = null;
  } catch (error) {
    runner.lastAction = "CYCLE_FAILED";
    runner.lastError = error.message || "Strategy cycle failed";
    console.error("Multi strategy paper cycle failed", {
      strategyId: runner.id,
      symbol: runner.symbol,
      message: runner.lastError,
    });
  } finally {
    runner.isRunning = false;
  }
}

function createRunner(row) {
  const runner = {
    id: row.id,
    symbol: row.symbol,
    isRunning: false,
    timer: null,
    lastSignal: null,
    lastAction: "STARTED",
    lastError: null,
    lastRunAt: null,
  };

  runners.set(row.id, runner);
  runner.timer = setInterval(
    () => executeCycle(runner),
    TIMEFRAMES[row.timeframe]
  );
  runner.timer.unref();
  executeCycle(runner).catch((error) => {
    runner.lastAction = "CYCLE_FAILED";
    runner.lastError = error.message || "Strategy cycle failed";
  });

  return runner;
}

async function startStrategy(id) {
  const {
    assertTradingAllowed,
  } = require("./killSwitch.service");
  await assertTradingAllowed();
  const strategyId = parseId(id);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const row = await getStrategyRow(strategyId, client);

    if (row.status === "ACTIVE") {
      throw new MultiStrategyError(
        "Strategy instance is already active",
        409
      );
    }

    const duplicate = await client.query(
      `SELECT id
       FROM multi_strategies
       WHERE UPPER(strategy_name) = UPPER($1)
         AND UPPER(symbol) = UPPER($2)
         AND status = 'ACTIVE'
         AND id <> $3
       LIMIT 1`,
      [row.strategy_name, row.symbol, strategyId]
    );

    if (duplicate.rows.length > 0) {
      throw new MultiStrategyError(
        "An active strategy already exists for this symbol and strategy",
        409
      );
    }

    const usage = await getUsage(strategyId);
    if (usage.tradesExecuted >= row.max_trades) {
      throw new MultiStrategyError(
        "Strategy has reached its maxTrades limit",
        409
      );
    }

    const result = await client.query(
      `UPDATE multi_strategies
       SET status = 'ACTIVE',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [strategyId]
    );
    await client.query("COMMIT");
    createRunner(result.rows[0]);

    const strategy = mapStrategy(result.rows[0]);
    const { safeRecordAudit } = require("./auditTrail.service");
    await safeRecordAudit({
      category: "STRATEGY",
      action: "MULTI_STRATEGY_STARTED",
      severity: "INFO",
      entityType: "MULTI_STRATEGY",
      entityId: strategy.id,
      message: `${strategy.strategyName} started for ${strategy.symbol}`,
      metadata: strategy,
    });
    return strategy;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new MultiStrategyError(
        "An active strategy already exists for this symbol and strategy",
        409
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function setStrategyStatus(id, status) {
  const strategyId = parseId(id);
  const row = await getStrategyRow(strategyId);

  if (row.status === status) {
    throw new MultiStrategyError(
      `Strategy instance is already ${status.toLowerCase()}`,
      409
    );
  }

  const runner = runners.get(strategyId);
  if (runner) {
    clearInterval(runner.timer);
    runners.delete(strategyId);
  }

  const result = await pool.query(
    `UPDATE multi_strategies
     SET status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [status, strategyId]
  );

  const strategy = mapStrategy(result.rows[0]);
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "STRATEGY",
    action: `MULTI_STRATEGY_${status}`,
    severity: status === "STOPPED" ? "WARNING" : "INFO",
    entityType: "MULTI_STRATEGY",
    entityId: strategy.id,
    message: `Multi-strategy changed to ${status}`,
    metadata: strategy,
  });
  return strategy;
}

async function pauseStrategy(id) {
  const row = await getStrategyRow(id);
  if (row.status !== "ACTIVE") {
    throw new MultiStrategyError(
      "Only an active strategy can be paused",
      409
    );
  }
  return setStrategyStatus(id, "PAUSED");
}

async function stopStrategy(id) {
  return setStrategyStatus(id, "STOPPED");
}

async function stopAllStrategies() {
  for (const runner of runners.values()) {
    clearInterval(runner.timer);
  }
  runners.clear();
  const result = await pool.query(
    `UPDATE multi_strategies
     SET status = 'STOPPED',
         updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('ACTIVE', 'PAUSED')
     RETURNING *`
  );
  const stopped = result.rows.map(mapStrategy);
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "STRATEGY",
    action: "ALL_MULTI_STRATEGIES_STOPPED",
    severity: "WARNING",
    message: "All multi-strategy runners stopped",
    metadata: { stoppedCount: stopped.length },
  });
  return stopped;
}

async function getStrategies(activeOnly = false) {
  const result = await pool.query(
    `SELECT *
     FROM multi_strategies
     ${activeOnly ? "WHERE status = 'ACTIVE'" : ""}
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapStrategy);
}

async function getStrategyPerformance(id) {
  const strategy = mapStrategy(await getStrategyRow(id));
  const result = await pool.query(
    `SELECT
       COUNT(*) AS total_trades,
       COUNT(*) FILTER (WHERE status = 'OPEN') AS open_trades,
       COUNT(*) FILTER (WHERE pnl > 0) AS winning_trades,
       COUNT(*) FILTER (WHERE pnl < 0) AS losing_trades,
       COALESCE(SUM(pnl), 0) AS total_pnl,
       COALESCE(
         SUM(entry_price * quantity) FILTER (WHERE status = 'OPEN'),
         0
       ) AS capital_in_use
     FROM paper_trades
     WHERE multi_strategy_id = $1`,
    [strategy.id]
  );
  const row = result.rows[0];
  const totalTrades = Number(row.total_trades);
  const winningTrades = Number(row.winning_trades);
  const capitalInUse = Number(row.capital_in_use);

  return {
    strategy,
    totalTrades,
    openTrades: Number(row.open_trades),
    winningTrades,
    losingTrades: Number(row.losing_trades),
    winRate:
      totalTrades === 0
        ? 0
        : round((winningTrades / totalTrades) * 100),
    totalPnL: Number(row.total_pnl),
    capitalInUse: round(capitalInUse),
    remainingCapital: round(
      Math.max(strategy.capitalAllocated - capitalInUse, 0)
    ),
    tradesRemaining: Math.max(strategy.maxTrades - totalTrades, 0),
  };
}

async function restoreActiveStrategies() {
  try {
    const result = await pool.query(
      `SELECT *
       FROM multi_strategies
       WHERE status = 'ACTIVE'`
    );

    for (const row of result.rows) {
      if (!runners.has(row.id)) {
        createRunner(row);
      }
    }
  } catch (error) {
    console.error("Unable to restore active multi strategies", {
      message: error.message,
    });
  }
}

restoreActiveStrategies();

module.exports = {
  MultiStrategyError,
  addStrategy,
  startStrategy,
  pauseStrategy,
  stopStrategy,
  stopAllStrategies,
  getStrategies,
  getStrategyPerformance,
};
