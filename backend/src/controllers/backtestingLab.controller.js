const {
  createBacktest,
  getBacktestSummary,
  getBacktestTrades,
  getEquityCurve,
  getDrawdownReport,
  compareBacktests,
  getBacktestHistory,
} = require("../services/backtestingLab.service");

function sendBacktestingLabError(res, error) {
  console.error("Backtesting lab request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Backtesting lab request failed",
  });
}

exports.run = async (req, res, next) => {
  if (
    req.body?.strategyName === undefined &&
    req.body?.startDate === undefined &&
    req.body?.endDate === undefined
  ) {
    next();
    return;
  }

  try {
    res.status(201).json({
      success: true,
      data: await createBacktest(req.body),
    });
  } catch (error) {
    sendBacktestingLabError(res, error);
  }
};

function reportHandler(service) {
  return async (req, res) => {
    try {
      res.json({
        success: true,
        data: await service(req.params.id),
      });
    } catch (error) {
      sendBacktestingLabError(res, error);
    }
  };
}

exports.summary = reportHandler(getBacktestSummary);
exports.trades = reportHandler(getBacktestTrades);
exports.equity = reportHandler(getEquityCurve);
exports.drawdown = reportHandler(getDrawdownReport);

exports.compare = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await compareBacktests(req.query.id1, req.query.id2),
    });
  } catch (error) {
    sendBacktestingLabError(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getBacktestHistory(),
    });
  } catch (error) {
    sendBacktestingLabError(res, error);
  }
};
