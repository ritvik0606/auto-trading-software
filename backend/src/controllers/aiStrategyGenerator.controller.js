const {
  generateStrategies,
  saveStrategy,
  getBestStrategies,
  getStrategyById,
  getRecommendations,
  getStrategyHistory,
} = require("../services/aiStrategyGenerator.service");

function sendGeneratorError(res, error) {
  console.error("AI strategy generator request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "AI strategy generator request failed",
  });
}

exports.generate = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await generateStrategies(req.body),
    });
  } catch (error) {
    sendGeneratorError(res, error);
  }
};

exports.save = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Generated strategy saved",
      data: await saveStrategy(req.body),
    });
  } catch (error) {
    sendGeneratorError(res, error);
  }
};

exports.best = async (req, res) => {
  try {
    res.json({ success: true, data: await getBestStrategies() });
  } catch (error) {
    sendGeneratorError(res, error);
  }
};

exports.details = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getStrategyById(req.params.id),
    });
  } catch (error) {
    sendGeneratorError(res, error);
  }
};

exports.recommendations = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getRecommendations(),
    });
  } catch (error) {
    sendGeneratorError(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getStrategyHistory(req.query.limit),
    });
  } catch (error) {
    sendGeneratorError(res, error);
  }
};
