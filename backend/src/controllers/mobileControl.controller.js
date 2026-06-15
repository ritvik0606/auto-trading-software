const {
  registerDevice,
  getActiveDevices,
  createNotification,
  getNotifications,
  executeCommand,
  getCommandHistory,
  getMobileDashboard,
  getMobileHealth,
} = require("../services/mobileControl.service");

function sendMobileError(res, error) {
  console.error("Mobile control request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Mobile control request failed",
  });
}

function handler(service) {
  return async (req, res) => {
    try {
      res.json({ success: true, data: await service(req) });
    } catch (error) {
      sendMobileError(res, error);
    }
  };
}

exports.register = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Mobile device registered",
      data: await registerDevice(req.body),
    });
  } catch (error) {
    sendMobileError(res, error);
  }
};

exports.devices = handler(() => getActiveDevices());

exports.notify = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Mobile notification created",
      data: await createNotification(req.body),
    });
  } catch (error) {
    sendMobileError(res, error);
  }
};

exports.notifications = handler(() => getNotifications());

exports.command = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Mobile command executed",
      data: await executeCommand(req.body),
    });
  } catch (error) {
    sendMobileError(res, error);
  }
};

exports.commands = handler(() => getCommandHistory());
exports.dashboard = handler(() => getMobileDashboard());
exports.health = handler(() => getMobileHealth());
