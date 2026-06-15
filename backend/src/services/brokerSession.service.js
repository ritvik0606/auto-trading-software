const axios = require("axios");
const { loginAngel } = require("./angel.service");

const SESSION_TTL_MS = 10 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 10000;
const SUPPORTED_BROKERS = new Set(["ANGEL_ONE", "PAYTM_MONEY"]);

class BrokerSessionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "BrokerSessionError";
    this.statusCode = statusCode;
  }
}

const sessions = {
  ANGEL_ONE: {
    broker: "ANGEL_ONE",
    data: null,
    connectedAt: null,
    expiresAt: 0,
    lastCheckedAt: null,
    lastLatencyMs: null,
    lastError: null,
    manuallyDisconnected: false,
    connectPromise: null,
  },
  PAYTM_MONEY: {
    broker: "PAYTM_MONEY",
    data: null,
    connectedAt: null,
    expiresAt: 0,
    lastCheckedAt: null,
    lastLatencyMs: null,
    lastError: null,
    manuallyDisconnected: false,
    connectPromise: null,
  },
};

function realOrdersEnabled() {
  return process.env.ENABLE_REAL_ORDERS?.trim().toLowerCase() === "true";
}

function getPaytmConfiguration() {
  const required = [
    "PAYTM_API_KEY",
    "PAYTM_API_SECRET",
    "PAYTM_ACCESS_TOKEN",
    "PAYTM_HEALTH_URL",
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());

  return {
    configured: missing.length === 0,
    missing,
  };
}

function isSessionValid(session) {
  return Boolean(session.data) && Date.now() < session.expiresAt;
}

function publicStatus(broker) {
  const session = sessions[broker];
  const paytmConfig =
    broker === "PAYTM_MONEY" ? getPaytmConfiguration() : null;
  const configured =
    broker === "ANGEL_ONE"
      ? [
          "ANGEL_API_KEY",
          "ANGEL_CLIENT_CODE",
          "ANGEL_PIN",
          "ANGEL_TOTP_SECRET",
        ].every((name) => Boolean(process.env[name]?.trim()))
      : paytmConfig.configured;
  const connected = isSessionValid(session);

  return {
    broker,
    connected,
    sessionValid: connected,
    configured,
    connectedAt: session.connectedAt,
    lastLoginAt: session.connectedAt,
    expiresAt: connected
      ? new Date(session.expiresAt).toISOString()
      : null,
    lastCheckedAt: session.lastCheckedAt,
    latencyMs: session.lastLatencyMs,
    reason: connected ? null : session.lastError,
    mode: realOrdersEnabled() ? "REAL_ENABLED" : "PAPER_ONLY",
    realOrdersEnabled: realOrdersEnabled(),
  };
}

function normalizeBroker(value) {
  const broker =
    typeof value === "string" ? value.trim().toUpperCase() : "";

  if (!SUPPORTED_BROKERS.has(broker)) {
    throw new BrokerSessionError(
      `broker must be one of: ${Array.from(SUPPORTED_BROKERS).join(", ")}`,
      400
    );
  }

  return broker;
}

function storeSession(broker, data, startedAt) {
  const session = sessions[broker];
  const now = new Date();
  session.data = data;
  session.connectedAt = now.toISOString();
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  session.lastCheckedAt = now.toISOString();
  session.lastLatencyMs = Date.now() - startedAt;
  session.lastError = null;
  session.manuallyDisconnected = false;
  return publicStatus(broker);
}

function storeFailure(broker, error, startedAt) {
  const session = sessions[broker];
  session.data = null;
  session.expiresAt = 0;
  session.lastCheckedAt = new Date().toISOString();
  session.lastLatencyMs = Date.now() - startedAt;
  session.lastError = error.message || "Broker connection failed";
}

