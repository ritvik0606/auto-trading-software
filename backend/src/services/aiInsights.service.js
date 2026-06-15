const pool = require("../config/db");
const {
  getPerformanceSummary,
  getAggregatedPerformance,
  getDrawdown,
} = require("./performance.service");
const { getRiskSettings } = require("./risk.service");
const { getRiskDashboard, getRiskRules } = require("./riskDashboard.service");
const { getActiveStrategies } = require("./strategy.service");

class AIInsightsError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AIInsightsError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function riskLevel(score) {
  if (score >= 6) {
    return "HIGH";
  }

  if (score >= 3) {
    return "MEDIUM";
  }

  return "LOW";
}

async function getTradeAnalysisData() {
  const [tradesResult, dailyResult, symbolsResult, positionsResult] =
    await Promise.all([
      pool.query(
        `SELECT
           paper_trades.id,
           paper_trades.symbol,
           paper_trades.trade_type,
           paper_trades.entry_price,
           paper_trades.exit_price,
           paper_trades.quantity,
           paper_trades.stop_loss,
           paper_trades.pnl,
           paper_trades.created_at,
           paper_trades.closed_at,
           trade_journal.notes,
           EXTRACT(
             EPOCH FROM (
               COALESCE(paper_trades.closed_at, CURRENT_TIMESTAMP)
               - paper_trades.created_at
             )
           ) / 3600 AS holding_hours
         FROM paper_trades
         LEFT JOIN trade_journal
           ON trade_journal.trade_id = paper_trades.id
         WHERE paper_trades.status = 'CLOSED'
         ORDER BY COALESCE(
           paper_trades.closed_at,
           paper_trades.created_at
         ), paper_trades.id`
      ),
      pool.query(
        `SELECT
           COALESCE(closed_at, created_at)::date AS trade_date,
           COUNT(*) AS trade_count,
           COALESCE(SUM(pnl), 0) AS pnl
         FROM paper_trades
         WHERE status = 'CLOSED'
         GROUP BY trade_date
         ORDER BY trade_date`
      ),
      pool.query(
        `SELECT
           symbol,
           COUNT(*) AS total_trades,
           COUNT(*) FILTER (WHERE pnl > 0) AS winning_trades,
           COALESCE(SUM(pnl), 0) AS pnl
         FROM paper_trades
         WHERE status = 'CLOSED'
         GROUP BY symbol
         ORDER BY pnl DESC, symbol`
      ),
      pool.query(
        `SELECT
           id,
           symbol,
           side,
           quantity,
           average_price,
           current_price,
           unrealized_pnl,
           created_at
         FROM positions
         WHERE status = 'OPEN'
         ORDER BY created_at`
      ),
    ]);

  return {
    trades: tradesResult.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.trade_type,
      entryPrice: Number(row.entry_price),
      exitPrice:
        row.exit_price === null ? null : Number(row.exit_price),
      quantity: row.quantity,
      stopLoss:
        row.stop_loss === null ? null : Number(row.stop_loss),
      pnl: Number(row.pnl),
      holdingHours: Number(row.holding_hours),
      notes: row.notes,
      createdAt: row.created_at,
      closedAt: row.closed_at,
    })),
    daily: dailyResult.rows.map((row) => ({
      date: row.trade_date,
      tradeCount: Number(row.trade_count),
      pnl: Number(row.pnl),
    })),
    symbols: symbolsResult.rows.map((row) => ({
      symbol: row.symbol,
      totalTrades: Number(row.total_trades),
      winningTrades: Number(row.winning_trades),
      pnl: Number(row.pnl),
    })),
    openPositions: positionsResult.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      averagePrice: Number(row.average_price),
      currentPrice: Number(row.current_price),
      unrealizedPnl: Number(row.unrealized_pnl),
      createdAt: row.created_at,
    })),
  };
}

async function loadContext() {
  try {
    const [
      performance,
      dailyPerformance,
      drawdown,
      riskSettings,
      riskDashboard,
      riskRules,
      tradeData,
    ] = await Promise.all([
      getPerformanceSummary(),
      getAggregatedPerformance("daily"),
      getDrawdown(),
      getRiskSettings(),
      getRiskDashboard(),
      getRiskRules(),
      getTradeAnalysisData(),
    ]);

    return {
      performance,
      dailyPerformance,
      drawdown,
      riskSettings,
      riskDashboard,
      riskRules,
      tradeData,
      activeStrategies: getActiveStrategies(),
    };
  } catch (error) {
    throw new AIInsightsError("Unable to analyze trading data");
  }
}

