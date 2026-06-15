const { getHistoricalCloses } = require("./market.service");

class SignalError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "SignalError";
    this.statusCode = statusCode;
  }
}

function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    throw new SignalError(`At least ${period} prices are required for EMA`);
  }

  const seed =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);

  return values
    .slice(period)
    .reduce(
      (ema, value) => (value - ema) * multiplier + ema,
      seed
    );
}

function calculateRSI(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) {
    throw new SignalError(
      `At least ${period + 1} prices are required for RSI`
    );
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function determineSignal(ema20, ema50, rsi) {
  if (ema20 > ema50 && rsi > 55) {
    return "BUY";
  }

  if (ema20 < ema50 && rsi < 45) {
    return "SELL";
  }

  return "HOLD";
}

async function getSignal(symbol) {
  try {
    const marketData = await getHistoricalCloses(symbol);
    const ema20 = calculateEMA(marketData.closes, 20);
    const ema50 = calculateEMA(marketData.closes, 50);
    const rsi = calculateRSI(marketData.closes, 14);

    return {
      symbol: marketData.symbol.replace(/-EQ$/, ""),
      ema20: Number(ema20.toFixed(2)),
      ema50: Number(ema50.toFixed(2)),
      rsi: Number(rsi.toFixed(2)),
      signal: determineSignal(ema20, ema50, rsi),
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw new SignalError("Unable to calculate trading signal");
  }
}

module.exports = {
  calculateEMA,
  calculateRSI,
  determineSignal,
  getSignal,
};
