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
const MONITOR_INTERVAL_MS = 30 * 1000;

let activeBroker = PRIMARY_BROKER;
let manualOverride = null;
let activeFailoverLogId = null;
let serviceStartedAt = Date.now();
let heartbeatRunning = false;
let heartbeatTimer = null;
let lastHeartbeatAt = null;
let lastHeartbeatError = null;
let lastFailedFailoverReason = null;

const healthMetrics = {
  ANGEL_ONE: createMetric(),
  PAYTM_MONEY: createMetric(),
};

class BrokerFailoverError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "BrokerFailoverError";
    this.statusCode = statusCode;
  }
}

function createMetric() {
  return {
    checks: 0,
    healthyChecks: 0,
    failures: 0,
    totalLatencyMs: 0,
    lastCheckAt: null,
    lastResult: null,
  };
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
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

async function checkBrokerHealth(broker) {
  if (!SUPPORTED_BROKERS.has(broker)) {
    throw new BrokerFailoverError("Unsupported broker", 400);
  }

  const startedAt = Date.now();
  const status = getSessionStatus(broker);
  const result = {
    broker,
    healthy: Boolean(status.connected && status.sessionValid),
    configured: Boolean(status.configured),
    apiAvailable: Boolean(status.configured),
    sessionValid: Boolean(status.sessionValid),
    connected: Boolean(status.connected),
    latencyMs: Number(status.latencyMs ?? Date.now() - startedAt),
    checkedAt: new Date().toISOString(),
    connectedAt: status.connectedAt,
    expiresAt: status.expiresAt,
    reason: status.connected
      ? null
      : status.reason || `${broker} session is not connected`,
  };

  recordHealthMetric(broker, result);
  return result;
}

const checkAngelHealth = () => checkBrokerHealth(PRIMARY_BROKER);
const checkPaytmHealth = () => checkBrokerHealth(SECONDARY_BROKER);

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
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "BROKER",
    action: `BROKER_FAILOVER_${status}`,
    severity: status === "FAILED" ? "ERROR" : "WARNING",
    entityType: "BROKER_FAILOVER",
    entityId: result.rows[0].id,
    message: reason,
    metadata: {
      primaryBroker: PRIMARY_BROKER,
      secondaryBroker: SECONDARY_BROKER,
      status,
    },
  });
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
  if (result.rows[0]) {
    const { safeRecordAudit } = require("./auditTrail.service");
    await safeRecordAudit({
      category: "BROKER",
      action: "BROKER_RECOVERED",
      severity: "INFO",
      entityType: "BROKER_FAILOVER",
      entityId: result.rows[0].id,
      message: `Primary broker recovery recorded as ${status}`,
      metadata: { status },
    });
  }
  return result.rows[0] || null;
}

async function switchAutomatically(targetBroker, reason) {
  const previousBroker = activeBroker;

  if (targetBroker === SECONDARY_BROKER) {
    await createFailoverLog(reason, "ACTIVE");
  } else {
    await markRecovered("RECOVERED");
  }

  activeBroker = targetBroker;
  lastFailedFailoverReason = null;
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "BROKER",
    action: "BROKER_AUTO_SWITCH",
    severity: "WARNING",
    entityType: "BROKER",
    entityId: targetBroker,
    message: reason,
    metadata: { previousBroker, activeBroker },
  });
  return { previousBroker, activeBroker };
}