function getOvertradingAnalysis(context) {
  const limit = context.riskSettings.maxTradesPerDay;
  const excessiveDays = context.tradeData.daily.filter(
    (day) => day.tradeCount > limit
  );
  const highestTradesInDay = context.tradeData.daily.reduce(
    (maximum, day) => Math.max(maximum, day.tradeCount),
    0
  );

  return {
    detected: excessiveDays.length > 0,
    maxTradesPerDay: limit,
    highestTradesInDay,
    excessiveDays: excessiveDays.length,
  };
}

function getPerformanceTrend(dailyPerformance) {
  if (dailyPerformance.length < 2) {
    return "INSUFFICIENT_DATA";
  }

  const midpoint = Math.ceil(dailyPerformance.length / 2);
  const previous = dailyPerformance
    .slice(0, midpoint)
    .reduce((sum, day) => sum + day.pnl, 0);
  const recent = dailyPerformance
    .slice(midpoint)
    .reduce((sum, day) => sum + day.pnl, 0);

  if (recent > previous) {
    return "IMPROVING";
  }

  if (recent < previous) {
    return "DECLINING";
  }

  return "STABLE";
}

function getRiskRewardRatio(performance) {
  const averageLoss = Math.abs(performance.averageLoss);

  if (averageLoss === 0) {
    return performance.averageProfit > 0 ? null : 0;
  }

  return round(performance.averageProfit / averageLoss);
}

function getTradeQualityFromContext(context) {
  const riskRewardRatio = getRiskRewardRatio(context.performance);
  const overtrading = getOvertradingAnalysis(context);

  return {
    totalTrades: context.performance.totalTrades,
    winRate: context.performance.winRate,
    averageProfit: context.performance.averageProfit,
    averageLoss: context.performance.averageLoss,
    riskRewardRatio,
    profitFactor: context.performance.profitFactor,
    overtrading,
    quality:
      context.performance.totalTrades === 0
        ? "INSUFFICIENT_DATA"
        : context.performance.winRate >= 50 &&
            (riskRewardRatio === null || riskRewardRatio >= 1.5) &&
            !overtrading.detected
          ? "GOOD"
          : context.performance.winRate >= 40 &&
              (riskRewardRatio === null || riskRewardRatio >= 1)
            ? "FAIR"
            : "POOR",
  };
}

function getMistakesFromContext(context) {
  const trades = context.tradeData.trades;
  const riskRewardRatio = getRiskRewardRatio(context.performance);
  const overtrading = getOvertradingAnalysis(context);
  let currentLosingStreak = 0;
  let longestLosingStreak = 0;

  for (const trade of trades) {
    if (trade.pnl < 0) {
      currentLosingStreak += 1;
      longestLosingStreak = Math.max(
        longestLosingStreak,
        currentLosingStreak
      );
    } else {
      currentLosingStreak = 0;
    }
  }

  const longHeldLosses = trades.filter(
    (trade) => trade.pnl < 0 && trade.holdingHours > 24
  );
  const highDrawdownThreshold =
    context.riskDashboard.totalCapital * 0.1;
  const mistakes = [
    {
      type: "REPEATED_LOSING_TRADES",
      detected: longestLosingStreak >= 3,
      severity: longestLosingStreak >= 5 ? "HIGH" : "MEDIUM",
      detail: `Longest losing streak: ${longestLosingStreak}`,
    },
    {
      type: "POOR_RISK_REWARD",
      detected:
        riskRewardRatio !== null &&
        context.performance.losingTrades > 0 &&
        riskRewardRatio < 1,
      severity: riskRewardRatio !== null && riskRewardRatio < 0.7
        ? "HIGH"
        : "MEDIUM",
      detail: `Risk-reward ratio: ${riskRewardRatio ?? "N/A"}`,
    },
    {
      type: "HIGH_DRAWDOWN",
      detected:
        context.drawdown.maxDrawdown >= highDrawdownThreshold ||
        context.drawdown.maxDrawdownPercent >= 10,
      severity:
        context.drawdown.maxDrawdownPercent >= 20 ? "HIGH" : "MEDIUM",
      detail: `Maximum drawdown: ${context.drawdown.maxDrawdown}`,
    },
    {
      type: "TOO_MANY_TRADES",
      detected: overtrading.detected,
      severity:
        overtrading.highestTradesInDay >
        overtrading.maxTradesPerDay * 1.5
          ? "HIGH"
          : "MEDIUM",
      detail:
        `${overtrading.excessiveDays} day(s) exceeded ` +
        `${overtrading.maxTradesPerDay} trades`,
    },
    {
      type: "HELD_LOSING_TRADES_TOO_LONG",
      detected: longHeldLosses.length > 0,
      severity: longHeldLosses.length >= 3 ? "HIGH" : "MEDIUM",
      detail: `${longHeldLosses.length} losing trade(s) exceeded 24 hours`,
    },
  ];

  return {
    detectedCount: mistakes.filter((mistake) => mistake.detected).length,
    mistakes,
  };
}

