const {
  getDashboardSummary,
  getDashboardBrokerStatus,
  getWatchlistSummary,
  getRiskSummary,
} = require("../services/dashboard.service");

function sendDashboardError(res, error) {
  console.error("Dashboard request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Dashboard request failed",
  });
}

exports.summary = async (req, res) => {
  try {
    res.json(await getDashboardSummary());
  } catch (error) {
    sendDashboardError(res, error);
  }
};

exports.brokerStatus = async (req, res) => {
  try {
    res.json(await getDashboardBrokerStatus());
  } catch (error) {
    sendDashboardError(res, error);
  }
};

exports.watchlistSummary = async (req, res) => {
  try {
    res.json(await getWatchlistSummary());
  } catch (error) {
    sendDashboardError(res, error);
  }
};

exports.riskSummary = async (req, res) => {
  try {
    res.json(await getRiskSummary());
  } catch (error) {
    sendDashboardError(res, error);
  }
};
