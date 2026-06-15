const {
  evaluateRisk,
  saveConfig,
  activateKillSwitch,
  unlockRiskEngine,
  getEvents,
} = require("../services/riskEngine.service");

function sendRiskEngineError(res, error) {
  console.error("Risk engine request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Risk engine request failed",
  });
}

exports.status = async (req, res) => {
  try {
    res.json({ success: true, data: await evaluateRisk() });
  } catch (error) {
    sendRiskEngineError(res, error);
  }
};

exports.config = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Risk engine configuration saved",
      data: await saveConfig(req.body),
    });
  } catch (error) {
    sendRiskEngineError(res, error);
  }
};

exports.killSwitch = async (req, res) => {
  try {
    res.json({ success: true, data: await activateKillSwitch(req.body) });
  } catch (error) {
    sendRiskEngineError(res, error);
  }
};

exports.unlock = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Risk engine unlocked",
      data: await unlockRiskEngine(req.body),
    });
  } catch (error) {
    sendRiskEngineError(res, error);
  }
};

exports.events = async (req, res) => {
  try {
    res.json({ success: true, data: await getEvents() });
  } catch (error) {
    sendRiskEngineError(res, error);
  }
};