function getRecommendationsFromContext(context) {
  const quality = getTradeQualityFromContext(context);
  const recommendations = [];
  const stopLossUsage =
    context.tradeData.trades.length === 0
      ? 1
      : context.tradeData.trades.filter(
          (trade) => trade.stopLoss !== null
        ).length / context.tradeData.trades.length;
  const losingOpenPositions = context.tradeData.openPositions.filter(
    (position) => position.unrealizedPnl < 0
  );
  const failedStrategies = context.activeStrategies.filter(
    (strategy) => strategy.lastError
  );
  const lowConfidenceTrades = context.tradeData.trades.filter(
    (trade) =>
      typeof trade.notes === "string" &&
      /low[- ]confidence|weak signal|uncertain/i.test(trade.notes)
  );
  const bestSymbol = context.tradeData.symbols.find(
    (symbol) => symbol.pnl > 0
  );

  if (stopLossUsage < 0.8 || quality.riskRewardRatio < 1) {
    recommendations.push({
      priority: "HIGH",
      recommendation: "Improve stop loss placement",
      reason: "Use defined exits to improve risk-reward consistency.",
    });
  }

  if (
    context.riskDashboard.usedCapital /
      Math.max(context.riskDashboard.totalCapital, 1) >
      0.5 ||
    losingOpenPositions.length > 0
  ) {
    recommendations.push({
      priority: "HIGH",
      recommendation: "Reduce quantity",
      reason: "Lower position sizing while exposure or open losses are elevated.",
    });
  }

  if (
    failedStrategies.length > 0 ||
    lowConfidenceTrades.length > 0 ||
    context.performance.winRate < 45
  ) {
    recommendations.push({
      priority: "MEDIUM",
      recommendation: "Avoid low-confidence signals",
      reason: "Require stronger confirmation before creating paper trades.",
    });
  }

  if (
    context.riskDashboard.currentDailyLoss >=
      context.riskDashboard.maxDailyLoss * 0.75 ||
    context.riskDashboard.dailyLossLocked
  ) {
    recommendations.push({
      priority: "HIGH",
      recommendation: "Stop trading after daily loss limit",
      reason: "Protect capital when the configured daily loss threshold is near.",
    });
  }

  if (bestSymbol) {
    recommendations.push({
      priority: "MEDIUM",
      recommendation: "Focus on best performing symbols",
      reason: `${bestSymbol.symbol} currently has the strongest recorded PnL.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: "LOW",
      recommendation: "Maintain current paper-trading discipline",
      reason: "No major rule-based weakness is currently detected.",
    });
  }

  return {
    recommendations,
    bestPerformingSymbol: bestSymbol || null,
  };
}

function getRiskWarningFromContext(context) {
  const todayTrades =
    context.tradeData.daily.find((day) => {
      const date = new Date(day.date);
      const now = new Date();
      return date.toDateString() === now.toDateString();
    })?.tradeCount || 0;
  const dailyLossRatio =
    context.riskDashboard.maxDailyLoss === 0
      ? context.riskDashboard.currentDailyLoss > 0
        ? 1
        : 0
      : context.riskDashboard.currentDailyLoss /
        context.riskDashboard.maxDailyLoss;
  const openPositionRatio =
    context.riskDashboard.openPositions /
    Math.max(context.riskRules.maxOpenPositions, 1);
  const overtradingRatio =
    todayTrades / Math.max(context.riskSettings.maxTradesPerDay, 1);
  const capitalUtilizationRatio =
    context.riskDashboard.usedCapital /
    Math.max(context.riskDashboard.totalCapital, 1);
  const scores = {
    dailyLossRisk:
      dailyLossRatio >= 1 ? 3 : dailyLossRatio >= 0.75 ? 2 : dailyLossRatio >= 0.5 ? 1 : 0,
    openExposureRisk:
      openPositionRatio >= 1 ? 3 : openPositionRatio >= 0.75 ? 2 : openPositionRatio >= 0.5 ? 1 : 0,
    overtradingRisk:
      overtradingRatio > 1 ? 3 : overtradingRatio >= 0.8 ? 2 : overtradingRatio >= 0.6 ? 1 : 0,
    capitalUtilizationRisk:
      capitalUtilizationRatio >= 0.8 ? 3 : capitalUtilizationRatio >= 0.6 ? 2 : capitalUtilizationRatio >= 0.4 ? 1 : 0,
  };
  const totalScore = Object.values(scores).reduce(
    (sum, score) => sum + score,
    0
  );

  return {
    currentRiskLevel: riskLevel(totalScore),
    dailyLossRisk: {
      level: riskLevel(scores.dailyLossRisk * 2),
      currentLoss: context.riskDashboard.currentDailyLoss,
      limit: context.riskDashboard.maxDailyLoss,
    },
    openExposureRisk: {
      level: riskLevel(scores.openExposureRisk * 2),
      openPositions: context.riskDashboard.openPositions,
      limit: context.riskRules.maxOpenPositions,
    },
    overtradingRisk: {
      level: riskLevel(scores.overtradingRisk * 2),
      tradesToday: todayTrades,
      limit: context.riskSettings.maxTradesPerDay,
    },
    capitalUtilizationRisk: {
      level: riskLevel(scores.capitalUtilizationRisk * 2),
      utilizationPercent: round(capitalUtilizationRatio * 100),
    },
    killSwitchActive: context.riskDashboard.killSwitchActive,
  };
}

async function getTradeQuality() {
  return getTradeQualityFromContext(await loadContext());
}

async function getMistakes() {
  return getMistakesFromContext(await loadContext());
}

async function getRecommendations() {
  return getRecommendationsFromContext(await loadContext());
}

async function getRiskWarning() {
  return getRiskWarningFromContext(await loadContext());
}

async function getAIInsightsSummary() {
  const context = await loadContext();
  const quality = getTradeQualityFromContext(context);
  const mistakes = getMistakesFromContext(context);
  const recommendations = getRecommendationsFromContext(context);
  const warning = getRiskWarningFromContext(context);
  const trend = getPerformanceTrend(context.dailyPerformance);
  let score = 70;

  score += Math.min(context.performance.winRate - 50, 20) * 0.4;
  score += context.performance.profitFactor === null
    ? 0
    : Math.min(context.performance.profitFactor - 1, 2) * 10;
  score -= mistakes.detectedCount * 7;
  score -= warning.currentRiskLevel === "HIGH"
    ? 20
    : warning.currentRiskLevel === "MEDIUM"
      ? 10
      : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const strengths = [
    context.performance.winRate >= 55 && "Strong win rate",
    (quality.riskRewardRatio === null || quality.riskRewardRatio >= 1.5) &&
      "Good risk-reward control",
    warning.currentRiskLevel === "LOW" && "Good risk control",
    !quality.overtrading.detected && "Disciplined trade frequency",
  ].filter(Boolean);
  const weaknesses = [
    context.performance.winRate < 45 && "Low win rate",
    quality.riskRewardRatio !== null &&
      quality.riskRewardRatio < 1 &&
      "Poor risk-reward ratio",
    quality.overtrading.detected && "Overtrading",
    context.drawdown.maxDrawdownPercent >= 10 && "High drawdown",
  ].filter(Boolean);

  return {
    overallScore: score,
    performanceTrend: trend,
    mainStrength: strengths[0] || "Insufficient data to confirm a strength",
    mainWeakness: weaknesses[0] || "No major weakness detected",
    recommendation:
      recommendations.recommendations[0].recommendation,
    analyzedTrades: context.performance.totalTrades,
  };
}

module.exports = {
  AIInsightsError,
  getAIInsightsSummary,
  getTradeQuality,
  getMistakes,
  getRecommendations,
  getRiskWarning,
};
