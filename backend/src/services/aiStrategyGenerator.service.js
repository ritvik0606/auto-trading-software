const pool = require("../config/db");

const MARKETS = new Set(["NIFTY", "BANKNIFTY", "ALL"]);
const STYLES = new Set(["INTRADAY", "SWING", "POSITIONAL"]);
const RISKS = new Set(["LOW", "MEDIUM", "HIGH"]);

const STRATEGY_TEMPLATES = [
  {
    code: "EMA_RSI",
    indicators: ["EMA", "RSI"],
    entryRules: [
      "Fast EMA crosses above slow EMA",
      "RSI confirms directional momentum",
    ],
    exitRules: [
      "Opposite EMA crossover",
      "RSI momentum reversal",
      "Stop loss or target reached",
    ],
  },
  {
    code: "MACD_VWAP",
    indicators: ["MACD", "VWAP"],
    entryRules: [
      "MACD line crosses signal line",
      "Price confirms direction relative to VWAP",
    ],
    exitRules: [
      "Opposite MACD crossover",
      "Price crosses VWAP against the position",
      "Stop loss or target reached",
    ],
  },
  {
    code: "SUPERTREND_RSI",
    indicators: ["SuperTrend", "RSI"],
    entryRules: [
      "SuperTrend changes direction",
      "RSI confirms momentum",
    ],
    exitRules: [
      "SuperTrend reverses",
      "RSI reaches an adverse threshold",
      "Stop loss or target reached",
    ],
  },
  {
    code: "BOLLINGER_RSI",
    indicators: ["Bollinger Bands", "RSI"],
    entryRules: [
      "Price reacts at a Bollinger Band",
      "RSI confirms mean reversion",
    ],
    exitRules: [
      "Price reaches the middle or opposite band",
      "RSI momentum invalidates the setup",
      "Stop loss or target reached",
    ],
  },
  {
    code: "EMA_MACD_VWAP",
    indicators: ["EMA", "MACD", "VWAP"],
    entryRules: [
      "EMA trend direction is established",
      "MACD confirms momentum",
      "Price confirms direction relative to VWAP",
    ],
    exitRules: [
      "EMA or MACD reverses",
      "Price crosses VWAP against the position",
      "Stop loss or target reached",
    ],
  },
  {
    code: "SUPERTREND_BOLLINGER",
    indicators: ["SuperTrend", "Bollinger Bands"],
    entryRules: [
      "SuperTrend defines the trade direction",
      "Bollinger Bands confirm volatility expansion",
    ],
    exitRules: [
      "SuperTrend reverses",
      "Volatility contracts or target is reached",
      "Stop loss reached",
    ],
  },
];

const RISK_RULES = {
  LOW: {
    riskPerTradePercent: 0.5,
    minimumRiskReward: 2,
    maxConcurrentPositions: 1,
  },
  MEDIUM: {
    riskPerTradePercent: 1,
    minimumRiskReward: 1.5,
    maxConcurrentPositions: 2,
  },
  HIGH: {
    riskPerTradePercent: 2,
    minimumRiskReward: 1.2,
    maxConcurrentPositions: 3,
  },
};

class AIStrategyGeneratorError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AIStrategyGeneratorError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function normalizeInput(input = {}) {
  const market =
    typeof input.market === "string"
      ? input.market.trim().toUpperCase()
      : "";
  const style =
    typeof input.style === "string"
      ? input.style.trim().toUpperCase()
      : "";
  const risk =
    typeof input.risk === "string"
      ? input.risk.trim().toUpperCase()
      : "";

  if (!MARKETS.has(market)) {
    throw new AIStrategyGeneratorError(
      `market must be one of: ${Array.from(MARKETS).join(", ")}`,
      400
    );
  }

  if (!STYLES.has(style)) {
    throw new AIStrategyGeneratorError(
      `style must be one of: ${Array.from(STYLES).join(", ")}`,
      400
    );
  }

  if (!RISKS.has(risk)) {
    throw new AIStrategyGeneratorError(
      `risk must be one of: ${Array.from(RISKS).join(", ")}`,
      400
    );
  }

  return { market, style, risk };
}

async function loadHistoricalPnls() {
  const result = await pool.query(
    `SELECT pnl
     FROM paper_trades
     WHERE status = 'CLOSED'
     ORDER BY COALESCE(closed_at, created_at), id`
  );

  const pnls = result.rows.map((row) => Number(row.pnl));
  if (pnls.length === 0) {
    throw new AIStrategyGeneratorError(
      "No completed paper trades are available for strategy scoring",
      400
    );
  }

  return pnls;
}

function calculateMetrics(pnls) {
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, pnl) => sum + pnl, 0)
  );
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const averageProfit =
    wins.length === 0 ? 0 : grossProfit / wins.length;
  const averageLoss =
    losses.length === 0 ? 0 : grossLoss / losses.length;

  return {
    tradesAnalyzed: pnls.length,
    winRate: round((wins.length / pnls.length) * 100),
    profitFactor:
      grossLoss === 0 ? null : round(grossProfit / grossLoss),
    maxDrawdown: round(maxDrawdown),
    riskReward:
      averageLoss === 0
        ? averageProfit > 0
          ? null
          : 0
        : round(averageProfit / averageLoss),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
  };
}

