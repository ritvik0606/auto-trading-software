const pool = require("../config/db");

const DEFAULT_CONFIG = {
  dailyLossLimit: 2000,
  maxOpenPositions: 5,
  maxCapitalPerTrade: 20000,
  maxDailyTrades: 10,
  profitLockEnabled: true,
  profitLockTrigger: 5000,
  profitLockGiveback: 2000,
  maxDrawdown: 5000,
};

let schemaReady = null;

class RiskEngineError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "RiskEngineError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS risk_engine_config (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          daily_loss_limit DECIMAL NOT NULL DEFAULT 2000,
          max_open_positions INTEGER NOT NULL DEFAULT 5,
          max_capital_per_trade DECIMAL NOT NULL DEFAULT 20000,
          max_daily_trades INTEGER NOT NULL DEFAULT 10,
          profit_lock_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          profit_lock_trigger DECIMAL NOT NULL DEFAULT 5000,
          profit_lock_giveback DECIMAL NOT NULL DEFAULT 2000,
          max_drawdown DECIMAL NOT NULL DEFAULT 5000,
          risk_locked BOOLEAN NOT NULL DEFAULT FALSE,
          kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
          lock_reason TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS risk_engine_events (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(50) NOT NULL,
          severity VARCHAR(20) NOT NULL,
          message TEXT NOT NULL,
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(
        `INSERT INTO risk_engine_config (id)
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

function mapConfig(row) {
  return {
    dailyLossLimit: Number(row.daily_loss_limit),
    maxOpenPositions: row.max_open_positions,
    maxCapitalPerTrade: Number(row.max_capital_per_trade),
    maxDailyTrades: row.max_daily_trades,
    profitLockEnabled: row.profit_lock_enabled,
    profitLockTrigger: Number(row.profit_lock_trigger),
    profitLockGiveback: Number(row.profit_lock_giveback),
    maxDrawdown: Number(row.max_drawdown),
    riskLocked: row.risk_locked,
    killSwitchActive: row.kill_switch_active,
    lockReason: row.lock_reason,
    updatedAt: row.updated_at,
  };
}

function parsePositiveNumber(value, fieldName, { allowZero = false } = {}) {
  const number = Number(value);
  const valid = allowZero ? number >= 0 : number > 0;

  if (!Number.isFinite(number) || !valid) {
    throw new RiskEngineError(
      `${fieldName} must be ${allowZero ? "zero or a positive number" : "a positive number"}`,
      400
    );
  }

  return number;
}

function parsePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new RiskEngineError(`${fieldName} must be a positive integer`, 400);
  }
  return number;
}

function parseBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new RiskEngineError(`${fieldName} must be a boolean`, 400);
  }
  return value;
}

function normalizeConfig(input = {}, current = DEFAULT_CONFIG) {
  const source = { ...current, ...input };
  const config = {
    dailyLossLimit: parsePositiveNumber(
      source.dailyLossLimit,
      "dailyLossLimit",
      { allowZero: true }
    ),
    maxOpenPositions: parsePositiveInteger(
      source.maxOpenPositions,
      "maxOpenPositions"
    ),
    maxCapitalPerTrade: parsePositiveNumber(
      source.maxCapitalPerTrade,
      "maxCapitalPerTrade"
    ),
    maxDailyTrades: parsePositiveInteger(
      source.maxDailyTrades,
      "maxDailyTrades"
    ),
    profitLockEnabled: parseBoolean(
      source.profitLockEnabled,
      "profitLockEnabled"
    ),
    profitLockTrigger: parsePositiveNumber(
      source.profitLockTrigger,
      "profitLockTrigger",
      { allowZero: true }
    ),
    profitLockGiveback: parsePositiveNumber(
      source.profitLockGiveback,
      "profitLockGiveback",
      { allowZero: true }
    ),
    maxDrawdown: parsePositiveNumber(
      source.maxDrawdown,
      "maxDrawdown",
      { allowZero: true }
    ),
  };

  if (config.profitLockGiveback > config.profitLockTrigger) {
    throw new RiskEngineError(
      "profitLockGiveback must not exceed profitLockTrigger",
      400
    );
  }

  return config;
}

async function getConfig() {
  await ensureSchema();
  const result = await pool.query(
    `SELECT * FROM risk_engine_config WHERE id = 1`
  );
  return mapConfig(result.rows[0]);
}

async function recordEvent(eventType, severity, message, details = {}) {
  await ensureSchema();
  const result = await pool.query(
    `INSERT INTO risk_engine_events (
       event_type, severity, message, details
     )
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [eventType, severity, message, JSON.stringify(details)]
  );
  return result.rows[0];
}

