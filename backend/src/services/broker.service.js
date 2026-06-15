const {
  getBrokerStatus: getSessionStatus,
} = require("./brokerSession.service");

const getBrokerStatus = async () => {
  const status = getSessionStatus("ANGEL_ONE");
  return {
    broker: "Angel One",
    connected: status.connected,
    sessionValid: status.sessionValid,
    connectedAt: status.connectedAt,
    mode: status.mode,
  };
};

module.exports = {
  getBrokerStatus,
};
