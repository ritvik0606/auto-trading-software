const {
  getPortfolioSummary,
  getPortfolioHoldings,
  getPortfolioPnL,
  getPortfolioAllocation,
  getPortfolioAnalytics,
} = require("../services/portfolio.service");

function sendPortfolioError(res, error) {
  console.error("Portfolio request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Portfolio request failed",
  });
}

exports.summary = async (req, res) => {
  try {
    res.json(await getPortfolioSummary());
  } catch (error) {
    sendPortfolioError(res, error);
  }
};

exports.holdings = async (req, res) => {
  try {
    res.json(await getPortfolioHoldings());
  } catch (error) {
    sendPortfolioError(res, error);
  }
};

exports.pnl = async (req, res) => {
  try {
    res.json(await getPortfolioPnL());
  } catch (error) {
    sendPortfolioError(res, error);
  }
};

exports.allocation = async (req, res) => {
  try {
    res.json(await getPortfolioAllocation());
  } catch (error) {
    sendPortfolioError(res, error);
  }
};

exports.analytics = async (req, res) => {
  try {
    res.json(await getPortfolioAnalytics());
  } catch (error) {
    sendPortfolioError(res, error);
  }
};
