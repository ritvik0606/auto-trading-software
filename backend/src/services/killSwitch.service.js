const pool = require("../config/db");

const ACTIVATE_CONFIRMATION = "ACTIVATE";
const DEACTIVATE_CONFIRMATION = "DEACTIVATE";
let schemaReady = null;

class KillSwitchError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "KillSwitchError";
    this.statusCode = statusCode;
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { ensureSchema: ensureRiskSchema } = require(
        "./riskEngine.service"
      );
      const { ensureSchema: ensureSimulatorSchema } = require(
        "./paperSimulator.service"
      );
      const { ensureSchema: ensureExecutionSchema } = require(
        "./executionAnalytics.service"
      );
      await ensureRiskSchema();
      await ensureSimulatorSchema();
      await ensureExecutionSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS master_kill_switch (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          active BOOLEAN NOT NULL DEFAULT FALSE,
          trigger_type VARCHAR(30),
          reason TEXT,
          auto_recovery BOOLEAN NOT NULL DEFAULT FALSE,
          activated_at TIMESTAMP,
          deactivated_at TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS master_kill_switch_history (
          id SERIAL PRIMARY KEY,
          action VARCHAR(20) NOT NULL,
          trigger_type VARCHAR(30) NOT NULL,
          reason TEXT,
          auto_recovery BOOLEAN NOT NULL DEFAULT FALSE,
          cancelled_orders INTEGER NOT NULL DEFAULT 0,
          stopped_strategies INTEGER NOT NULL DEFAULT 0,
          broker_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(
        `INSERT INTO master_kill_switch (id)
         VALUES (1)
         ON CONFLICT (id) DO NOTHING`
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function requireConfirmation(input, expected) {
  if (input?.confirmation !== expected) {
    throw new KillSwitchError(
      `confirmation must be "${expected}"`,
      400
    );
  }
}

async function getState(client = pool) {
  await ensureSchema();
  const result = await client.query(
    `SELECT * FROM master_kill_switch WHERE id = 1`
  );
  return result.rows[0];
}

async function brokerSnapshot() {
  try {
    const {
      getBrokerFailoverStatus,
    } = require("./brokerFailover.service");
    const status = await getBrokerFailoverStatus();
    return {
      activeBroker: status.activeBroker,
      health: status.health,
      overrideMode: status.overrideMode,
      mode: status.mode,
    };
  } catch (error) {
    return {
      activeBroker: null,
      health: "UNAVAILABLE",
      error: error.message,
    };
  }
}

async function stopAllTradingStrategies() {
  const { stopAutoTrade } = require("./autoTrade.service");
  const { stopAllStrategies } = require("./strategy.service");
  const {
    stopAllStrategies: stopAllMultiStrategies,
  } = require("./multiStrategy.service");

  const autoTrade = stopAutoTrade({});
  const legacy = stopAllStrategies();
  const multi = await stopAllMultiStrategies();
  return {
    autoTrade,
    legacy,
    multi,
    total: autoTrade.length + legacy.length + multi.length,
  };
}

async function cancelPendingOrders() {
  const result = await pool.query(
    `UPDATE orders
     SET status = 'CANCELLED',
         reason = CASE
           WHEN reason IS NULL OR reason = ''
             THEN 'Cancelled by master kill switch'
           ELSE reason || '; Cancelled by master kill switch'
         END,
         rejected_at = COALESCE(rejected_at, CURRENT_TIMESTAMP),
         last_status_at = CURRENT_TIMESTAMP
     WHERE UPPER(COALESCE(status, '')) IN (
       'PENDING', 'SUBMITTED', 'OPEN', 'PARTIAL'
     )
     RETURNING id, symbol, side, quantity`
  );
  const { safeRecordAudit } = require("./auditTrail.service");
  for (const order of result.rows) {
    await safeRecordAudit({
      category: "ORDER",
      action: "ORDER_CANCELLED",
      severity: "WARNING",
      entityType: "ORDER",
      entityId: order.id,
      message: "Pending order cancelled by master kill switch",
      metadata: {
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
      },
    });
  }
  return result.rows.map((row) => row.id);
}

async function syncRiskLocks(active, reason = null) {
  await pool.query(
    `UPDATE risk_engine_config
     SET risk_locked = $1,
         kill_switch_active = $1,
         lock_reason = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [active, active ? reason : null]
  );
  await pool.query(
    `INSERT INTO risk_rules (id, kill_switch_active, orders_disabled)
     VALUES (1, $1, $1)
     ON CONFLICT (id)
     DO UPDATE SET
       kill_switch_active = EXCLUDED.kill_switch_active,
       orders_disabled = EXCLUDED.orders_disabled,
       updated_at = CURRENT_TIMESTAMP`,
    [active]
  );
}

async function recordHistory({
  action,
  triggerType,
  reason,
  autoRecovery,
  cancelledOrders = 0,
  stoppedStrategies = 0,
  broker,
  metadata = {},
}) {
  const result = await pool.query(
    `INSERT INTO master_kill_switch_history (
       action, trigger_type, reason, auto_recovery, cancelled_orders,
       stopped_strategies, broker_snapshot, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     RETURNING *`,
    [
      action,
      triggerType,
      reason,
      autoRecovery,
      cancelledOrders,
      stoppedStrategies,
      JSON.stringify(broker || {}),
      JSON.stringify(metadata),
    ]
  );
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "KILL_SWITCH",
    action,
    severity: action === "ACTIVATED" ? "ERROR" : "WARNING",
    entityType: "MASTER_KILL_SWITCH",
    entityId: 1,
    message: reason,
    metadata: {
      triggerType,
      autoRecovery,
      cancelledOrders,
      stoppedStrategies,
      broker,
      ...metadata,
    },
  });
  return result.rows[0];
}

async function activateInternal({
  triggerType,
  reason,
  autoRecovery = false,
  metadata = {},
}) {
  await ensureSchema();
  const state = await getState();
  if (state.active) {
    return getStatus();
  }

  const [strategies, cancelledOrderIds, broker] = await Promise.all([
    stopAllTradingStrategies(),
    cancelPendingOrders(),
    brokerSnapshot(),
  ]);
  const lockReason = reason || "Master kill switch activated";

  await pool.query(
    `UPDATE master_kill_switch
     SET active = TRUE,
         trigger_type = $1,
         reason = $2,
         auto_recovery = $3,
         activated_at = CURRENT_TIMESTAMP,
         deactivated_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [triggerType, lockReason, autoRecovery]
  );
  await syncRiskLocks(true, lockReason);
  await recordHistory({
    action: "ACTIVATED",
    triggerType,
    reason: lockReason,
    autoRecovery,
    cancelledOrders: cancelledOrderIds.length,
    stoppedStrategies: strategies.total,
    broker,
    metadata: {
      ...metadata,
      cancelledOrderIds,
      stopped: strategies,
    },
  });
  return getStatus();
}

async function activate(input = {}) {
  requireConfirmation(input, ACTIVATE_CONFIRMATION);
  return activateInternal({
    triggerType: "MANUAL",
    reason:
      typeof input.reason === "string" && input.reason.trim()
        ? input.reason.trim().slice(0, 1000)
        : "Manual master kill switch activation",
    autoRecovery: input.autoRecovery === true,
  });
}

async function activateForDailyLoss(details = {}) {
  return activateInternal({
    triggerType: "DAILY_LOSS_BREACH",
    reason: "Daily loss limit reached",
    autoRecovery: details.autoRecovery === true,
    metadata: details,
  });
}

async function currentDailyLoss() {
  const result = await pool.query(
    `SELECT
       GREATEST(-COALESCE(SUM(pnl), 0), 0) AS daily_loss,
       COALESCE(
         (
           SELECT daily_loss_limit
           FROM risk_engine_config
           WHERE id = 1
         ),
         0
       ) AS daily_loss_limit
     FROM (
       SELECT pnl
       FROM paper_trades
       WHERE status = 'CLOSED'
         AND COALESCE(closed_at, created_at)::date = CURRENT_DATE
       UNION ALL
       SELECT realized_pnl AS pnl
       FROM paper_simulator_positions
       WHERE status = 'CLOSED'
         AND COALESCE(closed_at, created_at)::date = CURRENT_DATE
     ) daily_results`
  );
  return {
    dailyLoss: Number(result.rows[0].daily_loss),
    dailyLossLimit: Number(result.rows[0].daily_loss_limit),
  };
}

async function deactivateInternal({
  triggerType,
  reason,
  metadata = {},
}) {
  const state = await getState();
  if (!state.active) return getStatus();

  const broker = await brokerSnapshot();
  await pool.query(
    `UPDATE master_kill_switch
     SET active = FALSE,
         trigger_type = $1,
         reason = $2,
         auto_recovery = FALSE,
         deactivated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [triggerType, reason]
  );
  await syncRiskLocks(false);
  await recordHistory({
    action: "DEACTIVATED",
    triggerType,
    reason,
    autoRecovery: false,
    broker,
    metadata,
  });
  return getStatus();
}

async function deactivate(input = {}) {
  requireConfirmation(input, DEACTIVATE_CONFIRMATION);
  const loss = await currentDailyLoss();
  if (
    loss.dailyLossLimit > 0 &&
    loss.dailyLoss >= loss.dailyLossLimit &&
    input.force !== true
  ) {
    throw new KillSwitchError(
      "Daily loss limit is still breached; set force=true to confirm recovery",
      409
    );
  }
  return deactivateInternal({
    triggerType: "MANUAL_RECOVERY",
    reason:
      typeof input.reason === "string" && input.reason.trim()
        ? input.reason.trim().slice(0, 1000)
        : "Manual master kill switch recovery",
    metadata: { forced: input.force === true },
  });
}

async function attemptAutoRecovery(state) {
  if (
    !state.active ||
    !state.auto_recovery ||
    state.trigger_type !== "DAILY_LOSS_BREACH" ||
    !state.activated_at
  ) {
    return null;
  }
  const activatedDate = new Date(state.activated_at)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (activatedDate === today) return null;

  const loss = await currentDailyLoss();
  if (loss.dailyLoss < loss.dailyLossLimit || loss.dailyLossLimit === 0) {
    return deactivateInternal({
      triggerType: "AUTO_RECOVERY",
      reason: "Automatic recovery after daily loss window reset",
      metadata: loss,
    });
  }
  return null;
}

async function getStatus() {
  await ensureSchema();
  let state = await getState();
  const recovered = await attemptAutoRecovery(state);
  if (recovered) return recovered;
  state = await getState();
  const [loss, broker, pendingOrders] = await Promise.all([
    currentDailyLoss(),
    brokerSnapshot(),
    pool.query(
      `SELECT COUNT(*) AS count
       FROM orders
       WHERE UPPER(COALESCE(status, '')) IN (
         'PENDING', 'SUBMITTED', 'OPEN', 'PARTIAL'
      )`
    ),
  ]);
  if (
    !state.active &&
    loss.dailyLossLimit > 0 &&
    loss.dailyLoss >= loss.dailyLossLimit
  ) {
    return activateForDailyLoss({
      dailyLoss: loss.dailyLoss,
      dailyLossLimit: loss.dailyLossLimit,
      autoRecovery: true,
    });
  }
  return {
    active: state.active,
    tradingEnabled: !state.active,
    status: state.active ? "EMERGENCY_STOP" : "TRADING_ENABLED",
    triggerType: state.trigger_type,
    reason: state.reason,
    autoRecovery: state.auto_recovery,
    activatedAt: state.activated_at,
    deactivatedAt: state.deactivated_at,
    updatedAt: state.updated_at,
    pendingOrders: Number(pendingOrders.rows[0].count),
    dailyLoss: loss.dailyLoss,
    dailyLossLimit: loss.dailyLossLimit,
    broker,
    confirmation: {
      activate: ACTIVATE_CONFIRMATION,
      deactivate: DEACTIVATE_CONFIRMATION,
    },
  };
}

async function assertTradingAllowed() {
  await ensureSchema();
  let state = await getState();
  const recovered = await attemptAutoRecovery(state);
  if (recovered) {
    state = await getState();
  }
  if (!state.active) {
    const loss = await currentDailyLoss();
    if (
      loss.dailyLossLimit > 0 &&
      loss.dailyLoss >= loss.dailyLossLimit
    ) {
      await activateForDailyLoss({
        dailyLoss: loss.dailyLoss,
        dailyLossLimit: loss.dailyLossLimit,
        autoRecovery: true,
      });
      state = await getState();
    }
  }
  if (state.active) {
    throw new KillSwitchError(
      state.reason || "Master kill switch is active",
      423
    );
  }
  return { active: false, tradingEnabled: true };
}

async function getHistory() {
  await ensureSchema();
  const result = await pool.query(
    `SELECT *
     FROM master_kill_switch_history
     ORDER BY created_at DESC, id DESC
     LIMIT 500`
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    triggerType: row.trigger_type,
    reason: row.reason,
    autoRecovery: row.auto_recovery,
    cancelledOrders: row.cancelled_orders,
    stoppedStrategies: row.stopped_strategies,
    brokerSnapshot: row.broker_snapshot || {},
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }));
}

module.exports = {
  KillSwitchError,
  ensureSchema,
  getStatus,
  assertTradingAllowed,
  activate,
  activateForDailyLoss,
  deactivate,
  getHistory,
};
