const pool = require("../config/db");

const INDICATORS = new Set([
  "EMA",
  "RSI",
  "MACD",
  "VWAP",
  "VOLUME",
]);
const MARKETS = new Set(["NIFTY", "BANKNIFTY", "EQUITY"]);
const TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h", "1d"]);
const RISK_PROFILES = new Set(["LOW", "MEDIUM", "HIGH"]);

const TEMPLATES = [
  {
    code: "EMA_CROSSOVER",
    name: "EMA Crossover",
    indicators: ["EMA"],
    description: "Trend strategy using fast and slow exponential averages.",
    parameters: { fastEma: 20, slowEma: 50 },
    entryRules: [
      "BUY when fast EMA crosses above slow EMA",
      "SELL when fast EMA crosses below slow EMA",
    ],
    exitRules: ["Exit on opposite EMA crossover", "Respect stop loss and target"],
  },
  {
    code: "RSI_MOMENTUM",
    name: "RSI Momentum",
    indicators: ["RSI"],
    description: "Momentum strategy using RSI confirmation zones.",
    parameters: { rsiLength: 14, buyAbove: 55, sellBelow: 45 },
    entryRules: ["BUY when RSI rises above 55", "SELL when RSI falls below 45"],
    exitRules: ["Exit when RSI returns to neutral", "Respect stop loss and target"],
  },
  {
    code: "MACD_CROSSOVER",
    name: "MACD Crossover",
    indicators: ["MACD"],
    description: "Momentum strategy based on MACD and signal-line crosses.",
    parameters: { fast: 12, slow: 26, signal: 9 },
    entryRules: [
      "BUY when MACD crosses above its signal line",
      "SELL when MACD crosses below its signal line",
    ],
    exitRules: ["Exit on opposite crossover", "Respect stop loss and target"],
  },
  {
    code: "VWAP_RECLAIM",
    name: "VWAP Reclaim",
    indicators: ["VWAP"],
    description: "Intraday strategy using price position around VWAP.",
    parameters: { confirmationBars: 2 },
    entryRules: ["BUY after price reclaims VWAP", "SELL after price loses VWAP"],
    exitRules: ["Exit on adverse VWAP cross", "Close intraday positions before market close"],
  },
  {
    code: "VOLUME_BREAKOUT",
    name: "Volume Breakout",
    indicators: ["VOLUME"],
    description: "Breakout strategy requiring abnormal volume expansion.",
    parameters: { lookback: 20, volumeMultiplier: 1.5 },
    entryRules: [
      "BUY on resistance breakout with elevated volume",
      "SELL on support breakdown with elevated volume",
    ],
    exitRules: ["Exit on failed breakout", "Trail stop after favorable expansion"],
  },
];

let schemaReady = null;

class StrategyGeneratorError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "StrategyGeneratorError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS strategy_generator_templates (
          id SERIAL PRIMARY KEY,
          strategy_name VARCHAR(120) NOT NULL,
          template_code VARCHAR(80),
          market VARCHAR(30) NOT NULL,
          timeframe VARCHAR(20) NOT NULL,
          risk_profile VARCHAR(20) NOT NULL,
          indicators JSONB NOT NULL,
          parameters JSONB NOT NULL,
          entry_rules JSONB NOT NULL,
          exit_rules JSONB NOT NULL,
          strategy_score DECIMAL NOT NULL,
          risk_score DECIMAL NOT NULL,
          expected_win_rate DECIMAL NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

function normalizeIndicators(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StrategyGeneratorError(
      "indicators must contain at least one supported indicator",
      400
    );
  }

  const indicators = Array.from(
    new Set(
      value.map((item) =>
        typeof item === "string" ? item.trim().toUpperCase() : ""
      )
    )
  );
  const unsupported = indicators.filter(
    (indicator) => !INDICATORS.has(indicator)
  );
  if (unsupported.length > 0) {
    throw new StrategyGeneratorError(
      `Unsupported indicators: ${unsupported.join(", ")}`,
      400
    );
  }
  return indicators;
}

function normalizeChoice(value, allowed, fieldName) {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!allowed.has(normalized)) {
    throw new StrategyGeneratorError(
      `${fieldName} must be one of: ${Array.from(allowed).join(", ")}`,
      400
    );
  }
  return normalized;
}

function normalizeTimeframe(value) {
  const timeframe =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!TIMEFRAMES.has(timeframe)) {
    throw new StrategyGeneratorError(
      `timeframe must be one of: ${Array.from(TIMEFRAMES).join(", ")}`,
      400
    );
  }
  return timeframe;
}

function getTemplate(code) {
  const normalized =
    typeof code === "string" ? code.trim().toUpperCase() : "";
  return TEMPLATES.find((template) => template.code === normalized) || null;
}

function defaultParameters(indicators) {
  return TEMPLATES.filter((template) =>
    template.indicators.some((indicator) => indicators.includes(indicator))
  ).reduce(
    (parameters, template) => ({ ...parameters, ...template.parameters }),
    {}
  );
}

function buildRules(indicators) {
  const matching = TEMPLATES.filter((template) =>
    template.indicators.some((indicator) => indicators.includes(indicator))
  );
  return {
    entryRules: matching.flatMap((template) => template.entryRules),
    exitRules: Array.from(
      new Set(matching.flatMap((template) => template.exitRules))
    ),
  };
}

