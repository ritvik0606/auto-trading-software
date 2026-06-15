const service = require("../services/killSwitch.service");

function sendError(res, error) {
  console.error("Master kill switch request failed", {
    message: error.message,
  });
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Master kill switch request failed",
  });
}

exports.status = async (req, res) => {
  try {
    res.json({ success: true, data: await service.getStatus() });
  } catch (error) {
    sendError(res, error);
  }
};

exports.activate = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Master kill switch activated",
      data: await service.activate(req.body),
    });
  } catch (error) {
    sendError(res, error);
  }
};

exports.deactivate = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Master kill switch deactivated",
      data: await service.deactivate(req.body),
    });
  } catch (error) {
    sendError(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    res.json({ success: true, data: await service.getHistory() });
  } catch (error) {
    sendError(res, error);
  }
};
