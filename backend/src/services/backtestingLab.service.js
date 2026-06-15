const pool = require("../config/db");

const SUPPORTED_STRATEGIES = new Set(["EMA_RSI"]);
const SUPPORTED_TIMEFRAMES = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "1d",
]);

class BacktestingLabError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "BacktestingLabError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function parseRunId(id, fieldName = "Backtest ID") {
  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new BacktestingLabError(
      `${fieldName} must be a positive integer`,
      400
    );
  }

  return numericId;
}

function parseDate(value, fieldName) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new BacktestingLabError(
      `${fieldName} must use YYYY-MM-DD format`,
      400
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BacktestingLabError(`${fieldName} is invalid`, 400);
  }

  return value;
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
  const startDate = parseDate(input.startDate, "startDate");
  const endDate = parseDate(input.endDate, "endDate");

  if (!SUPPORTED_STRATEGIES.has(strategyName)) {
    throw new BacktestingLabError(
      `strategyName must be one of: ${Array.from(
        SUPPORTED_STRATEGIES
      ).join(", ")}`,
      400
    );
  }

  if (!symbol || symbol.length > 50 || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new BacktestingLabError("Symbol is invalid", 400);
  }

  if (!SUPPORTED_TIMEFRAMES.has(timeframe)) {
    throw new BacktestingLabError(
      `timeframe must be one of: ${Array.from(
        SUPPORTED_TIMEFRAMES
      ).join(", ")}`,
      400
    );
  }

  if (startDate > endDate) {
    throw new BacktestingLabError(
      "startDate must be on or before endDate",
      400
    );
  }

  return { strategyName, symbol, timeframe, startDate, endDate };
}

function calculateMaxDrawdown(pnls) {
  let equity = 0;
  let peak = 0;
  let maximum = 0;

  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }

  return round(maximum);
}

function calculateSharpeRatio(trades) {
  if (trades.length < 2) {
    return null;
  }

  const returns = trades.map((trade) => {
    const capital = trade.entryPrice * trade.quantity;
    return capital === 0 ? 0 : trade.pnl / capital;
  });
  const mean =
    returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0
    ) /
    (returns.length - 1);
  const deviation = Math.sqrt(variance);

  if (deviation === 0) {
    return null;
  }

  return round((mean / deviation) * Math.sqrt(returns.length));
}

function calculateMetrics(trades) {
  const pnls = trades.map((trade) => trade.pnl);
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, pnl) => sum + pnl, 0)
  );
  const netProfit = pnls.reduce((sum, pnl) => sum + pnl, 0);

  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate:
      trades.length === 0
        ? 0
        : round((wins.length / trades.length) * 100),
    netProfit: round(netProfit),
    profitFactor:
      grossLoss === 0 ? null : round(grossProfit / grossLoss),
    maxDrawdown: calculateMaxDrawdown(pnls),
    sharpeRatio: calculateSharpeRatio(trades),
  };
}

function mapRun(row) {
  return {
    id: row.id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    timeframe: row.timeframe,
    startDate: row.start_date,
    endDate: row.end_date,
    totalTrades: row.total_trades,
    winningTrades: row.winning_trades,
    losingTrades: row.losing_trades,
    winRate: Number(row.win_rate),
    netProfit: Number(row.net_profit),
    profitFactor:
      row.profit_factor === null ? null : Number(row.profit_factor),
    maxDrawdown: Number(row.max_drawdown),
    sharpeRatio:
      row.sharpe_ratio === null ? null : Number(row.sharpe_ratio),
    createdAt: row.created_at,
  };
}

function mapTrade(row) {
  return {
    sequence: row.trade_sequence,
    sourcePaperTradeId: row.source_paper_trade_id,
    symbol: row.symbol,
    side: row.side,
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    quantity: row.quantity,
    pnl: Number(row.pnl),
    entryTime: row.entry_time,
    exitTime: row.exit_time,
  };
}

async function loadHistoricalTrades(input) {
  const result = await pool.query(
    `SELECT
       id,
       symbol,
       trade_type,
       entry_price,
       exit_price,
       quantity,
       pnl,
       created_at,
       COALESCE(closed_at, created_at) AS exit_time
     FROM paper_trades
     WHERE status = 'CLOSED'
       AND UPPER(symbol) = UPPER($1)
       AND COALESCE(closed_at, created_at)::date BETWEEN $2 AND $3
     ORDER BY COALESCE(closed_at, created_at), id`,
    [input.symbol, input.startDate, input.endDate]
  );

  return result.rows.map((row, index) => ({
    sequence: index + 1,
    sourcePaperTradeId: row.id,
    symbol: row.symbol,
    side: row.trade_type,
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    quantity: row.quantity,
    pnl: Number(row.pnl),
    entryTime: row.created_at,
    exitTime: row.exit_time,
  }));
}

