const portfolioAnalyticsService = require(
  "../services/portfolioAnalytics.service"
);

function sendError(res, error) {
  console.error("Portfolio analytics request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Portfolio analytics request failed",
  });
}

function handler(serviceMethod) {
  return async (req, res) => {
    try {
      res.json({
        success: true,
        data: await serviceMethod(),
      });
    } catch (error) {
      sendError(res, error);
    }
  };
}

exports.summary = handler(portfolioAnalyticsService.getSummary);
exports.performance = handler(portfolioAnalyticsService.getPerformance);
exports.drawdown = handler(portfolioAnalyticsService.getDrawdown);
exports.equityCurve = handler(portfolioAnalyticsService.getEquityCurve);
