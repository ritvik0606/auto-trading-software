const {
  getRiskSettings,
  saveRiskSettings,
  calculatePositionSize,
} = require("../services/risk.service");

function sendRiskError(res, error) {
  console.error("Risk request failed", {
    message: error.message,
    code: error.code,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Risk request failed",
  });
}

exports.getSettings = async (req, res) => {
  try {
    const settings = await getRiskSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    sendRiskError(res, error);
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const settings = await saveRiskSettings(req.body);

    res.status(201).json({
      success: true,
      message: "Risk settings saved",
      data: settings,
    });
  } catch (error) {
    sendRiskError(res, error);
  }
};

exports.calculate = async (req, res) => {
  try {
    const settings = await getRiskSettings();
    const result = calculatePositionSize(req.body, settings);
    res.json(result);
  } catch (error) {
    sendRiskError(res, error);
  }
};
