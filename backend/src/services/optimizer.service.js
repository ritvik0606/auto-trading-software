const pool = require("../config/db");

const DEFAULT_PARAMETERS = {
  fastEma: [10, 20],
  slowEma: [50],
  rsiLength: [14],
  rsiOverbought: [70],
  rsiOversold: [30],
  macdFast: [12],
  macdSlow: [26],
  macdSignal: [9],
};
const MAX_TESTS_PER_RUN = 100;

class OptimizerError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "OptimizerError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function mapOptimization(row) {
  return {
    id: row.id,
    strategyName: row.strategy_name,
    parameterSet: row.parameter_set,
    tradesAnalyzed: row.trades_analyzed,
    winRate: Number(row.win_rate),
    profitFactor:
      row.profit_factor === null ? null : Number(row.profit_factor),
    averageProfit: Number(row.avg_profit),
    averageLoss: Number(row.avg_loss),
    maxDrawdown: Number(row.max_drawdown),
    score: Number(row.score),
    createdAt: row.created_at,
  };
}

function normalizeStrategyName(value) {
  const strategyName =
    typeof value === "string" && value.trim()
      ? value.trim().toUpperCase()
      : "EMA_RSI_MACD";

  if (
    strategyName.length > 100 ||
    !/^[A-Z0-9_-]+$/.test(strategyName)
  ) {
    throw new OptimizerError("strategyName is invalid", 400);
  }

  return strategyName;
}

function normalizeNumberList(value, fieldName, defaults) {
  const requested = value === undefined ? defaults : value;
  const list = Array.isArray(requested) ? requested : [requested];

  if (list.length === 0) {
    throw new OptimizerError(
      `${fieldName} must be a non-empty array`,
      400
    );
  }

  const normalized = [...new Set(list.map(Number))];
  if (
    normalized.some(
      (number) => !Number.isInteger(number) || number <= 0
    )
  ) {
    throw new OptimizerError(
      `${fieldName} must contain positive integers`,
      400
    );
  }

  return normalized;
}

function normalizeParameters(input = {}) {
  const aliases = {
    fastEma: input.ema?.fast,
    slowEma: input.ema?.slow,
    rsiLength: input.rsi?.length,
    rsiOverbought: input.rsi?.overbought,
    rsiOversold: input.rsi?.oversold,
    macdFast: input.macd?.fast,
    macdSlow: input.macd?.slow,
    macdSignal: input.macd?.signal,
  };

  return Object.fromEntries(
    Object.entries(DEFAULT_PARAMETERS).map(([field, defaults]) => [
      field,
      normalizeNumberList(
        input[field] ?? aliases[field],
        field,
        defaults
      ),
    ])
  );
}

function buildParameterSets(parameters) {
  const fields = Object.keys(DEFAULT_PARAMETERS);
  let combinations = [{}];

  for (const field of fields) {
    combinations = combinations.flatMap((combination) =>
      parameters[field].map((value) => ({
        ...combination,
        [field]: value,
      }))
    );

    if (combinations.length > MAX_TESTS_PER_RUN) {
      throw new OptimizerError(
        `Parameter combinations must not exceed ${MAX_TESTS_PER_RUN}`,
        400
      );
    }
  }

  const valid = combinations.filter(
    (set) =>
      set.fastEma < set.slowEma &&
      set.rsiOversold < set.rsiOverbought &&
      set.macdFast < set.macdSlow
  );

  if (valid.length === 0) {
    throw new OptimizerError(
      "No valid parameter combinations were generated",
      400
    );
  }

  return valid;
}

