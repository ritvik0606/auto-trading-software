const pool = require("../config/db");
const { getBrokerStatus } = require("./broker.service");
const {
  getActiveStrategies: getLegacyActiveStrategies,
} = require("./strategy.service");
const {
  getStrategies,
  startStrategy,
  pauseStrategy,
  stopStrategy,
} = require("./multiStrategy.service");
const { getRiskStatus } = require("./riskDashboard.service");

const SUPPORTED_COMMANDS = new Set([
  "START_STRATEGY",
  "STOP_STRATEGY",
  "PAUSE_ALL",
  "RESUME_ALL",
  "KILL_SWITCH",
]);

class MobileControlError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "MobileControlError";
    this.statusCode = statusCode;
  }
}

function normalizeText(value, fieldName, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text || text.length > maxLength) {
    throw new MobileControlError(
      `${fieldName} is required and must not exceed ${maxLength} characters`,
      400
    );
  }

  return text;
}

function normalizeDeviceId(value) {
  const deviceId = normalizeText(value, "deviceId", 150);

  if (!/^[A-Za-z0-9_.:-]+$/.test(deviceId)) {
    throw new MobileControlError("deviceId is invalid", 400);
  }

  return deviceId;
}

function mapSession(row) {
  return {
    id: row.id,
    deviceName: row.device_name,
    deviceId: row.device_id,
    lastSeen: row.last_seen,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapNotification(row) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type,
    readStatus: row.read_status,
    createdAt: row.created_at,
  };
}

function mapCommand(row) {
  return {
    id: row.id,
    commandName: row.command_name,
    commandData: row.command_data || {},
    status: row.status,
    result: row.result_data || null,
    error: row.error_message || null,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  };
}

async function registerDevice(input = {}) {
  const deviceName = normalizeText(input.deviceName, "deviceName", 100);
  const deviceId = normalizeDeviceId(input.deviceId);

  try {
    const result = await pool.query(
      `INSERT INTO mobile_sessions (
         device_name,
         device_id,
         last_seen,
         status
       )
       VALUES ($1, $2, CURRENT_TIMESTAMP, 'ACTIVE')
       RETURNING *`,
      [deviceName, deviceId]
    );

    return mapSession(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new MobileControlError(
        "This device is already registered",
        409
      );
    }
    throw error;
  }
}

async function getActiveDevices() {
  const result = await pool.query(
    `SELECT *
     FROM mobile_sessions
     WHERE status = 'ACTIVE'
     ORDER BY last_seen DESC, id DESC`
  );

  return result.rows.map(mapSession);
}

async function createNotification(input = {}) {
  const title = normalizeText(input.title, "title", 150);
  const message = normalizeText(input.message, "message", 1000);
  const type = normalizeText(input.type, "type", 50).toUpperCase();

  if (!/^[A-Z][A-Z0-9_]*$/.test(type)) {
    throw new MobileControlError("type is invalid", 400);
  }

  const result = await pool.query(
    `INSERT INTO mobile_notifications (
       title,
       message,
       type,
       read_status
     )
     VALUES ($1, $2, $3, 'UNREAD')
     RETURNING *`,
    [title, message, type]
  );

  return mapNotification(result.rows[0]);
}