function calculateScores({ indicators, riskProfile, timeframe }) {
  const indicatorCount = indicators.length;
  const hasTrend = indicators.some((item) => ["EMA", "VWAP"].includes(item));
  const hasMomentum = indicators.some((item) => ["RSI", "MACD"].includes(item));
  const hasVolume = indicators.includes("VOLUME");
  const confirmationGroups =
    Number(hasTrend) + Number(hasMomentum) + Number(hasVolume);
  const complexityPenalty = Math.max(indicatorCount - 3, 0) * 6;
  const strategyScore = Math.max(
    0,
    Math.min(
      100,
      50 +
        indicatorCount * 7 +
        Math.max(confirmationGroups - 1, 0) * 8 -
        complexityPenalty
    )
  );
  const profileRisk = { LOW: 25, MEDIUM: 50, HIGH: 75 }[riskProfile];
  const timeframeRisk = { "1m": 15, "5m": 10, "15m": 5, "30m": 2, "1h": 0, "1d": -5 }[
    timeframe
  ];
  const riskScore = Math.max(
    0,
    Math.min(100, profileRisk + timeframeRisk + Math.max(indicatorCount - 3, 0) * 5)
  );
  const expectedWinRate = Math.max(
    35,
    Math.min(
      68,
      45 +
        indicatorCount * 2 +
        Math.max(confirmationGroups - 1, 0) * 3 -
        complexityPenalty * 0.25 -
        (riskProfile === "HIGH" ? 2 : 0)
    )
  );

  return {
    strategyScore: round(strategyScore),
    riskScore: round(riskScore),
    expectedWinRate: round(expectedWinRate),
  };
}

function generateStrategy(input = {}) {
  const template = getTemplate(input.templateCode);
  const indicators = normalizeIndicators(
    input.indicators || template?.indicators
  );
  const market = normalizeChoice(
    input.market || "EQUITY",
    MARKETS,
    "market"
  );
  const timeframe = normalizeTimeframe(input.timeframe || "15m");
  const riskProfile = normalizeChoice(
    input.riskProfile || "MEDIUM",
    RISK_PROFILES,
    "riskProfile"
  );
  const name =
    typeof input.strategyName === "string" && input.strategyName.trim()
      ? input.strategyName.trim().slice(0, 120)
      : template?.name ||
        `${indicators.join("_")}_${market}_${timeframe.toUpperCase()}`;
  const parameters = {
    ...defaultParameters(indicators),
    ...(template?.parameters || {}),
    ...(input.parameters && typeof input.parameters === "object"
      ? input.parameters
      : {}),
  };
  const rules = buildRules(indicators);
  const scores = calculateScores({
    indicators,
    riskProfile,
    timeframe,
  });

  return {
    strategyName: name,
    templateCode: template?.code || "MULTI_INDICATOR",
    market,
    timeframe,
    riskProfile,
    indicators,
    parameters,
    entryRules: rules.entryRules,
    exitRules: rules.exitRules,
    ...scores,
    evaluationMethod: "RULE_BASED_TEMPLATE_ESTIMATE",
    expectedWinRateIsEstimate: true,
    mode: "ANALYSIS_ONLY",
    generatedAt: new Date().toISOString(),
  };
}

function getTemplates() {
  return TEMPLATES.map((template) => ({
    ...template,
    supportedMarkets: Array.from(MARKETS),
    supportedTimeframes: Array.from(TIMEFRAMES),
  }));
}

function validateGeneratedStrategy(input = {}) {
  return generateStrategy({
    strategyName: input.strategyName,
    templateCode: input.templateCode,
    market: input.market,
    timeframe: input.timeframe,
    riskProfile: input.riskProfile,
    indicators: input.indicators,
    parameters: input.parameters,
  });
}

function mapSavedStrategy(row) {
  return {
    id: row.id,
    strategyName: row.strategy_name,
    templateCode: row.template_code,
    market: row.market,
    timeframe: row.timeframe,
    riskProfile: row.risk_profile,
    indicators: row.indicators,
    parameters: row.parameters,
    entryRules: row.entry_rules,
    exitRules: row.exit_rules,
    strategyScore: Number(row.strategy_score),
    riskScore: Number(row.risk_score),
    expectedWinRate: Number(row.expected_win_rate),
    expectedWinRateIsEstimate: true,
    mode: "ANALYSIS_ONLY",
    createdAt: row.created_at,
  };
}

async function saveStrategy(input) {
  await ensureSchema();
  const strategy = validateGeneratedStrategy(input);
  const result = await pool.query(
    `INSERT INTO strategy_generator_templates (
       strategy_name,
       template_code,
       market,
       timeframe,
       risk_profile,
       indicators,
       parameters,
       entry_rules,
       exit_rules,
       strategy_score,
       risk_score,
       expected_win_rate
     )
     VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
       $8::jsonb, $9::jsonb, $10, $11, $12
     )
     RETURNING *`,
    [
      strategy.strategyName,
      strategy.templateCode,
      strategy.market,
      strategy.timeframe,
      strategy.riskProfile,
      JSON.stringify(strategy.indicators),
      JSON.stringify(strategy.parameters),
      JSON.stringify(strategy.entryRules),
      JSON.stringify(strategy.exitRules),
      strategy.strategyScore,
      strategy.riskScore,
      strategy.expectedWinRate,
    ]
  );
  return mapSavedStrategy(result.rows[0]);
}

async function getHistory() {
  await ensureSchema();
  const result = await pool.query(
    `SELECT *
     FROM strategy_generator_templates
     ORDER BY created_at DESC, id DESC
     LIMIT 200`
  );
  return result.rows.map(mapSavedStrategy);
}

module.exports = {
  StrategyGeneratorError,
  calculateScores,
  getTemplates,
  generateStrategy,
  saveStrategy,
  getHistory,
};
