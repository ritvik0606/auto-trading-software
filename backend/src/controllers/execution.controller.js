const {
  getExecutionSummary,
  getExecutionOrders,
  getSlippageAnalytics,
  getBrokerPerformance,
} = require("../services/execution.service");

function sendExecutionError(res, error) {
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

exports.summary = async (req, res) => {
  try {
    res.json({ success: true, data: await getExecutionSummary() });
  } catch (error) {
    sendExecutionError(res, error);
  }
};

exports.orders = async (req, res) => {
  try {
    res.json({ success: true, data: await getExecutionOrders() });
  } catch (error) {
    sendExecutionError(res, error);
  }
};

exports.slippage = async (req, res) => {
  try {
    res.json({ success: true, data: await getSlippageAnalytics() });
  } catch (error) {
    sendExecutionError(res, error);
  }
};

exports.brokerPerformance = async (req, res) => {
  try {
    res.json({ success: true, data: await getBrokerPerformance() });
  } catch (error) {
    sendExecutionError(res, error);
  }
};
