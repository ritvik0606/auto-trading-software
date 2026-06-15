const pool = require("../config/db");
const {
  getBrokerStatus: getSessionStatus,
} = require("./brokerSession.service");

const PRIMARY_BROKER = "ANGEL_ONE";
const SECONDARY_BROKER = "PAYTM_MONEY";
const SUPPORTED_BROKERS = new Set([
  PRIMARY_BROKER,
  SECONDARY_BROKER,
]);
const MONITOR_INTERVAL_MS = 5 * 60 * 1000;

let activeBroker = PRIMARY_BROKER;
let activeFailoverLogId = null;
let serviceStartedAt = Date.now();
let monitorRunning = false;
let lastFailedFailoverReason = null;
const healthMetrics = {
  ANGEL_ONE: {
    checks: 0,
    healthyChecks: 0,
    failures: 0,
    totalLatencyMs: 0,
    lastCheckAt: null,
    lastResult: null,
  },
  PAYTM_MONEY: {
    checks: 0,
    healthyChecks: 0,
    failures: 0,
    totalLatencyMs: 0,
    lastCheckAt: null,
    lastResult: null,
  },
};

class BrokerFailoverError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "BrokerFailoverError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function recordHealthMetric(broker, result) {
  const metric = healthMetrics[broker];
  metric.checks += 1;
  metric.totalLatencyMs += result.latencyMs;
  metric.lastCheckAt = result.checkedAt;
  metric.lastResult = result;

  if (result.healthy) {
    metric.healthyChecks += 1;
  } else {
    metric.failures += 1;
  }
}

async function checkAngelHealth() {
  const startedAt = Date.now();
  const status = getSessionStatus(PRIMARY_BROKER);
  const result = {
    broker: PRIMARY_BROKER,
    healthy: status.connected,
    apiAvailable: status.configured,
    sessionValid: status.sessionValid,
    latencyMs: status.latencyMs ?? Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    reason: status.connected
      ? null
      : status.reason || "Angel One session is not connected",
  };

  recordHealthMetric(PRIMARY_BROKER, result);
  return result;
}

async function checkPaytmHealth() {
  const startedAt = Date.now();
  const sessionStatus = getSessionStatus(SECONDARY_BROKER);
  const result = {
    broker: SECONDARY_BROKER,
    healthy: sessionStatus.connected,
    apiAvailable: sessionStatus.configured,
    sessionValid: sessionStatus.sessionValid,
    latencyMs: sessionStatus.latencyMs ?? Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    reason: sessionStatus.connected
      ? null
      : sessionStatus.reason || "Paytm Money session is not connected",
  };

  recordHealthMetric(SECONDARY_BROKER, result);
  return result;
}

async function checkBrokerHealth(broker) {
  if (broker === PRIMARY_BROKER) {
    return checkAngelHealth();
  }

  if (broker === SECONDARY_BROKER) {
    return checkPaytmHealth();
  }

  throw new BrokerFailoverError("Unsupported broker", 400);
}

async function createFailoverLog(reason, status = "ACTIVE") {
  const result = await pool.query(
    `INSERT INTO broker_failover_logs (
       primary_broker,
       secondary_broker,
       failure_reason,
       switch_time,
       status
     )
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
     RETURNING *`,
    [PRIMARY_BROKER, SECONDARY_BROKER, reason, status]
  );

  if (status === "ACTIVE") {
    activeFailoverLogId = result.rows[0].id;
  }
  return result.rows[0];
}

async function markRecovered(status = "RECOVERED") {
  if (!activeFailoverLogId) {
    return null;
  }

  const result = await pool.query(
    `UPDATE broker_failover_logs
     SET recovery_time = CURRENT_TIMESTAMP,
         status = $1
     WHERE id = $2
       AND recovery_time IS NULL
     RETURNING *`,
    [status, activeFailoverLogId]
  );
  activeFailoverLogId = null;
  return result.rows[0] || null;
}

async function switchBroker(targetBroker, reason, manual = false) {
  if (targetBroker === activeBroker) {
    throw new BrokerFailoverError(
      `${targetBroker} is already the active broker`,
      409
    );
  }

  const health = await checkBrokerHealth(targetBroker);
  if (!health.healthy) {
    throw new BrokerFailoverError(
      `${targetBroker} session is unavailable: ${health.reason}`,
      503
    );
  }

  if (targetBroker === SECONDARY_BROKER) {
    await createFailoverLog(
      manual ? "MANUAL_SWITCH" : reason || "PRIMARY_BROKER_UNAVAILABLE"
    );
  } else {
    await markRecovered(manual ? "MANUAL_SWITCHBACK" : "RECOVERED");
  }

  activeBroker = targetBroker;
  return {
    activeBroker,
    health,
    mode: "PAPER_ONLY",
  };
}