async function saveConfig(input) {
  const current = await getConfig();
  const config = normalizeConfig(input, current);
  const result = await pool.query(
    `UPDATE risk_engine_config
     SET daily_loss_limit = $1,
         max_open_positions = $2,
         max_capital_per_trade = $3,
         max_daily_trades = $4,
         profit_lock_enabled = $5,
         profit_lock_trigger = $6,
         profit_lock_giveback = $7,
         max_drawdown = $8,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING *`,
    [
      config.dailyLossLimit,
      config.maxOpenPositions,
      config.maxCapitalPerTrade,
      config.maxDailyTrades,
      config.profitLockEnabled,
      config.profitLockTrigger,
      config.profitLockGiveback,
      config.maxDrawdown,
    ]
  );
  await recordEvent(
    "CONFIG_UPDATED",
    "INFO",
    "Risk engine configuration updated",
    config
  );
  const saved = mapConfig(result.rows[0]);
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "RISK",
    action: "RISK_ENGINE_CONFIG_UPDATED",
    severity: "WARNING",
    entityType: "RISK_CONFIG",
    entityId: 1,
    message: "Risk engine configuration updated",
    metadata: saved,
  });
  return saved;
}

function calculatePnlPath(rows, unrealizedPnL = 0) {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const row of rows) {
    cumulative += Number(row.pnl);
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  cumulative += Number(unrealizedPnL || 0);
  peak = Math.max(peak, cumulative);
  maxDrawdown = Math.max(maxDrawdown, peak - cumulative);

  return {
    dailyPnL: round(cumulative),
    peakDailyPnL: round(peak),
    currentDrawdown: round(Math.max(peak - cumulative, 0)),
    maxDrawdownToday: round(maxDrawdown),
  };
}

async function getMetrics() {
  const [summaryResult, pnlResult] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT COUNT(*) FROM positions WHERE status = 'OPEN')
           AS open_positions,
         (SELECT COUNT(*) FROM paper_trades
          WHERE created_at::date = CURRENT_DATE)
           AS daily_trades,
         COALESCE(
           (SELECT SUM(unrealized_pnl)
            FROM positions
            WHERE status = 'OPEN'),
           0
         ) AS unrealized_pnl,
         COALESCE(
           (SELECT capital FROM risk_settings
            WHERE user_id IS NULL
            ORDER BY created_at DESC, id DESC LIMIT 1),
           100000
         ) AS total_capital`
    ),
    pool.query(
      `SELECT pnl
       FROM paper_trades
       WHERE status = 'CLOSED'
         AND COALESCE(closed_at, created_at)::date = CURRENT_DATE
       ORDER BY COALESCE(closed_at, created_at), id`
    ),
  ]);
  const row = summaryResult.rows[0];

  return {
    totalCapital: Number(row.total_capital),
    openPositions: Number(row.open_positions),
    dailyTrades: Number(row.daily_trades),
    unrealizedPnL: round(row.unrealized_pnl),
    ...calculatePnlPath(pnlResult.rows, row.unrealized_pnl),
  };
}

function findBreach(config, metrics) {
  const dailyLoss = Math.max(-metrics.dailyPnL, 0);

  if (
    config.dailyLossLimit > 0 &&
    dailyLoss >= config.dailyLossLimit
  ) {
    return {
      type: "DAILY_LOSS_LIMIT",
      reason: "Daily loss limit reached",
    };
  }
  if (metrics.openPositions >= config.maxOpenPositions) {
    return {
      type: "MAX_OPEN_POSITIONS",
      reason: "Maximum open positions reached",
    };
  }
  if (metrics.dailyTrades >= config.maxDailyTrades) {
    return {
      type: "MAX_DAILY_TRADES",
      reason: "Maximum daily trades reached",
    };
  }
  if (
    config.profitLockEnabled &&
    config.profitLockTrigger > 0 &&
    config.profitLockGiveback > 0 &&
    metrics.peakDailyPnL >= config.profitLockTrigger &&
    metrics.currentDrawdown >= config.profitLockGiveback
  ) {
    return {
      type: "PROFIT_LOCK",
      reason: "Profit lock activated after configured giveback",
    };
  }
  if (
    config.maxDrawdown > 0 &&
    metrics.currentDrawdown >= config.maxDrawdown
  ) {
    return {
      type: "DRAWDOWN_LIMIT",
      reason: "Maximum drawdown reached",
    };
  }
  return null;
}

function stopAutoTrading() {
  const { stopAutoTrade } = require("./autoTrade.service");
  return stopAutoTrade({});
}

async function lockRiskEngine(breach) {
  const current = await getConfig();
  if (current.riskLocked) {
    return [];
  }

  await pool.query(
    `UPDATE risk_engine_config
     SET risk_locked = TRUE,
         lock_reason = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [breach.reason]
  );
  const stoppedRunners = stopAutoTrading();
  await recordEvent(
    breach.type,
    "CRITICAL",
    breach.reason,
    { stoppedAutoTradeRunners: stoppedRunners.length }
  );
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "RISK",
    action: breach.type,
    severity: "ERROR",
    entityType: "RISK_ENGINE",
    entityId: 1,
    message: breach.reason,
    metadata: { stoppedAutoTradeRunners: stoppedRunners.length },
  });
  return stoppedRunners;
}

