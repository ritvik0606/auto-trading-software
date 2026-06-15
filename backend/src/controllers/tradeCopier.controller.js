const {
  createGroup,
  addFollower,
  startCopier,
  stopCopier,
  getGroupStatus,
  getTradeHistory,
  getExecutionSummary,
} = require("../services/tradeCopier.service");

function sendTradeCopierError(res, error) {
  console.error("Trade copier request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Trade copier request failed",
  });
}

exports.createGroup = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Trade copier group created",
      data: await createGroup(req.body),
    });
  } catch (error) {
    sendTradeCopierError(res, error);
  }
};

exports.addFollower = async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      message: "Follower added",
      data: await addFollower(req.body),
    });
  } catch (error) {
    sendTradeCopierError(res, error);
  }
};

function groupHandler(service, message) {
  return async (req, res) => {
    try {
      res.json({
        success: true,
        message,
        data: await service(req.params.groupId),
      });
    } catch (error) {
      sendTradeCopierError(res, error);
    }
  };
}

exports.start = groupHandler(startCopier, "Trade copier started");
exports.stop = groupHandler(stopCopier, "Trade copier stopped");
exports.status = groupHandler(getGroupStatus, "Trade copier status");
exports.history = groupHandler(getTradeHistory, "Trade copier history");
exports.summary = groupHandler(
  getExecutionSummary,
  "Trade copier execution summary"
);
