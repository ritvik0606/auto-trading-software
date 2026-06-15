const {
  getRiskDashboard,
  getRiskRules,
  createRiskRules,
  updateRiskRules,
  getRiskStatus,
  activateKillSwitch,
} = require("../services/riskDashboard.service");

function sendRiskDashboardError(res, error) {
  console.error("Risk dashboard request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Risk dashboard request failed",
  });
}

exports.dashboard = async (req, res) => {
  try {
    res.json({ success: true, data: await getRiskDashboard() });
  } catch (error) {
    sendRiskDashboardError(res, error);
  }
};

exports.createRules = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Risk rules created",
      data: await createRiskRules(req.body),
    });
  } catch (error) {
    sendRiskDashboardError(res, error);
  }
};

exports.getRules = async (req, res) => {
  try {
    res.json({ success: true, data: await getRiskRules() });
  } catch (error) {
    sendRiskDashboardError(res, error);
  }
};

exports.updateRules = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Risk rules updated",
      data: await updateRiskRules(req.body),
    });
  } catch (error) {
    sendRiskDashboardError(res, error);
  }
};

exports.killSwitch = async (req, res) => {
  try {
    res.json({ success: true, data: await activateKillSwitch() });
  } catch (error) {
    sendRiskDashboardError(res, error);
  }
};

exports.status = async (req, res) => {
  try {
    res.json({ success: true, data: await getRiskStatus() });
  } catch (error) {
    sendRiskDashboardError(res, error);
  }
};