async function recordFailedHeartbeat(reason) {
  if (reason === lastFailedFailoverReason) {
    return;
  }

  const latest = await pool.query(
    `SELECT failure_reason
     FROM broker_failover_logs
     WHERE status = 'FAILED'
       AND recovery_time IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  );
  if (latest.rows[0]?.failure_reason === reason) {
    lastFailedFailoverReason = reason;
    return;
  }

  await createFailoverLog(reason, "FAILED");
  lastFailedFailoverReason = reason;
}

async function runHeartbeat() {
  if (heartbeatRunning) {
    return null;
  }

  heartbeatRunning = true;
  try {
    const [angelHealth, paytmHealth] = await Promise.all([
      checkAngelHealth(),
      checkPaytmHealth(),
    ]);

    if (!manualOverride) {
      if (activeBroker === PRIMARY_BROKER && !angelHealth.healthy) {
        if (paytmHealth.healthy) {
          await switchAutomatically(
            SECONDARY_BROKER,
            `AUTO_FAILOVER: ${angelHealth.reason}`
          );
        } else {
          await recordFailedHeartbeat(
            `Both brokers unavailable. Angel One: ${angelHealth.reason}; Paytm Money: ${paytmHealth.reason}`
          );
        }
      } else if (activeBroker === SECONDARY_BROKER) {
        const autoSwitchback =
          process.env.BROKER_AUTO_SWITCHBACK?.trim().toLowerCase() !==
          "false";
        if (
          angelHealth.healthy &&
          (autoSwitchback || !paytmHealth.healthy)
        ) {
          await switchAutomatically(
            PRIMARY_BROKER,
            "PRIMARY_BROKER_RECOVERED"
          );
        } else if (!paytmHealth.healthy && !angelHealth.healthy) {
          await recordFailedHeartbeat(
            `Both brokers unavailable. Angel One: ${angelHealth.reason}; Paytm Money: ${paytmHealth.reason}`
          );
        }
      } else {
        lastFailedFailoverReason = null;
      }
    }

    lastHeartbeatAt = new Date().toISOString();
    lastHeartbeatError = null;
    return {
      checkedAt: lastHeartbeatAt,
      brokers: {
        ANGEL_ONE: angelHealth,
        PAYTM_MONEY: paytmHealth,
      },
    };
  } catch (error) {
    lastHeartbeatAt = new Date().toISOString();
    lastHeartbeatError =
      error.message || "Broker failover heartbeat failed";
    console.error("Broker failover heartbeat failed", {
      message: lastHeartbeatError,
    });
    return null;
  } finally {
    heartbeatRunning = false;
  }
}

function startHeartbeat() {
  if (heartbeatTimer) {
    return;
  }

  setImmediate(() => runHeartbeat());
  heartbeatTimer = setInterval(runHeartbeat, MONITOR_INTERVAL_MS);
  heartbeatTimer.unref();
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function getBrokerFailoverStatus() {
  const heartbeat = await runHeartbeat();
  const angelHealth =
    heartbeat?.brokers?.ANGEL_ONE ||
    healthMetrics.ANGEL_ONE.lastResult ||
    (await checkAngelHealth());
  const paytmHealth =
    heartbeat?.brokers?.PAYTM_MONEY ||
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
    overrideMode: manualOverride ? "MANUAL" : "AUTO",
    manualOverride,
    heartbeat: {
      intervalSeconds: MONITOR_INTERVAL_MS / 1000,
      running: Boolean(heartbeatTimer),
      checkInProgress: heartbeatRunning,
      lastHeartbeatAt,
      lastError: lastHeartbeatError,
    },
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

async function getFailoverLogs() {
  const result = await pool.query(
    `SELECT *
     FROM broker_failover_logs
     ORDER BY created_at DESC, id DESC
     LIMIT 500`
  );

  return result.rows.map(mapFailoverLog);
}

async function manualSwitch(input = {}) {
  const requestedBroker =
    typeof input.broker === "string"
      ? input.broker.trim().toUpperCase()
      : "";

  if (requestedBroker === "AUTO") {
    const previousOverride = manualOverride;
    manualOverride = null;
    await createFailoverLog(
      `MANUAL_OVERRIDE_RELEASED: ${previousOverride || "NONE"}`,
      "AUTO_MODE"
    );
    await runHeartbeat();
    return getBrokerFailoverStatus();
  }

  if (!SUPPORTED_BROKERS.has(requestedBroker)) {
    throw new BrokerFailoverError(
      `broker must be one of: ${Array.from(
        SUPPORTED_BROKERS
      ).join(", ")}, AUTO`,
      400
    );
  }

  const health = await checkBrokerHealth(requestedBroker);
  const force = input.force === true;
  if (!health.healthy && !force) {
    throw new BrokerFailoverError(
      `${requestedBroker} session is unavailable: ${health.reason}`,
      503
    );
  }

  const previousBroker = activeBroker;
  if (
    previousBroker === SECONDARY_BROKER &&
    requestedBroker === PRIMARY_BROKER
  ) {
    await markRecovered("MANUAL_SWITCHBACK");
  }

  activeBroker = requestedBroker;
  manualOverride = requestedBroker;
  await createFailoverLog(
    `MANUAL_OVERRIDE: ${previousBroker} -> ${requestedBroker}${
      force && !health.healthy ? " (FORCED_UNHEALTHY)" : ""
    }`,
    "MANUAL_OVERRIDE"
  );

  const response = {
    activeBroker,
    previousBroker,
    health,
    overrideMode: "MANUAL",
    manualOverride,
    mode: "PAPER_ONLY",
  };
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "BROKER",
    action: "BROKER_MANUAL_SWITCH",
    severity: "WARNING",
    entityType: "BROKER",
    entityId: requestedBroker,
    message: `Manual broker switch: ${previousBroker} -> ${requestedBroker}`,
    metadata: {
      previousBroker,
      activeBroker,
      forced: force && !health.healthy,
    },
  });
  return response;
}

function formatBrokerMetrics(broker) {
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
}

async function getBrokerMetrics() {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE status IN ('ACTIVE', 'FAILED')
       ) AS failures,
       COUNT(*) AS events,
       MAX(switch_time) AS last_switch_time
     FROM broker_failover_logs`
  );
  const row = result.rows[0];

  return {
    serviceUptimeSeconds: round((Date.now() - serviceStartedAt) / 1000),
    failures: Number(row.failures),
    events: Number(row.events),
    averageLatencyMs: {
      ANGEL_ONE: formatBrokerMetrics(PRIMARY_BROKER).averageLatencyMs,
      PAYTM_MONEY: formatBrokerMetrics(SECONDARY_BROKER).averageLatencyMs,
    },
    uptime: {
      ANGEL_ONE: formatBrokerMetrics(PRIMARY_BROKER).uptimePercent,
      PAYTM_MONEY: formatBrokerMetrics(SECONDARY_BROKER).uptimePercent,
    },
    checks: {
      ANGEL_ONE: formatBrokerMetrics(PRIMARY_BROKER).checks,
      PAYTM_MONEY: formatBrokerMetrics(SECONDARY_BROKER).checks,
    },
    lastSwitchTime: row.last_switch_time,
    lastHeartbeatAt,
    heartbeatIntervalSeconds: MONITOR_INTERVAL_MS / 1000,
    activeBroker,
    overrideMode: manualOverride ? "MANUAL" : "AUTO",
    mode: "PAPER_ONLY",
  };
}

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
  } finally {
    startHeartbeat();
  }
}

restoreFailoverState();

module.exports = {
  BrokerFailoverError,
  checkAngelHealth,
  checkPaytmHealth,
  runHeartbeat,
  startHeartbeat,
  stopHeartbeat,
  getBrokerFailoverStatus,
  getFailoverHistory: getFailoverLogs,
  getFailoverLogs,
  manualSwitch,
  getBrokerMetrics,
};