async function evaluateRisk() {
  const [config, metrics] = await Promise.all([getConfig(), getMetrics()]);
  const breach = findBreach(config, metrics);
  let stoppedRunners = [];

  if (breach && !config.riskLocked) {
    if (breach.type === "DAILY_LOSS_LIMIT") {
      const {
        activateForDailyLoss,
      } = require("./killSwitch.service");
      const status = await activateForDailyLoss({
        dailyLoss: Math.max(-metrics.dailyPnL, 0),
        dailyLossLimit: config.dailyLossLimit,
        autoRecovery: true,
      });
      stoppedRunners = status.active ? ["MASTER_KILL_SWITCH"] : [];
    } else {
      stoppedRunners = await lockRiskEngine(breach);
    }
  }

  const currentConfig =
    breach && !config.riskLocked ? await getConfig() : config;
  const reasons = [
    currentConfig.killSwitchActive && "Emergency kill switch is active",
    currentConfig.riskLocked &&
      (currentConfig.lockReason || "Risk engine is locked"),
  ].filter(Boolean);

  return {
    mode: "PAPER_ONLY",
    status: reasons.length > 0 ? "LOCKED" : "ACTIVE",
    tradingAllowed: reasons.length === 0,
    killSwitchActive: currentConfig.killSwitchActive,
    riskLocked: currentConfig.riskLocked,
    lockReason: currentConfig.lockReason,
    realOrdersEnabled: false,
    config: currentConfig,
    metrics: {
      ...metrics,
      dailyLoss: round(Math.max(-metrics.dailyPnL, 0)),
      remainingDailyLoss: round(
        Math.max(currentConfig.dailyLossLimit - Math.max(-metrics.dailyPnL, 0), 0)
      ),
    },
    reasons,
    stoppedRunners,
  };
}

async function validateNewTrade({ quantity, entryPrice }) {
  const {
    assertTradingAllowed,
  } = require("./killSwitch.service");
  await assertTradingAllowed();
  const status = await evaluateRisk();
  if (!status.tradingAllowed) {
    throw new RiskEngineError(
      status.reasons[0] || "Risk engine is locked",
      423
    );
  }

  const allocation = Number(quantity) * Number(entryPrice);
  if (allocation > status.config.maxCapitalPerTrade) {
    throw new RiskEngineError(
      `Trade capital exceeds limit of ${status.config.maxCapitalPerTrade}`,
      400
    );
  }
  return status;
}

async function activateKillSwitch(input = {}) {
  const { activate } = require("./killSwitch.service");
  return activate(input);
}

async function unlockRiskEngine(input = {}) {
  const { deactivate } = require("./killSwitch.service");
  const status = await deactivate(input);
  await recordEvent(
    "RISK_UNLOCKED",
    "WARNING",
    "Risk engine manually unlocked"
  );
  return status;
}

async function getEvents() {
  await ensureSchema();
  const result = await pool.query(
    `SELECT id, event_type, severity, message, details, created_at
     FROM risk_engine_events
     ORDER BY created_at DESC, id DESC
     LIMIT 200`
  );
  return result.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    message: row.message,
    details: row.details || {},
    createdAt: row.created_at,
  }));
}

module.exports = {
  RiskEngineError,
  ensureSchema,
  calculatePnlPath,
  findBreach,
  getConfig,
  saveConfig,
  evaluateRisk,
  validateNewTrade,
  activateKillSwitch,
  unlockRiskEngine,
  getEvents,
};
