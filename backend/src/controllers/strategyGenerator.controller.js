const {
  getTemplates,
  generateStrategy,
  saveStrategy,
  getHistory,
} = require("../services/strategyGenerator.service");

function sendStrategyGeneratorError(res, error) {
  console.error("Strategy generator request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Strategy generator request failed",
  });
}

exports.templates = (req, res) => {
  try {
    res.json({ success: true, data: getTemplates() });
  } catch (error) {
    sendStrategyGeneratorError(res, error);
  }
};

exports.generate = (req, res) => {
  try {
    res.json({ success: true, data: generateStrategy(req.body) });
  } catch (error) {
    sendStrategyGeneratorError(res, error);
  }
};

exports.save = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Strategy template saved",
      data: await saveStrategy(req.body),
    });
  } catch (error) {
    sendStrategyGeneratorError(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    res.json({ success: true, data: await getHistory() });
  } catch (error) {
    sendStrategyGeneratorError(res, error);
  }
};