async function getNotifications() {
  const result = await pool.query(
    `SELECT *
     FROM mobile_notifications
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapNotification);
}

function normalizeCommand(input = {}) {
  const commandName =
    typeof input.commandName === "string"
      ? input.commandName.trim().toUpperCase()
      : "";
  const commandData = input.commandData ?? {};

  if (!commandName || commandName.length > 50) {
    throw new MobileControlError(
      "commandName is required and must not exceed 50 characters",
      400
    );
  }

  if (!SUPPORTED_COMMANDS.has(commandName)) {
    throw new MobileControlError(
      `commandName must be one of: ${Array.from(
        SUPPORTED_COMMANDS
      ).join(", ")}`,
      400
    );
  }

  if (
    !commandData ||
    typeof commandData !== "object" ||
    Array.isArray(commandData)
  ) {
    throw new MobileControlError("commandData must be an object", 400);
  }

  return { commandName, commandData };
}

function getStrategyId(commandData) {
  const strategyId = Number(commandData.strategyId);

  if (!Number.isInteger(strategyId) || strategyId <= 0) {
    throw new MobileControlError(
      "commandData.strategyId must be a positive integer",
      400
    );
  }

  return strategyId;
}

async function pauseAllStrategies() {
  const strategies = await getStrategies(true);
  const paused = [];

  for (const strategy of strategies) {
    paused.push(await pauseStrategy(strategy.id));
  }

  return { pausedCount: paused.length, strategies: paused };
}

async function resumeAllStrategies() {
  const strategies = await getStrategies();
  const paused = strategies.filter(
    (strategy) => strategy.status === "PAUSED"
  );
  const resumed = [];
  const failed = [];

  for (const strategy of paused) {
    try {
      resumed.push(await startStrategy(strategy.id));
    } catch (error) {
      failed.push({
        strategyId: strategy.id,
        message: error.message,
      });
    }
  }

  return {
    resumedCount: resumed.length,
    failedCount: failed.length,
    strategies: resumed,
    failed,
  };
}

async function executeInternalCommand(commandName, commandData) {
  switch (commandName) {
    case "START_STRATEGY":
      return startStrategy(getStrategyId(commandData));
    case "STOP_STRATEGY":
      return stopStrategy(getStrategyId(commandData));
    case "PAUSE_ALL":
      return pauseAllStrategies();
    case "RESUME_ALL":
      return resumeAllStrategies();
    case "KILL_SWITCH": {
      const { activate } = require("./killSwitch.service");
      return activate({
        confirmation: commandData.confirmation,
        reason: "Mobile control emergency command",
        autoRecovery: commandData.autoRecovery === true,
      });
    }
    default:
      throw new MobileControlError("Unsupported command", 400);
  }
}

async function executeCommand(input = {}) {
  const commandName =
    typeof input.commandName === "string"
      ? input.commandName.trim().toUpperCase()
      : "";
  const commandData = input.commandData ?? {};

  if (!commandName || commandName.length > 50) {
    throw new MobileControlError(
      "commandName is required and must not exceed 50 characters",
      400
    );
  }

  const inserted = await pool.query(
    `INSERT INTO mobile_commands (
       command_name,
       command_data,
       status
     )
     VALUES ($1, $2, 'PENDING')
     RETURNING *`,
    [commandName, commandData]
  );
  const command = inserted.rows[0];

  try {
    normalizeCommand({ commandName, commandData });
    const result = await executeInternalCommand(
      commandName,
      commandData
    );
    const updated = await pool.query(
      `UPDATE mobile_commands
       SET status = 'EXECUTED',
           result_data = $1,
           executed_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [result, command.id]
    );

    return mapCommand(updated.rows[0]);
  } catch (error) {
    await pool.query(
      `UPDATE mobile_commands
       SET status = 'FAILED',
           error_message = $1,
           executed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [error.message || "Command execution failed", command.id]
    );

    if (error.statusCode) {
      throw error;
    }
    throw new MobileControlError("Mobile command execution failed", 500);
  }
}

async function getCommandHistory() {
  const result = await pool.query(
    `SELECT *
     FROM mobile_commands
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapCommand);
}

async function getMobileDashboard() {
  const [
    strategyResult,
    portfolioResult,
    brokerStatus,
    riskStatus,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS count
       FROM multi_strategies
       WHERE status = 'ACTIVE'`
    ),
    pool.query(
      `SELECT
         (
           SELECT COUNT(*)
           FROM positions
           WHERE status = 'OPEN'
         ) AS open_positions,
         COALESCE(
           SUM(pnl) FILTER (
             WHERE status = 'CLOSED'
               AND COALESCE(closed_at, created_at)::date =
                 CURRENT_DATE
           ),
           0
         ) AS daily_pnl
       FROM paper_trades`
    ),
    getBrokerStatus(),
    getRiskStatus(),
  ]);
  const legacyActive = getLegacyActiveStrategies().length;
  const row = portfolioResult.rows[0];

  return {
    activeStrategies:
      Number(strategyResult.rows[0].count) + legacyActive,
    openPositions: Number(row.open_positions),
    dailyPnL: Number(row.daily_pnl),
    broker: "ANGEL_ONE",
    brokerConnected: brokerStatus.connected,
    status: riskStatus.tradingAllowed ? "RUNNING" : "LOCKED",
    mode: "PAPER_ONLY",
  };
}

async function getMobileHealth() {
  let database = "DISCONNECTED";

  try {
    await pool.query("SELECT 1");
    database = "CONNECTED";
  } catch (error) {
    console.error("Mobile database health check failed", {
      message: error.message,
    });
  }

  const brokerStatus = await getBrokerStatus();

  return {
    server: "ONLINE",
    database,
    broker: brokerStatus.connected ? "CONNECTED" : "DISCONNECTED",
  };
}

module.exports = {
  MobileControlError,
  registerDevice,
  getActiveDevices,
  createNotification,
  getNotifications,
  executeCommand,
  getCommandHistory,
  getMobileDashboard,
  getMobileHealth,
};
