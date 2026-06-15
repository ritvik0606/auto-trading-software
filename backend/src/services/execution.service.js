const pool = require("../config/db");

const FILLED_STATUSES = ["FILLED", "COMPLETE", "COMPLETED", "EXECUTED"];
const REJECTED_STATUSES = ["BLOCKED", "REJECTED", "FAILED", "CANCELLED"];

class ExecutionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ExecutionError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function getExecutionTimeMs(row) {
  const start = row.submitted_at || row.created_at;
  const end = row.executed_at || row.rejected_at;

  if (!start || !end) {
    return null;
  }

  return Math.max(new Date(end).getTime() - new Date(start).getTime(), 0);
}

function getExpectedPrice(row) {
  const value = row.expected_price ?? row.price;
  return value === null ? null : Number(value);
}

function getExecutedPrice(row) {
  return row.executed_price === null
    ? null
    : Number(row.executed_price);
}

function mapOrderAnalytics(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    status: row.status,
    entryTime: row.submitted_at || row.created_at,
    exitTime: row.executed_at || row.rejected_at || null,
    executionTimeMs: getExecutionTimeMs(row),
  };
}

async function loadOrders() {
  const result = await pool.query(
    `SELECT
       id,
       symbol,
       side,
       quantity,
       price,
       status,
       mode,
       expected_price,
       executed_price,
       submitted_at,
       executed_at,
       rejected_at,
       created_at
     FROM orders
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows;
}

function calculateSummary(rows) {
  const totalOrders = rows.length;
  const filledRows = rows.filter((row) =>
    FILLED_STATUSES.includes(row.status)
  );
  const rejectedRows = rows.filter((row) =>
    REJECTED_STATUSES.includes(row.status)
  );
  const timedRows = rows
    .map(getExecutionTimeMs)
    .filter((value) => value !== null);
  const averageExecutionTimeMs =
    timedRows.length === 0
      ? null
      : round(
          timedRows.reduce((sum, value) => sum + value, 0) /
            timedRows.length
        );

  return {
    totalOrders,
    filledOrders: filledRows.length,
    rejectedOrders: rejectedRows.length,
    averageExecutionTimeMs,
    successRatePercent:
      totalOrders === 0
        ? 0
        : round((filledRows.length / totalOrders) * 100),
  };
}

async function getExecutionSummary() {
  return calculateSummary(await loadOrders());
}

async function getExecutionOrders() {
  return (await loadOrders()).map(mapOrderAnalytics);
}

async function getSlippageAnalytics() {
  const rows = await loadOrders();

  return rows
    .filter(
      (row) =>
        getExpectedPrice(row) !== null &&
        getExecutedPrice(row) !== null
    )
    .map((row) => {
      const expectedPrice = getExpectedPrice(row);
      const executedPrice = getExecutedPrice(row);
      const direction = row.side === "SELL" ? -1 : 1;
      const slippage =
        (executedPrice - expectedPrice) * direction;

      return {
        orderId: row.id,
        symbol: row.symbol,
        expectedPrice,
        executedPrice,
        slippage: round(slippage),
        slippagePercent:
          expectedPrice === 0
            ? 0
            : round((slippage / expectedPrice) * 100),
      };
    });
}

async function getBrokerPerformance() {
  const rows = await loadOrders();
  const summary = calculateSummary(rows);

  return {
    brokerName: "Angel One",
    totalOrders: summary.totalOrders,
    successPercent: summary.successRatePercent,
    rejectionPercent:
      summary.totalOrders === 0
        ? 0
        : round(
            (summary.rejectedOrders / summary.totalOrders) * 100
          ),
    averageExecutionTimeMs: summary.averageExecutionTimeMs,
  };
}

module.exports = {
  ExecutionError,
  getExecutionSummary,
  getExecutionOrders,
  getSlippageAnalytics,
  getBrokerPerformance,
};
