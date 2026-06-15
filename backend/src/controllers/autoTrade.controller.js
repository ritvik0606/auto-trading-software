const {
  startAutoTrade,
  stopAutoTrade,
  getAutoTradeStatus,
  getRunners,
  getSignals,
} = require("../services/autoTrade.service");

function sendAutoTradeError(res, error) {
  console.error("Auto-trade request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Auto-trade request failed",
  });
}

exports.start = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Paper auto-trade runner started",
      data: await startAutoTrade(req.body),
    });
  } catch (error) {
    sendAutoTradeError(res, error);
  }
};

exports.stop = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Paper auto-trade runner stopped",
      data: stopAutoTrade(req.body),
    });
  } catch (error) {
    sendAutoTradeError(res, error);
  }
};

exports.status = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getAutoTradeStatus(),
    });
  } catch (error) {
    sendAutoTradeError(res, error);
  }
};

exports.runners = async (req, res) => {
  try {
    res.json({
      success: true,
      data: getRunners(),
    });
  } catch (error) {
    sendAutoTradeError(res, error);
  }
};

exports.signals = async (req, res) => {
  try {
    res.json({
      success: true,
      data: getSignals(),
    });
  } catch (error) {
    sendAutoTradeError(res, error);
  }
};
