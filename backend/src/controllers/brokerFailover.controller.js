const {
  getBrokerFailoverStatus,
  getFailoverHistory,
  manualSwitch,
  getBrokerMetrics,
} = require("../services/brokerFailover.service");

function sendFailoverError(res, error) {
  console.error("Broker failover request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Broker failover request failed",
  });
}

exports.status = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getBrokerFailoverStatus(),
    });
  } catch (error) {
    sendFailoverError(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getFailoverHistory(),
    });
  } catch (error) {
    sendFailoverError(res, error);
  }
};

exports.switchBroker = async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Paper execution broker switched",
      data: await manualSwitch(req.body),
    });
  } catch (error) {
    sendFailoverError(res, error);
  }
};

exports.metrics = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getBrokerMetrics(),
    });
  } catch (error) {
    sendFailoverError(res, error);
  }
};
