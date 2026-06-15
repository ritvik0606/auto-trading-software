const pool = require("../config/db");
const { ensureSchema: ensureSimulatorSchema } = require(
  "./paperSimulator.service"
);

const FILLED_STATUSES = new Set([
  "FILLED",
  "COMPLETE",
  "COMPLETED",
  "EXECUTED",
]);
const REJECTED_STATUSES = new Set([
  "BLOCKED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
]);
let schemaReady = null;

class ExecutionAnalyticsError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ExecutionAnalyticsError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureSimulatorSchema();
      await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS filled_quantity INTEGER DEFAULT 0
      `);
      await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS broker_name VARCHAR(50)
      `);
      await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS strategy_trade_id INTEGER
      `);
      await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS last_status_at TIMESTAMP
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function latencyMs(row) {
  if (!row.submittedAt || !row.completedAt) return null;
  return Math.max(
    new Date(row.completedAt).getTime() -
      new Date(row.submittedAt).getTime(),
    0
  );
}

function slippage(row) {
  if (row.expectedPrice === null || row.executedPrice === null) return null;
  const direction = row.side === "SELL" ? -1 : 1;
  return round((row.executedPrice - row.expectedPrice) * direction);
}

async function loadExecutions() {
  await ensureSchema();
  const [orders, paperTrades, simulatorOrders] = await Promise.all([
    pool.query(
      `SELECT
         id, symbol, exchange, side, quantity, filled_quantity, status,
         mode, reason, broker_order_id, broker_name, strategy_trade_id,
         COALESCE(expected_price, price) AS expected_price,
         executed_price,
         COALESCE(submitted_at, created_at) AS submitted_at,
         COALESCE(executed_at, rejected_at, last_status_at) AS completed_at,
         created_at
       FROM orders
       ORDER BY created_at, id`
    ),
    pool.query(
      `SELECT
         paper_trades.id,
         paper_trades.symbol,
         paper_trades.exchange,
         paper_trades.trade_type AS side,
         paper_trades.quantity,
         paper_trades.entry_price,
         paper_trades.status,
         paper_trades.created_at,
         multi_strategies.strategy_name
       FROM paper_trades
       LEFT JOIN multi_strategies
         ON multi_strategies.id = paper_trades.multi_strategy_id
       ORDER BY paper_trades.created_at, paper_trades.id`
    ),
    pool.query(
      `SELECT *
       FROM paper_simulator_orders
       ORDER BY created_at, id`
    ),
  ]);

  const brokerRows = orders.rows.map((row) => {
    const status = String(row.status || "UNKNOWN").toUpperCase();
    const requestedQuantity = Number(row.quantity || 0);
    const filledQuantity = FILLED_STATUSES.has(status)
      ? Number(row.filled_quantity || requestedQuantity)
      : Number(row.filled_quantity || 0);
    return {
      id: `ORDER-${row.id}`,
      recordId: row.id,
      source: "ORDER_AUDIT",
      broker:
        row.broker_name ||
        (row.mode === "REAL" ? "ANGEL_ONE" : "SAFETY_LAYER"),
      strategy: row.strategy_trade_id ? "LINKED_STRATEGY" : "MANUAL",
      symbol: row.symbol,
      exchange: row.exchange,
      side: row.side,
      requestedQuantity,
      filledQuantity,
      status,
      rejectionReason: REJECTED_STATUSES.has(status) ? row.reason : null,
      expectedPrice:
        row.expected_price === null ? null : Number(row.expected_price),
      executedPrice:
        row.executed_price === null ? null : Number(row.executed_price),
      submittedAt: row.submitted_at,
      completedAt: row.completed_at,
      brokerOrderId: row.broker_order_id,
      strategyTradeId: row.strategy_trade_id,
    };
  });
  const paperRows = paperTrades.rows.map((row) => ({
    id: `PAPER-${row.id}`,
    recordId: row.id,
    source: "PAPER_ENGINE",
    broker: "PAPER_ENGINE",
    strategy: row.strategy_name || "MANUAL_PAPER",
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.side,
    requestedQuantity: Number(row.quantity),
    filledQuantity: Number(row.quantity),
    status: "FILLED",
    rejectionReason: null,
    expectedPrice: Number(row.entry_price),
    executedPrice: Number(row.entry_price),
    submittedAt: row.created_at,
    completedAt: row.created_at,
    brokerOrderId: null,
    strategyTradeId: row.id,
  }));
  const simulatorRows = simulatorOrders.rows.map((row) => ({
    id: `SIM-${row.id}`,
    recordId: row.id,
    source: "PAPER_SIMULATOR",
    broker: "PAPER_SIMULATOR",
    strategy: row.strategy_name,
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.side,
    requestedQuantity: Number(row.quantity),
    filledQuantity: Number(row.quantity),
    status: String(row.status || "FILLED").toUpperCase(),
    rejectionReason: null,
    expectedPrice: Number(row.price),
    executedPrice: Number(row.price),
    submittedAt: row.created_at,
    completedAt: row.created_at,
    brokerOrderId: null,
    strategyTradeId: null,
  }));

  return [...brokerRows, ...paperRows, ...simulatorRows].map((row) => ({
    ...row,
    fillPercent:
      row.requestedQuantity === 0
        ? 0
        : round((row.filledQuantity / row.requestedQuantity) * 100),
    latencyMs: latencyMs(row),
    slippage: slippage(row),
  }));
}

function groupBrokerStats(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const current = groups.get(row.broker) || [];
    current.push(row);
    groups.set(row.broker, current);
  });

  return Array.from(groups.entries()).map(([broker, items]) => {
    const requested = items.reduce(
      (sum, item) => sum + item.requestedQuantity,
      0
    );
    const filled = items.reduce(
      (sum, item) => sum + item.filledQuantity,
      0
    );
    const rejected = items.filter((item) =>
      REJECTED_STATUSES.has(item.status)
    ).length;
    const latencies = items
      .map((item) => item.latencyMs)
      .filter((value) => value !== null);
    return {
      broker,
      totalOrders: items.length,
      filledOrders: items.filter((item) => FILLED_STATUSES.has(item.status))
        .length,
      rejectedOrders: rejected,
      fillRatePercent: requested === 0 ? 0 : round((filled / requested) * 100),
      rejectionRatePercent:
        items.length === 0 ? 0 : round((rejected / items.length) * 100),
      averageLatencyMs:
        latencies.length === 0
          ? null
          : round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    };
  });
}

async function getSummary() {
  const rows = await loadExecutions();
  const requestedQuantity = rows.reduce(
    (sum, row) => sum + row.requestedQuantity,
    0
  );
  const filledQuantity = rows.reduce(
    (sum, row) => sum + row.filledQuantity,
    0
  );
  const latencies = rows
    .map((row) => row.latencyMs)
    .filter((value) => value !== null);
  const slippages = rows
    .map((row) => row.slippage)
    .filter((value) => value !== null);
  const rejectedRows = rows.filter((row) =>
    REJECTED_STATUSES.has(row.status)
  );

  return {
    mode: "PAPER_SAFE",
    totalOrders: rows.length,
    filledOrders: rows.filter((row) => FILLED_STATUSES.has(row.status)).length,
    partialFillOrders: rows.filter(
      (row) => row.filledQuantity > 0 && row.filledQuantity < row.requestedQuantity
    ).length,
    rejectedOrders: rejectedRows.length,
    requestedQuantity,
    filledQuantity,
    fillRatePercent:
      requestedQuantity === 0
        ? 0
        : round((filledQuantity / requestedQuantity) * 100),
    averageLatencyMs:
      latencies.length === 0
        ? null
        : round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    averageSlippage:
      slippages.length === 0
        ? null
        : round(slippages.reduce((sum, value) => sum + value, 0) / slippages.length),
    rejectionReasons: Object.entries(
      rejectedRows.reduce((counts, row) => {
        const reason = row.rejectionReason || "Unspecified rejection";
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
      }, {})
    ).map(([reason, count]) => ({ reason, count })),
    brokerWise: groupBrokerStats(rows),
    sourceCoverage: Array.from(new Set(rows.map((row) => row.source))),
  };
}

async function getSlippage() {
  return (await loadExecutions())
    .filter((row) => row.slippage !== null)
    .map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      broker: row.broker,
      expectedPrice: row.expectedPrice,
      executedPrice: row.executedPrice,
      slippage: row.slippage,
      slippagePercent:
        row.expectedPrice === 0
          ? 0
          : round((row.slippage / row.expectedPrice) * 100),
      timestamp: row.completedAt,
    }));
}

async function getLatency() {
  return (await loadExecutions())
    .filter((row) => row.latencyMs !== null)
    .map((row) => ({
      id: row.id,
      symbol: row.symbol,
      broker: row.broker,
      source: row.source,
      status: row.status,
      latencyMs: row.latencyMs,
      submittedAt: row.submittedAt,
      completedAt: row.completedAt,
    }));
}

module.exports = {
  ExecutionAnalyticsError,
  ensureSchema,
  loadExecutions,
  getSummary,
  getSlippage,
  getLatency,
};