async function connectAngel() {
  const session = sessions.ANGEL_ONE;

  if (isSessionValid(session)) {
    return publicStatus("ANGEL_ONE");
  }

  if (!session.connectPromise) {
    const startedAt = Date.now();
    session.connectPromise = loginAngel()
      .then((result) => {
        if (!result.data?.jwtToken) {
          throw new BrokerSessionError(
            "Angel One login did not return a valid session",
            502
          );
        }
        return storeSession("ANGEL_ONE", result.data, startedAt);
      })
      .catch((error) => {
        storeFailure("ANGEL_ONE", error, startedAt);
        if (error instanceof BrokerSessionError) {
          throw error;
        }
        throw new BrokerSessionError(
          error.message || "Angel One connection failed",
          error.statusCode || 502
        );
      })
      .finally(() => {
        session.connectPromise = null;
      });
  }

  return session.connectPromise;
}

async function connectPaytm() {
  const session = sessions.PAYTM_MONEY;

  if (isSessionValid(session)) {
    return publicStatus("PAYTM_MONEY");
  }

  const configuration = getPaytmConfiguration();
  if (!configuration.configured) {
    const error = new BrokerSessionError(
      `Paytm Money is not configured. Missing: ${configuration.missing.join(", ")}`,
      503
    );
    storeFailure("PAYTM_MONEY", error, Date.now());
    throw error;
  }

  if (!session.connectPromise) {
    const startedAt = Date.now();
    session.connectPromise = axios
      .get(process.env.PAYTM_HEALTH_URL.trim(), {
        timeout: HEALTH_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${process.env.PAYTM_ACCESS_TOKEN.trim()}`,
          "x-api-key": process.env.PAYTM_API_KEY.trim(),
          Accept: "application/json",
        },
      })
      .then((response) => {
        if (
          response.status < 200 ||
          response.status >= 300 ||
          response.data?.status === false
        ) {
          throw new BrokerSessionError(
            "Paytm Money rejected the configured session",
            502
          );
        }

        return storeSession(
          "PAYTM_MONEY",
          { accessToken: process.env.PAYTM_ACCESS_TOKEN.trim() },
          startedAt
        );
      })
      .catch((error) => {
        const cleanError =
          error instanceof BrokerSessionError
            ? error
            : new BrokerSessionError(
                error.response?.data?.message ||
                  error.message ||
                  "Paytm Money connection failed",
                502
              );
        storeFailure("PAYTM_MONEY", cleanError, startedAt);
        throw cleanError;
      })
      .finally(() => {
        session.connectPromise = null;
      });
  }

  return session.connectPromise;
}

async function connectBroker(broker) {
  const normalized = normalizeBroker(broker);
  return normalized === "ANGEL_ONE"
    ? connectAngel()
    : connectPaytm();
}

function getBrokerSession(broker) {
  const normalized = normalizeBroker(broker);
  const session = sessions[normalized];

  if (session.manuallyDisconnected) {
    throw new BrokerSessionError(
      `${normalized} session was disconnected by user`,
      423
    );
  }

  if (!isSessionValid(session)) {
    session.data = null;
    session.expiresAt = 0;
    throw new BrokerSessionError(
      `${normalized} session is not connected`,
      503
    );
  }

  return session.data;
}

function disconnectBroker(broker) {
  const brokers = broker
    ? [normalizeBroker(broker)]
    : Array.from(SUPPORTED_BROKERS);

  for (const brokerName of brokers) {
    const session = sessions[brokerName];
    session.data = null;
    session.connectedAt = null;
    session.expiresAt = 0;
    session.lastCheckedAt = new Date().toISOString();
    session.lastLatencyMs = null;
    session.lastError = "Disconnected by user";
    session.manuallyDisconnected = true;
  }

  return {
    disconnected: brokers,
    sessions: brokers.map(publicStatus),
    mode: realOrdersEnabled() ? "REAL_ENABLED" : "PAPER_ONLY",
  };
}

function invalidateBrokerSession(broker, reason = "Broker session expired") {
  const normalized = normalizeBroker(broker);
  const session = sessions[normalized];
  session.data = null;
  session.expiresAt = 0;
  session.lastCheckedAt = new Date().toISOString();
  session.lastError = reason;
  session.manuallyDisconnected = false;
}

module.exports = {
  BrokerSessionError,
  connectAngel,
  connectPaytm,
  connectBroker,
  getBrokerSession,
  getBrokerStatus: publicStatus,
  disconnectBroker,
  invalidateBrokerSession,
};
