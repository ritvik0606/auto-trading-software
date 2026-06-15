const pool = require("../config/db");

class PortfolioAnalyticsError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "PortfolioAnalyticsError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function divide(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator);
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
  const { ensureSchema } = require("./paperSimulator.service");
  await ensureSchema();
  const result = await pool.query(
    `SELECT *
     FROM (
       SELECT
         CONCAT('PAPER-', paper_trades.id) AS id,
         paper_trades.symbol,
         paper_trades.exchange,
         paper_trades.trade_type,
         paper_trades.entry_price,
         paper_trades.exit_price,
         paper_trades.quantity,
         paper_trades.pnl,
         paper_trades.created_at,
         COALESCE(
           paper_trades.closed_at,
           paper_trades.created_at
         ) AS closed_at,
         COALESCE(
           multi_strategies.strategy_name,
           'MANUAL_PAPER'
         ) AS strategy_name,
         'PAPER_ENGINE' AS broker
       FROM paper_trades
       LEFT JOIN multi_strategies
         ON multi_strategies.id = paper_trades.multi_strategy_id
       WHERE paper_trades.status = 'CLOSED'

       UNION ALL

       SELECT
         CONCAT('SIM-', id) AS id,
         symbol,
         exchange,
         side AS trade_type,
         average_price AS entry_price,
         current_price AS exit_price,
         quantity,
         realized_pnl AS pnl,
         created_at,
         closed_at,
         strategy_name,
         'PAPER_SIMULATOR' AS broker
       FROM paper_simulator_positions
       WHERE status = 'CLOSED'
     ) trades
     ORDER BY closed_at, id`
  );

  return result.rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.trade_type,
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    quantity: Number(row.quantity),
    pnl: Number(row.pnl),
    openedAt: row.created_at,
    closedAt: row.closed_at,
    strategyName: row.strategy_name,
    broker: row.broker,
  }));
}

function calculateMetrics(trades) {
  const winners = trades.filter((trade) => trade.pnl > 0);
  const losers = trades.filter((trade) => trade.pnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(
    losers.reduce((sum, trade) => sum + trade.pnl, 0)
  );

  return {
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate:
      trades.length === 0 ? 0 : round((winners.length / trades.length) * 100),
    totalPnL: round(grossProfit - grossLoss),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: divide(grossProfit, grossLoss),
    averageWinner:
      winners.length === 0 ? 0 : round(grossProfit / winners.length),
    averageLoser:
      losers.length === 0 ? 0 : round(-grossLoss / losers.length),
  };
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

function getPeriodKey(value, period) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (period === "daily") {
    return date.toISOString().slice(0, 10);
  }

  if (period === "monthly") {
    return date.toISOString().slice(0, 7);
  }

  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function aggregateByPeriod(trades, period) {
  const groups = new Map();

  trades.forEach((trade) => {
    const key = getPeriodKey(trade.closedAt, period);
    if (!key) return;
    const current = groups.get(key) || [];
    current.push(trade);
    groups.set(key, current);
  });

  return Array.from(groups.entries()).map(([periodStart, periodTrades]) => ({
    periodStart,
    ...calculateMetrics(periodTrades),
  }));
}

function getCurrentPeriodPnL(series, period) {
  const currentKey = getPeriodKey(new Date(), period);
  const currentPeriod = series.find(
    (item) => item.periodStart === currentKey
  );

  return currentPeriod ? currentPeriod.totalPnL : 0;
}

function groupPerformance(trades, key) {
  const groups = new Map();

  trades.forEach((trade) => {
    const label = trade[key] || "UNATTRIBUTED";
    const current = groups.get(label) || [];
    current.push(trade);
    groups.set(label, current);
  });

  return Array.from(groups.entries())
    .map(([name, groupTrades]) => ({
      name,
      ...calculateMetrics(groupTrades),
    }))
    .sort((first, second) => second.totalPnL - first.totalPnL);
}

function calculateSharpeRatio(dailyPerformance, startingCapital) {
  if (dailyPerformance.length < 2 || startingCapital <= 0) {
    return null;
  }

  const returns = dailyPerformance.map(
    (period) => period.totalPnL / startingCapital
  );
  const average =
    returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (returns.length - 1);
  const deviation = Math.sqrt(variance);

  return deviation === 0 ? null : round((average / deviation) * Math.sqrt(252));
}

function mapTrade(trade) {
  if (!trade) return null;

  return {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    entryPrice: round(trade.entryPrice),
    exitPrice: round(trade.exitPrice),
    pnl: round(trade.pnl),
    strategyName: trade.strategyName,
    closedAt: trade.closedAt,
  };
}

async function getAnalyticsContext() {
  const [trades, startingCapital] = await Promise.all([
    getClosedTrades(),
    getStartingCapital(),
  ]);
  const metrics = calculateMetrics(trades);
  const equityCurve = buildEquityCurve(trades, startingCapital);
  const drawdown = calculateDrawdown(equityCurve, startingCapital);
  const daily = aggregateByPeriod(trades, "daily");
  const weekly = aggregateByPeriod(trades, "weekly");
  const monthly = aggregateByPeriod(trades, "monthly");

  return {
    trades,
    startingCapital,
    metrics,
    equityCurve,
    drawdown,
    daily,
    weekly,
    monthly,
  };
}

async function getSummary() {
  const context = await getAnalyticsContext();
  const bestTrade = context.trades.reduce(
    (best, trade) => (!best || trade.pnl > best.pnl ? trade : best),
    null
  );
  const worstTrade = context.trades.reduce(
    (worst, trade) => (!worst || trade.pnl < worst.pnl ? trade : worst),
    null
  );

  return {
    ...context.metrics,
    dailyPnL: getCurrentPeriodPnL(context.daily, "daily"),
    weeklyPnL: getCurrentPeriodPnL(context.weekly, "weekly"),
    monthlyPnL: getCurrentPeriodPnL(context.monthly, "monthly"),
    maxDrawdown: context.drawdown.maxDrawdown,
    maxDrawdownPercent: context.drawdown.maxDrawdownPercent,
    sharpeRatio: calculateSharpeRatio(context.daily, context.startingCapital),
    riskAdjustedReturn:
      context.drawdown.maxDrawdown === 0
        ? null
        : round(context.metrics.totalPnL / context.drawdown.maxDrawdown),
    bestTrade: mapTrade(bestTrade),
    worstTrade: mapTrade(worstTrade),
    brokerAttribution: "EXECUTION_SOURCE",
  };
}

async function getPerformance() {
  const context = await getAnalyticsContext();

  return {
    brokerWise: groupPerformance(context.trades, "broker"),
    strategyWise: groupPerformance(context.trades, "strategyName"),
    symbolWise: groupPerformance(context.trades, "symbol"),
    daily: context.daily,
    weekly: context.weekly,
    monthly: context.monthly,
  };
}

async function getDrawdown() {
  const context = await getAnalyticsContext();
  return context.drawdown;
}

async function getEquityCurve() {
  const context = await getAnalyticsContext();

  return {
    startingCapital: round(context.startingCapital),
    endingEquity: round(
      context.startingCapital + context.metrics.totalPnL
    ),
    totalReturnPercent:
      context.startingCapital === 0
        ? 0
        : round(
            (context.metrics.totalPnL / context.startingCapital) * 100
          ),
    data: context.equityCurve,
  };
}

module.exports = {
  PortfolioAnalyticsError,
  getSummary,
  getPerformance,
  getDrawdown,
  getEquityCurve,
};
