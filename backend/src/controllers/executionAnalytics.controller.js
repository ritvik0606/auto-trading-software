const analytics = require("../services/executionAnalytics.service");
const reconciliation = require("../services/orderReconciliation.service");

function sendError(res, error) {
  console.error("Execution analytics request failed", {
    message: error.message,
  });
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Execution analytics request failed",
  });
}

function handler(method, statusCode = 200) {
  return async (req, res) => {
    try {
      res.status(statusCode).json({ success: true, data: await method() });
    } catch (error) {
      sendError(res, error);
    }
  };
}

exports.summary = handler(analytics.getSummary);
exports.slippage = handler(analytics.getSlippage);
exports.latency = handler(analytics.getLatency);
exports.report = handler(reconciliation.getReport);
exports.run = handler(reconciliation.runReconciliation, 201);
