const { loginAngel } = require("./angel.service");

const STATUS_TTL_MS = 10 * 60 * 1000;

let cachedStatus;
let statusExpiresAt = 0;

const getBrokerStatus = async () => {
  if (cachedStatus && Date.now() < statusExpiresAt) {
    return cachedStatus;
  }

  try {
    await loginAngel();
    cachedStatus = {
      broker: "Angel One",
      connected: true,
    };
    statusExpiresAt = Date.now() + STATUS_TTL_MS;
    return cachedStatus;
  } catch (error) {
    return {
      broker: "Angel One",
      connected: false,
    };
  }
};

module.exports = {
  getBrokerStatus,
};