function calculateScore(metrics) {
  const winRateScore = Math.min(Math.max(metrics.winRate, 0), 100);
  const profitFactorScore =
    metrics.profitFactor === null
      ? metrics.grossProfit > 0
        ? 100
        : 0
      : Math.min((metrics.profitFactor / 2) * 100, 100);
  const riskRewardScore =
    metrics.riskReward === null
      ? metrics.grossProfit > 0
        ? 100
        : 0
      : Math.min((metrics.riskReward / 2) * 100, 100);
  const drawdownBase = metrics.grossProfit + metrics.grossLoss;
  const drawdownScore =
    drawdownBase === 0
      ? 50
      : Math.max(
          100 - (metrics.maxDrawdown / drawdownBase) * 200,
          0
        );

  return round(
    winRateScore * 0.3 +
      profitFactorScore * 0.25 +
      drawdownScore * 0.2 +
      riskRewardScore * 0.25
  );
}

function buildCandidates(input, metrics) {
  const score = calculateScore(metrics);

  return STRATEGY_TEMPLATES.map((template, index) => ({
    candidateIndex: index,
    strategyName:
      `AI_${input.market}_${input.style}_${template.code}_${input.risk}`,
    strategyLogic: {
      market: input.market,
      style: input.style,
      riskProfile: input.risk,
      mode: "PAPER_ANALYSIS_ONLY",
    },
    indicators: template.indicators,
    entryRules: template.entryRules,
    exitRules: template.exitRules,
    riskRules: RISK_RULES[input.risk],
    score,
    winRate: metrics.winRate,
    profitFactor: metrics.profitFactor,
    maxDrawdown: metrics.maxDrawdown,
    riskReward: metrics.riskReward,
    tradesAnalyzed: metrics.tradesAnalyzed,
  }));
}

async function generateStrategies(input) {
  const normalized = normalizeInput(input);
  const metrics = calculateMetrics(await loadHistoricalPnls());

  return {
    input: normalized,
    evaluationMethod: "COMPLETED_PAPER_TRADE_BASELINE",
    note:
      "Paper trades do not store the indicator strategy that generated " +
      "them; candidates share the same observed historical baseline.",
    candidates: buildCandidates(normalized, metrics),
  };
}

function mapStrategy(row) {
  return {
    id: row.id,
    strategyName: row.strategy_name,
    strategyLogic: row.strategy_logic,
    indicators: row.indicators,
    entryRules: row.entry_rules,
    exitRules: row.exit_rules,
    riskRules: row.risk_rules,
    score: Number(row.score),
    winRate: Number(row.win_rate),
    profitFactor:
      row.profit_factor === null ? null : Number(row.profit_factor),
    createdAt: row.created_at,
  };
}

async function saveStrategy(input) {
  const generated = await generateStrategies(input);
  const candidateIndex = Number(input.candidateIndex);

  if (
    !Number.isInteger(candidateIndex) ||
    candidateIndex < 0 ||
    candidateIndex >= generated.candidates.length
  ) {
    throw new AIStrategyGeneratorError(
      `candidateIndex must be between 0 and ${
        generated.candidates.length - 1
      }`,
      400
    );
  }

  const candidate = generated.candidates[candidateIndex];
  const result = await pool.query(
    `INSERT INTO ai_generated_strategies (
       strategy_name,
       strategy_logic,
       indicators,
       entry_rules,
       exit_rules,
       risk_rules,
       score,
       win_rate,
       profit_factor
     )
     VALUES (
       $1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb,
       $6::jsonb, $7, $8, $9
     )
     RETURNING *`,
    [
      candidate.strategyName,
      JSON.stringify(candidate.strategyLogic),
      JSON.stringify(candidate.indicators),
      JSON.stringify(candidate.entryRules),
      JSON.stringify(candidate.exitRules),
      JSON.stringify(candidate.riskRules),
      candidate.score,
      candidate.winRate,
      candidate.profitFactor,
    ]
  );

  return mapStrategy(result.rows[0]);
}

async function getStrategyById(id) {
  const strategyId = Number(id);
  if (!Number.isInteger(strategyId) || strategyId <= 0) {
    throw new AIStrategyGeneratorError(
      "Strategy ID must be a positive integer",
      400
    );
  }

  const result = await pool.query(
    `SELECT *
     FROM ai_generated_strategies
     WHERE id = $1`,
    [strategyId]
  );

  if (result.rows.length === 0) {
    throw new AIStrategyGeneratorError(
      "Generated strategy not found",
      404
    );
  }

  return mapStrategy(result.rows[0]);
}

async function getStrategyHistory(limit) {
  const numericLimit =
    limit === undefined ? 100 : Number(limit);

  if (
    !Number.isInteger(numericLimit) ||
    numericLimit < 1 ||
    numericLimit > 500
  ) {
    throw new AIStrategyGeneratorError(
      "limit must be an integer between 1 and 500",
      400
    );
  }

  const result = await pool.query(
    `SELECT *
     FROM ai_generated_strategies
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [numericLimit]
  );

  return result.rows.map(mapStrategy);
}

async function getBestStrategies() {
  const result = await pool.query(
    `SELECT *
     FROM ai_generated_strategies
     ORDER BY score DESC, created_at DESC, id DESC
     LIMIT 10`
  );

  return result.rows.map(mapStrategy);
}

async function getRecommendations() {
  const result = await pool.query(
    `SELECT *
     FROM ai_generated_strategies
     ORDER BY score DESC, created_at DESC, id DESC`
  );
  const strategies = result.rows.map(mapStrategy);
  const selectByRisk = (risk) =>
    strategies.find(
      (strategy) =>
        strategy.strategyLogic?.riskProfile === risk
    ) || null;

  return {
    conservative: selectByRisk("LOW"),
    moderate: selectByRisk("MEDIUM"),
    aggressive: selectByRisk("HIGH"),
    evaluatedStrategies: strategies.length,
  };
}

module.exports = {
  AIStrategyGeneratorError,
  calculateMetrics,
  calculateScore,
  generateStrategies,
  saveStrategy,
  getBestStrategies,
  getStrategyById,
  getRecommendations,
  getStrategyHistory,
};
