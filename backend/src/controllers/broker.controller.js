const {
  connectAngel,
  connectPaytm,
  getBrokerStatus,
  disconnectBroker,
} = require("../services/brokerSession.service");

function sendBrokerError(res, error) {
  console.error("Broker connection request failed", {
    message: error.message,
    statusCode: error.statusCode,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Broker connection request failed",
  });
}

function statusHandler(broker) {
  return (req, res) => {
    try {
      res.json({ success: true, data: getBrokerStatus(broker) });
    } catch (error) {
      sendBrokerError(res, error);
    }
  };
}

function connectHandler(service, brokerLabel) {
  return async (req, res) => {
    try {
      const data = await service();
      if (data.broker === "ANGEL_ONE") {
        require("../services/angelWebSocket.service")
          .startAngelMarketStream()
          .catch(() => {});
      }
      res.json({
        success: true,
        message: `${brokerLabel} connected`,
        data,
      });
    } catch (error) {
      sendBrokerError(res, error);
    }
  };
}

exports.angelStatus = statusHandler("ANGEL_ONE");
exports.paytmStatus = statusHandler("PAYTM_MONEY");
exports.connectAngel = connectHandler(connectAngel, "Angel One");
exports.connectPaytm = connectHandler(connectPaytm, "Paytm Money");

exports.disconnect = (req, res) => {
  try {
    const broker =
      typeof req.body?.broker === "string"
        ? req.body.broker.trim().toUpperCase()
        : null;
    if (!broker || broker === "ANGEL_ONE") {
      require("../services/angelWebSocket.service")
        .stopAngelMarketStream();
    }
    res.json({
      success: true,
      message: "Broker session disconnected",
      data: disconnectBroker(req.body?.broker),
    });
  } catch (error) {
    sendBrokerError(res, error);
  }
};
