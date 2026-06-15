const service = require("../services/paperSimulator.service");

function sendError(res, error) {
  console.error("Paper simulator request failed", {
    message: error.message,
  });
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Paper simulator request failed",
  });
}

exports.account = async (req, res) => {
  try {
    res.json({ success: true, data: await service.getAccount() });
  } catch (error) {
    sendError(res, error);
  }
};

exports.order = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Simulator order filled",
      data: await service.placeOrder(req.body),
    });
  } catch (error) {
    sendError(res, error);
  }
};

exports.positions = async (req, res) => {
  try {
    res.json({ success: true, data: await service.getPositions() });
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

exports.reset = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Paper simulator reset",
      data: await service.resetSimulator(req.body),
    });
  } catch (error) {
    sendError(res, error);
  }
};