async function createBacktest(input) {
  const normalized = normalizeInput(input);
  const trades = await loadHistoricalTrades(normalized);

  if (trades.length === 0) {
    throw new BacktestingLabError(
      `No completed paper trades found for ${normalized.symbol} ` +
        `between ${normalized.startDate} and ${normalized.endDate}`,
      400
    );
  }

  const metrics = calculateMetrics(trades);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const runResult = await client.query(
      `INSERT INTO backtest_runs (
         strategy_name,
         symbol,
         timeframe,
         start_date,
         end_date,
         total_trades,
         winning_trades,
         losing_trades,
         win_rate,
         net_profit,
         profit_factor,
         max_drawdown,
         sharpe_ratio
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13
       )
       RETURNING *`,
      [
        normalized.strategyName,
        normalized.symbol,
        normalized.timeframe,
        normalized.startDate,
        normalized.endDate,
        metrics.totalTrades,
        metrics.winningTrades,
        metrics.losingTrades,
        metrics.winRate,
        metrics.netProfit,
        metrics.profitFactor,
        metrics.maxDrawdown,
        metrics.sharpeRatio,
      ]
    );
    const run = runResult.rows[0];

    for (const trade of trades) {
      await client.query(
        `INSERT INTO backtest_run_trades (
           backtest_run_id,
           trade_sequence,
           source_paper_trade_id,
           symbol,
           side,
           entry_price,
           exit_price,
           quantity,
           pnl,
           entry_time,
           exit_time
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11
         )`,
        [
          run.id,
          trade.sequence,
          trade.sourcePaperTradeId,
          trade.symbol,
          trade.side,
          trade.entryPrice,
          trade.exitPrice,
          trade.quantity,
          trade.pnl,
          trade.entryTime,
          trade.exitTime,
        ]
      );
    }

    await client.query("COMMIT");
    return {
      ...mapRun(run),
      dataSource: "COMPLETED_PAPER_TRADES",
      note:
        "The timeframe is report metadata because historical paper " +
        "trades do not store candle-level timeframe data.",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getRunRow(id) {
  const result = await pool.query(
    `SELECT *
     FROM backtest_runs
     WHERE id = $1`,
    [parseRunId(id)]
  );

  if (result.rows.length === 0) {
    throw new BacktestingLabError("Backtest run not found", 404);
  }

  return result.rows[0];
}

async function getBacktestSummary(id) {
  return mapRun(await getRunRow(id));
}

async function getBacktestTrades(id) {
  await getRunRow(id);
  const result = await pool.query(
    `SELECT *
     FROM backtest_run_trades
     WHERE backtest_run_id = $1
     ORDER BY trade_sequence`,
    [parseRunId(id)]
  );

  return result.rows.map(mapTrade);
}

async function getEquityCurve(id) {
  const trades = await getBacktestTrades(id);
  let cumulativePnL = 0;

  return trades.map((trade) => {
    cumulativePnL += trade.pnl;
    return {
      sequence: trade.sequence,
      timestamp: trade.exitTime,
      pnl: trade.pnl,
      cumulativePnL: round(cumulativePnL),
    };
  });
}

async function getDrawdownReport(id) {
  const equity = await getEquityCurve(id);
  let peak = 0;
  let maximum = 0;
  const data = equity.map((point) => {
    peak = Math.max(peak, point.cumulativePnL);
    const drawdown = Math.max(peak - point.cumulativePnL, 0);
    maximum = Math.max(maximum, drawdown);

    return {
      sequence: point.sequence,
      timestamp: point.timestamp,
      cumulativePnL: point.cumulativePnL,
      peakPnL: round(peak),
      drawdown: round(drawdown),
    };
  });

  return {
    maxDrawdown: round(maximum),
    data,
  };
}

async function compareBacktests(id1, id2) {
  const firstId = parseRunId(id1, "id1");
  const secondId = parseRunId(id2, "id2");
  const [first, second] = await Promise.all([
    getBacktestSummary(firstId),
    getBacktestSummary(secondId),
  ]);

  const metrics = [
    "winRate",
    "netProfit",
    "profitFactor",
    "maxDrawdown",
    "sharpeRatio",
  ];

  return {
    first,
    second,
    comparison: Object.fromEntries(
      metrics.map((metric) => {
        const firstValue = first[metric];
        const secondValue = second[metric];
        const lowerIsBetter = metric === "maxDrawdown";
        let betterRunId = null;

        if (
          firstValue !== null &&
          secondValue !== null &&
          firstValue !== secondValue
        ) {
          const firstIsBetter = lowerIsBetter
            ? firstValue < secondValue
            : firstValue > secondValue;
          betterRunId = firstIsBetter ? first.id : second.id;
        }

        return [
          metric,
          {
            first: firstValue,
            second: secondValue,
            betterRunId,
          },
        ];
      })
    ),
  };
}

async function getBacktestHistory() {
  const result = await pool.query(
    `SELECT *
     FROM backtest_runs
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapRun);
}

module.exports = {
  BacktestingLabError,
  calculateMaxDrawdown,
  calculateSharpeRatio,
  calculateMetrics,
  createBacktest,
  getBacktestSummary,
  getBacktestTrades,
  getEquityCurve,
  getDrawdownReport,
  compareBacktests,
  getBacktestHistory,
};
