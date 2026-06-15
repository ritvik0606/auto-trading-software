const pool = require("../config/db");

class PerformanceError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "PerformanceError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

async function getStartingCapital() {
  const result = await pool.query(
    `SELECT COALESCE(
       (
         SELECT capital
         FROM risk_settings
         WHERE user_id IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ),
       100000
     ) AS capital`
  );

  return Number(result.rows[0].capital);
}

async function getClosedTrades() {
  const result = await pool.query(
    `SELECT
       id,
       symbol,
       trade_type,
       pnl,
       COALESCE(closed_at, created_at) AS closed_at
     FROM paper_trades
     WHERE status = 'CLOSED'
     ORDER BY COALESCE(closed_at, created_at), id`
  );

  return result.rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    side: row.trade_type,
    pnl: Number(row.pnl),
    closedAt: row.closed_at,
  }));
}

function buildEquityCurve(trades, startingCapital) {
  let cumulativePnL = 0;

  return trades.map((trade) => {
    cumulativePnL += trade.pnl;

    return {
      tradeId: trade.id,
      timestamp: trade.closedAt,
      symbol: trade.symbol,
      pnl: round(trade.pnl),
      cumulativePnL: round(cumulativePnL),
      equity: round(startingCapital + cumulativePnL),
    };
  });
}

function calculateDrawdown(curve, startingCapital) {
  let peakEquity = startingCapital;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let currentDrawdown = 0;
  const data = curve.map((point) => {
    peakEquity = Math.max(peakEquity, point.equity);
    currentDrawdown = Math.max(peakEquity - point.equity, 0);
    const drawdownPercent =
      peakEquity === 0 ? 0 : (currentDrawdown / peakEquity) * 100;

    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
      maxDrawdownPercent = drawdownPercent;
    }

    return {
      timestamp: point.timestamp,
      equity: point.equity,
      peakEquity: round(peakEquity),
      drawdown: round(currentDrawdown),
      drawdownPercent: round(drawdownPercent),
    };
  });

  return {
    maxDrawdown: round(maxDrawdown),
    maxDrawdownPercent: round(maxDrawdownPercent),
    currentDrawdown: round(currentDrawdown),
    data,
  };
}

async function getPerformanceSummary() {
  const [trades, startingCapital] = await Promise.all([
    getClosedTrades(),
    getStartingCapital(),
  ]);
  const winningTrades = trades.filter((trade) => trade.pnl > 0);
  const losingTrades = trades.filter((trade) => trade.pnl < 0);
  const grossProfit = winningTrades.reduce(
    (sum, trade) => sum + trade.pnl,
    0
  );
  const grossLoss = Math.abs(
    losingTrades.reduce((sum, trade) => sum + trade.pnl, 0)
  );
  const curve = buildEquityCurve(trades, startingCapital);
  const drawdown = calculateDrawdown(curve, startingCapital);

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    totalPnL: round(grossProfit - grossLoss),
    winRate:
      trades.length === 0
        ? 0
        : round((winningTrades.length / trades.length) * 100),
    averageProfit:
      winningTrades.length === 0
        ? 0
        : round(grossProfit / winningTrades.length),
    averageLoss:
      losingTrades.length === 0
        ? 0
        : round(-grossLoss / losingTrades.length),
    profitFactor:
      grossLoss === 0 ? null : round(grossProfit / grossLoss),
    maxDrawdown: drawdown.maxDrawdown,
    maxDrawdownPercent: drawdown.maxDrawdownPercent,
  };
}

async function getAggregatedPerformance(period) {
  const periods = {
    daily: {
      expression: "DATE(COALESCE(closed_at, created_at))",
      label: "date",
    },
    weekly: {
      expression:
        "DATE_TRUNC('week', COALESCE(closed_at, created_at))::date",
      label: "weekStarting",
    },
    monthly: {
      expression:
        "DATE_TRUNC('month', COALESCE(closed_at, created_at))::date",
      label: "monthStarting",
    },
  };
  const config = periods[period];

  if (!config) {
    throw new PerformanceError("Unsupported performance period", 400);
  }

  const result = await pool.query(
    `SELECT
       ${config.expression} AS period_start,
       COUNT(*) AS total_trades,
       COUNT(*) FILTER (WHERE pnl > 0) AS winning_trades,
       COUNT(*) FILTER (WHERE pnl < 0) AS losing_trades,
       COALESCE(SUM(pnl), 0) AS pnl
     FROM paper_trades
     WHERE status = 'CLOSED'
     GROUP BY period_start
     ORDER BY period_start`
  );

  return result.rows.map((row) => ({
    [config.label]: row.period_start,
    totalTrades: Number(row.total_trades),
    winningTrades: Number(row.winning_trades),
    losingTrades: Number(row.losing_trades),
    pnl: round(row.pnl),
  }));
}

async function getEquityCurve() {
  const [trades, startingCapital] = await Promise.all([
    getClosedTrades(),
    getStartingCapital(),
  ]);

  return {
    startingCapital,
    endingEquity: round(
      startingCapital +
        trades.reduce((sum, trade) => sum + trade.pnl, 0)
    ),
    data: buildEquityCurve(trades, startingCapital),
  };
}

async function getDrawdown() {
  const [trades, startingCapital] = await Promise.all([
    getClosedTrades(),
    getStartingCapital(),
  ]);
  const curve = buildEquityCurve(trades, startingCapital);

  return calculateDrawdown(curve, startingCapital);
}

module.exports = {
  PerformanceError,
  getPerformanceSummary,
  getAggregatedPerformance,
  getEquityCurve,
  getDrawdown,
};
