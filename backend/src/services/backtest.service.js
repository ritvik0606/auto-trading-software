const { getHistoricalCloses } = require("./market.service");
const {
  calculateEMA,
  calculateRSI,
  determineSignal,
} = require("./signal.service");

const SUPPORTED_STRATEGY = "EMA_RSI";
const WARMUP_CANDLES = 50;

class BacktestError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "BacktestError";
    this.statusCode = statusCode;
  }
}

function validateInput(input) {
  const symbol =
    typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  const strategy =
    typeof input.strategy === "string"
      ? input.strategy.trim().toUpperCase()
      : "";
  const days = Number(input.days);

  if (!symbol || symbol.length > 50 || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new BacktestError("Symbol is invalid", 400);
  }

  if (strategy !== SUPPORTED_STRATEGY) {
    throw new BacktestError(
      `Strategy must be ${SUPPORTED_STRATEGY}`,
      400
    );
  }

  if (!Number.isInteger(days) || days < 51 || days > 950) {
    throw new BacktestError(
      "Days must be an integer between 51 and 950",
      400
    );
  }

  return { symbol, strategy, days };
}

function closePosition(position, exitPrice) {
  const direction = position.side === "BUY" ? 1 : -1;
  return Number(
    ((exitPrice - position.entryPrice) * direction).toFixed(2)
  );
}

function calculateMaxDrawdown(tradePnls) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const pnl of tradePnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return Number(maxDrawdown.toFixed(2));
}

function runEmaRsiBacktest(closes) {
  if (!Array.isArray(closes) || closes.length < WARMUP_CANDLES + 1) {
    throw new BacktestError(
      "At least 51 closing prices are required for backtesting",
      400
    );
  }

  const tradePnls = [];
  let position = null;

  for (let index = WARMUP_CANDLES - 1; index < closes.length; index += 1) {
    const prices = closes.slice(0, index + 1);
    const price = closes[index];
    const signal = determineSignal(
      calculateEMA(prices, 20),
      calculateEMA(prices, 50),
      calculateRSI(prices, 14)
    );

    if (signal === "HOLD") {
      continue;
    }

    if (!position) {
      position = { side: signal, entryPrice: price };
      continue;
    }

    if (position.side !== signal) {
      tradePnls.push(closePosition(position, price));
      position = { side: signal, entryPrice: price };
    }
  }

  if (position) {
    tradePnls.push(closePosition(position, closes[closes.length - 1]));
  }

  const totalTrades = tradePnls.length;
  const winningTrades = tradePnls.filter((pnl) => pnl > 0).length;
  const losingTrades = tradePnls.filter((pnl) => pnl < 0).length;
  const totalPnl = tradePnls.reduce((sum, pnl) => sum + pnl, 0);

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate:
      totalTrades === 0
        ? 0
        : Number(((winningTrades / totalTrades) * 100).toFixed(2)),
    totalPnL: Number(totalPnl.toFixed(2)),
    maxDrawdown: calculateMaxDrawdown(tradePnls),
  };
}

async function runBacktest(input) {
  const { symbol, days } = validateInput(input);

  try {
    const history = await getHistoricalCloses(
      symbol,
      days + WARMUP_CANDLES
    );
    return runEmaRsiBacktest(history.closes);
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw new BacktestError("Unable to run backtest");
  }
}

module.exports = {
  BacktestError,
  calculateMaxDrawdown,
  runEmaRsiBacktest,
  runBacktest,
};
