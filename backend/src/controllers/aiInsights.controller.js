const {
  getAIInsightsSummary,
  getTradeQuality,
  getMistakes,
  getRecommendations,
  getRiskWarning,
} = require("../services/aiInsights.service");

function sendAIInsightsError(res, error) {
  console.error("AI insights request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "AI insights request failed",
  });
}

function insightHandler(service) {
  return async (req, res) => {
    try {
      res.json({ success: true, data: await service() });
    } catch (error) {
      sendAIInsightsError(res, error);
    }
  };
}

exports.summary = insightHandler(getAIInsightsSummary);
exports.tradeQuality = insightHandler(getTradeQuality);
exports.mistakes = insightHandler(getMistakes);
exports.recommendations = insightHandler(getRecommendations);
exports.riskWarning = insightHandler(getRiskWarning);