async function getCompletedTradePnls() {
  const result = await pool.query(
    `SELECT pnl
     FROM paper_trades
     WHERE status = 'CLOSED'
     ORDER BY COALESCE(closed_at, created_at), id`
  );

  return result.rows.map((row) => Number(row.pnl));
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

function calculateMetrics(pnls) {
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, pnl) => sum + pnl, 0)
  );
  const netProfit = pnls.reduce((sum, pnl) => sum + pnl, 0);

  return {
    tradesAnalyzed: pnls.length,
    winRate:
      pnls.length === 0 ? 0 : round((wins.length / pnls.length) * 100),
    profitFactor:
      grossLoss === 0 ? null : round(grossProfit / grossLoss),
    averageProfit:
      wins.length === 0 ? 0 : round(grossProfit / wins.length),
    averageLoss:
      losses.length === 0 ? 0 : round(-grossLoss / losses.length),
    maxDrawdown: calculateMaxDrawdown(pnls),
    netProfit: round(netProfit),
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
  const drawdownBase =
    Math.abs(metrics.netProfit) +
    metrics.grossProfit +
    metrics.grossLoss;
  const drawdownRatio =
    drawdownBase === 0 ? 0 : metrics.maxDrawdown / drawdownBase;
  const drawdownScore = Math.max(100 - drawdownRatio * 200, 0);
  const netProfitScore =
    metrics.grossProfit + metrics.grossLoss === 0
      ? 50
      : Math.min(
          Math.max(
            50 +
              (metrics.netProfit /
                (metrics.grossProfit + metrics.grossLoss)) *
                50,
            0
          ),
          100
        );

  return round(
    winRateScore * 0.3 +
      profitFactorScore * 0.25 +
      drawdownScore * 0.2 +
      netProfitScore * 0.25
  );
}

async function saveOptimization(
  strategyName,
  parameterSet,
  metrics,
  score
) {
  const result = await pool.query(
    `INSERT INTO strategy_optimizations (
       strategy_name,
       parameter_set,
       trades_analyzed,
       win_rate,
       profit_factor,
       avg_profit,
       avg_loss,
       max_drawdown,
       score
     )
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      strategyName,
      JSON.stringify(parameterSet),
      metrics.tradesAnalyzed,
      metrics.winRate,
      metrics.profitFactor,
      metrics.averageProfit,
      metrics.averageLoss,
      metrics.maxDrawdown,
      score,
    ]
  );

  return mapOptimization(result.rows[0]);
}

async function runOptimization(input = {}) {
  const strategyName = normalizeStrategyName(input.strategyName);
  const parameterSets = buildParameterSets(
    normalizeParameters(input.parameters)
  );
  const pnls = await getCompletedTradePnls();

  if (pnls.length === 0) {
    throw new OptimizerError(
      "No completed paper trades are available for optimization",
      400
    );
  }

  const metrics = calculateMetrics(pnls);
  const score = calculateScore(metrics);
  const results = [];

  for (const parameterSet of parameterSets) {
    results.push(
      await saveOptimization(
        strategyName,
        parameterSet,
        metrics,
        score
      )
    );
  }

  results.sort(
    (left, right) =>
      right.score - left.score ||
      left.id - right.id
  );

  return {
    strategyName,
    evaluationMethod: "COMPLETED_PAPER_TRADE_BASELINE",
    note:
      "Paper trades do not store generating indicator parameters; " +
      "all combinations are benchmarked against the same completed history.",
    testsRun: results.length,
    bestConfiguration: results[0],
    results,
  };
}

async function getOptimizationHistory() {
  const result = await pool.query(
    `SELECT *
     FROM strategy_optimizations
     ORDER BY created_at DESC, score DESC, id DESC`
  );

  return result.rows.map(mapOptimization);
}

async function getBestOptimization() {
  const result = await pool.query(
    `SELECT *
     FROM strategy_optimizations
     ORDER BY score DESC, created_at DESC, id DESC
     LIMIT 1`
  );

  return result.rows.length === 0
    ? null
    : mapOptimization(result.rows[0]);
}

async function getOptimizationSummary() {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS total_tests,
       (
         SELECT strategy_name
         FROM strategy_optimizations
         ORDER BY score DESC, created_at DESC, id DESC
         LIMIT 1
       ) AS best_strategy,
       (
         SELECT parameter_set
         FROM strategy_optimizations
         ORDER BY score DESC, created_at DESC, id DESC
         LIMIT 1
       ) AS best_parameters,
       (
         SELECT score
         FROM strategy_optimizations
         ORDER BY score DESC, created_at DESC, id DESC
         LIMIT 1
       ) AS best_score
     FROM strategy_optimizations`
  );
  const row = result.rows[0];

  return {
    bestStrategy: row.best_strategy,
    bestParameters: row.best_parameters,
    bestScore:
      row.best_score === null ? null : Number(row.best_score),
    totalTestsRun: Number(row.total_tests),
  };
}

module.exports = {
  OptimizerError,
  calculateMaxDrawdown,
  calculateMetrics,
  calculateScore,
  runOptimization,
  getOptimizationHistory,
  getBestOptimization,
  getOptimizationSummary,
};
