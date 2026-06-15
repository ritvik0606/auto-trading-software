const {
  startStrategy,
  stopStrategy,
  getActiveStrategies,
} = require("../services/strategy.service");

function sendStrategyError(res, error) {
  console.error("Strategy request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Strategy request failed",
  });
}

exports.start = async (req, res) => {
  try {
    const strategy = await startStrategy(req.body);

    res.status(201).json({
      success: true,
      message: "Paper strategy started",
      data: strategy,
    });
  } catch (error) {
    sendStrategyError(res, error);
  }
};

exports.stop = async (req, res) => {
  try {
    const strategy = stopStrategy(req.body);

    res.json({
      success: true,
      message: "Paper strategy stopped",
      data: strategy,
    });
  } catch (error) {
    sendStrategyError(res, error);
  }
};

exports.active = async (req, res) => {
  try {
    res.json({
      success: true,
      data: getActiveStrategies(),
    });
  } catch (error) {
    sendStrategyError(res, error);
  }
};
