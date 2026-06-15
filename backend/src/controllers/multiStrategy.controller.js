const {
  addStrategy,
  startStrategy,
  pauseStrategy,
  stopStrategy,
  getStrategies,
  getStrategyPerformance,
} = require("../services/multiStrategy.service");

function sendMultiStrategyError(res, error) {
  console.error("Multi strategy request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Multi strategy request failed",
  });
}

exports.add = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Strategy instance added",
      data: await addStrategy(req.body),
    });
  } catch (error) {
    sendMultiStrategyError(res, error);
  }
};

function actionHandler(action, message) {
  return async (req, res) => {
    try {
      res.json({
        success: true,
        message,
        data: await action(req.params.id),
      });
    } catch (error) {
      sendMultiStrategyError(res, error);
    }
  };
}

exports.start = actionHandler(startStrategy, "Paper strategy started");
exports.pause = actionHandler(pauseStrategy, "Paper strategy paused");
exports.stop = actionHandler(stopStrategy, "Paper strategy stopped");

exports.all = async (req, res) => {
  try {
    res.json({ success: true, data: await getStrategies() });
  } catch (error) {
    sendMultiStrategyError(res, error);
  }
};

exports.active = async (req, res) => {
  try {
    res.json({ success: true, data: await getStrategies(true) });
  } catch (error) {
    sendMultiStrategyError(res, error);
  }
};

exports.performance = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getStrategyPerformance(req.params.id),
    });
  } catch (error) {
    sendMultiStrategyError(res, error);
  }
};