async function monitorBrokers() {
  if (monitorRunning) {
    return null;
  }

  monitorRunning = true;
  try {
    const angelHealth = await checkAngelHealth();
    let paytmHealth = healthMetrics.PAYTM_MONEY.lastResult;

    if (activeBroker === PRIMARY_BROKER && !angelHealth.healthy) {
      paytmHealth = await checkPaytmHealth();
      if (paytmHealth.healthy) {
        await createFailoverLog(angelHealth.reason);
        activeBroker = SECONDARY_BROKER;
        lastFailedFailoverReason = null;
      } else {
        const failureReason =
          `Primary unavailable: ${angelHealth.reason}; ` +
          `secondary unavailable: ${paytmHealth.reason}`;
        if (failureReason !== lastFailedFailoverReason) {
          await createFailoverLog(failureReason, "FAILED");
          lastFailedFailoverReason = failureReason;
        }
      }
    } else if (
      activeBroker === SECONDARY_BROKER &&
      angelHealth.healthy &&
      process.env.BROKER_AUTO_SWITCHBACK?.trim().toLowerCase() !== "false"
    ) {
      await markRecovered();
      activeBroker = PRIMARY_BROKER;
      lastFailedFailoverReason = null;
    }

    return { angelHealth, paytmHealth };
  } catch (error) {
    console.error("Broker failover monitor failed", {
      message: error.message,
    });
  } finally {
    monitorRunning = false;
  }
}

async function getBrokerFailoverStatus() {
  const monitored = await monitorBrokers();
  const angelHealth =
    monitored?.angelHealth ||
    healthMetrics.ANGEL_ONE.lastResult ||
    (await checkAngelHealth());
  const paytmHealth =
    monitored?.paytmHealth ||
    healthMetrics.PAYTM_MONEY.lastResult ||
    (await checkPaytmHealth());
  const activeHealth =
    activeBroker === PRIMARY_BROKER ? angelHealth : paytmHealth;

  return {
    primary: PRIMARY_BROKER,
    secondary: SECONDARY_BROKER,
    activeBroker,
    health: activeHealth.healthy ? "HEALTHY" : "UNAVAILABLE",
    mode: "PAPER_ONLY",
    brokers: {
      ANGEL_ONE: angelHealth,
      PAYTM_MONEY: paytmHealth,
    },
  };
}

function mapFailoverLog(row) {
  return {
    id: row.id,
    primaryBroker: row.primary_broker,
    secondaryBroker: row.secondary_broker,
    failureReason: row.failure_reason,
    switchTime: row.switch_time,
    recoveryTime: row.recovery_time,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function getFailoverHistory() {
  const result = await pool.query(
    `SELECT *
     FROM broker_failover_logs
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapFailoverLog);
}

async function manualSwitch(input = {}) {
  const broker =
    typeof input.broker === "string"
      ? input.broker.trim().toUpperCase()
      : "";

  if (!SUPPORTED_BROKERS.has(broker)) {
    throw new BrokerFailoverError(
      `broker must be one of: ${Array.from(SUPPORTED_BROKERS).join(", ")}`,
      400
    );
  }

  return switchBroker(broker, "MANUAL_SWITCH", true);
}

async function getBrokerMetrics() {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS failures,
       MAX(switch_time) AS last_switch_time
     FROM broker_failover_logs`
  );
  const row = result.rows[0];
  const formatBrokerMetrics = (broker) => {
    const metric = healthMetrics[broker];
    return {
      checks: metric.checks,
      failures: metric.failures,
      uptimePercent:
        metric.checks === 0
          ? null
          : round((metric.healthyChecks / metric.checks) * 100),
      averageLatencyMs:
        metric.checks === 0
          ? null
          : round(metric.totalLatencyMs / metric.checks),
      lastCheckAt: metric.lastCheckAt,
    };
  };

  return {
    serviceUptimeSeconds: round((Date.now() - serviceStartedAt) / 1000),
    failures: Number(row.failures),
    averageLatencyMs: {
      ANGEL_ONE: formatBrokerMetrics(PRIMARY_BROKER).averageLatencyMs,
      PAYTM_MONEY: formatBrokerMetrics(SECONDARY_BROKER).averageLatencyMs,
    },
    uptime: {
      ANGEL_ONE: formatBrokerMetrics(PRIMARY_BROKER).uptimePercent,
      PAYTM_MONEY: formatBrokerMetrics(SECONDARY_BROKER).uptimePercent,
    },
    lastSwitchTime: row.last_switch_time,
    activeBroker,
    mode: "PAPER_ONLY",
  };
}

const monitor = setInterval(monitorBrokers, MONITOR_INTERVAL_MS);
monitor.unref();

async function restoreFailoverState() {
  try {
    const result = await pool.query(
      `SELECT id
       FROM broker_failover_logs
       WHERE status = 'ACTIVE'
         AND recovery_time IS NULL
       ORDER BY switch_time DESC, id DESC
       LIMIT 1`
    );

    if (result.rows.length > 0) {
      activeBroker = SECONDARY_BROKER;
      activeFailoverLogId = result.rows[0].id;
    }
  } catch (error) {
    console.error("Unable to restore broker failover state", {
      message: error.message,
    });
  }
}

restoreFailoverState();

module.exports = {
  BrokerFailoverError,
  checkAngelHealth,
  checkPaytmHealth,
  monitorBrokers,
  getBrokerFailoverStatus,
  getFailoverHistory,
  manualSwitch,
  getBrokerMetrics,
};
