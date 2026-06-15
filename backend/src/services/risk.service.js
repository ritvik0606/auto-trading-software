const pool = require("../config/db");

const DEFAULT_SETTINGS = {
  maxDailyLoss: 2000,
  maxTradesPerDay: 5,
  riskPerTradePercent: 1,
};

class RiskError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "RiskError";
    this.statusCode = statusCode;
  }
}

function parsePositiveNumber(value, fieldName, options = {}) {
  const number = Number(value);
  const { allowZero = false, max } = options;
  const minimumValid = allowZero ? number >= 0 : number > 0;

  if (!Number.isFinite(number) || !minimumValid) {
    throw new RiskError(`${fieldName} must be a positive number`, 400);
  }

  if (max !== undefined && number > max) {
    throw new RiskError(`${fieldName} must not exceed ${max}`, 400);
  }

  return number;
}

function mapSettings(row) {
  return {
    id: row.id,
    maxDailyLoss: Number(row.max_daily_loss),
    maxTradesPerDay: row.max_trades_per_day,
    riskPerTradePercent: Number(row.risk_per_trade_percent),
    createdAt: row.created_at,
  };
}

async function getRiskSettings() {
  const result = await pool.query(
    `SELECT id, max_daily_loss, max_trades_per_day,
            risk_per_trade_percent, created_at
     FROM risk_settings
     WHERE user_id IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return { ...DEFAULT_SETTINGS };
  }

  return mapSettings(result.rows[0]);
}

async function saveRiskSettings(input) {
  const maxDailyLoss = parsePositiveNumber(
    input.maxDailyLoss,
    "maxDailyLoss",
    { allowZero: true }
  );
  const maxTradesPerDay = parsePositiveNumber(
    input.maxTradesPerDay,
    "maxTradesPerDay"
  );
  const riskPerTradePercent = parsePositiveNumber(
    input.riskPerTradePercent,
    "riskPerTradePercent",
    { max: 100 }
  );

  if (!Number.isInteger(maxTradesPerDay)) {
    throw new RiskError("maxTradesPerDay must be an integer", 400);
  }

  const result = await pool.query(
    `INSERT INTO risk_settings (
       max_daily_loss,
       max_trades_per_day,
       risk_per_trade_percent
     )
     VALUES ($1, $2, $3)
     RETURNING id, max_daily_loss, max_trades_per_day,
               risk_per_trade_percent, created_at`,
    [maxDailyLoss, maxTradesPerDay, riskPerTradePercent]
  );

  return mapSettings(result.rows[0]);
}

function calculatePositionSize(input, settings) {
  const capital = parsePositiveNumber(input.capital, "capital");
  const entryPrice = parsePositiveNumber(input.entryPrice, "entryPrice");
  const stopLossPrice = parsePositiveNumber(
    input.stopLossPrice,
    "stopLossPrice"
  );
  const priceRisk = Math.abs(entryPrice - stopLossPrice);

  if (priceRisk === 0) {
    throw new RiskError(
      "entryPrice and stopLossPrice must be different",
      400
    );
  }

  const riskAmount = capital * (settings.riskPerTradePercent / 100);
  const positionSize = Math.floor(riskAmount / priceRisk);

  if (positionSize < 1) {
    throw new RiskError(
      "Calculated position size is below one unit",
      400
    );
  }

  return {
    riskAmount: Number(riskAmount.toFixed(2)),
    positionSize,
  };
}

function validateDailyLoss(dailyLoss, maxDailyLoss) {
  const loss = parsePositiveNumber(dailyLoss, "dailyLoss", {
    allowZero: true,
  });
  const limit = parsePositiveNumber(maxDailyLoss, "maxDailyLoss", {
    allowZero: true,
  });

  return {
    allowed: loss < limit,
    dailyLoss: loss,
    maxDailyLoss: limit,
    remainingLossLimit: Math.max(Number((limit - loss).toFixed(2)), 0),
  };
}

function validateMaxTrades(tradesToday, maxTradesPerDay) {
  const tradeCount = Number(tradesToday);
  const limit = Number(maxTradesPerDay);

  if (
    !Number.isInteger(tradeCount) ||
    tradeCount < 0 ||
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new RiskError(
      "Trade counts must be valid non-negative integers",
      400
    );
  }

  return {
    allowed: tradeCount < limit,
    tradesToday: tradeCount,
    maxTradesPerDay: limit,
    remainingTrades: Math.max(limit - tradeCount, 0),
  };
}

module.exports = {
  RiskError,
  getRiskSettings,
  saveRiskSettings,
  calculatePositionSize,
  validateDailyLoss,
  validateMaxTrades,
};
