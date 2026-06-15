const {
  createAlert,
  getAlerts,
  deleteAlert,
  getAlertSummary,
} = require("../services/alerts.service");

function sendAlertError(res, error) {
  console.error("Alert request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Alert request failed",
  });
}

exports.create = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Alert created",
      data: await createAlert(req.body),
    });
  } catch (error) {
    sendAlertError(res, error);
  }
};

exports.all = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getAlerts(),
    });
  } catch (error) {
    sendAlertError(res, error);
  }
};

exports.remove = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Alert deleted",
      data: await deleteAlert(req.params.id),
    });
  } catch (error) {
    sendAlertError(res, error);
  }
};

exports.summary = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getAlertSummary(),
    });
  } catch (error) {
    sendAlertError(res, error);
  }
};
