const {
  runOptimization,
  getOptimizationHistory,
  getBestOptimization,
  getOptimizationSummary,
} = require("../services/optimizer.service");

function sendOptimizerError(res, error) {
  console.error("Optimizer request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Optimizer request failed",
  });
}

exports.run = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      data: await runOptimization(req.body),
    });
  } catch (error) {
    sendOptimizerError(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getOptimizationHistory(),
    });
  } catch (error) {
    sendOptimizerError(res, error);
  }
};

exports.best = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getBestOptimization(),
    });
  } catch (error) {
    sendOptimizerError(res, error);
  }
};

exports.summary = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getOptimizationSummary(),
    });
  } catch (error) {
    sendOptimizerError(res, error);
  }
};
