const {
  getPerformanceSummary,
  getAggregatedPerformance,
  getEquityCurve,
  getDrawdown,
} = require("../services/performance.service");

function sendPerformanceError(res, error) {
  console.error("Performance request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Performance request failed",
  });
}

exports.summary = async (req, res) => {
  try {
    res.json({ success: true, data: await getPerformanceSummary() });
  } catch (error) {
    sendPerformanceError(res, error);
  }
};

function aggregateHandler(period) {
  return async (req, res) => {
    try {
      res.json({
        success: true,
        data: await getAggregatedPerformance(period),
      });
    } catch (error) {
      sendPerformanceError(res, error);
    }
  };
}

exports.daily = aggregateHandler("daily");
exports.weekly = aggregateHandler("weekly");
exports.monthly = aggregateHandler("monthly");

exports.equityCurve = async (req, res) => {
  try {
    res.json({ success: true, data: await getEquityCurve() });
  } catch (error) {
    sendPerformanceError(res, error);
  }
};

exports.drawdown = async (req, res) => {
  try {
    res.json({ success: true, data: await getDrawdown() });
  } catch (error) {
    sendPerformanceError(res, error);
  }
};
