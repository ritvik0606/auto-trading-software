const pool = require("../config/db");

const DEFAULT_RULES = {
  dailyLossLock: true,
  maxPositionSize: 1000,
  maxCapitalAllocationPerTrade: 20,
  maxOpenPositions: 5,
  killSwitchActive: false,
  ordersDisabled: false,
};

class RiskDashboardError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "RiskDashboardError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function mapRules(row) {
  if (!row) {
    return { ...DEFAULT_RULES };
  }

  return {
    id: row.id,
    dailyLossLock: row.daily_loss_lock,
    maxPositionSize: row.max_position_size,
    maxCapitalAllocationPerTrade: Number(
      row.max_capital_allocation_per_trade
    ),
    maxOpenPositions: row.max_open_positions,
    killSwitchActive: row.kill_switch_active,
    ordersDisabled: row.orders_disabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new RiskDashboardError(`${fieldName} must be a boolean`, 400);
  }

  return value;
}

function parsePositiveInteger(value, fieldName) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new RiskDashboardError(
      `${fieldName} must be a positive integer`,
      400
    );
  }

  return number;
}

function parsePercentage(value, fieldName) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0 || number > 100) {
    throw new RiskDashboardError(
      `${fieldName} must be between 0 and 100`,
      400
    );
  }

  return number;
}

function normalizeRules(input, currentRules) {
  const source = currentRules
    ? { ...currentRules, ...input }
    : input;

  return {
    dailyLossLock: parseBoolean(
      source.dailyLossLock,
      "dailyLossLock"
    ),
    maxPositionSize: parsePositiveInteger(
      source.maxPositionSize,
      "maxPositionSize"
    ),
    maxCapitalAllocationPerTrade: parsePercentage(
      source.maxCapitalAllocationPerTrade,
      "maxCapitalAllocationPerTrade"
    ),
    maxOpenPositions: parsePositiveInteger(
      source.maxOpenPositions,
      "maxOpenPositions"
    ),
  };
}

async function getStoredRules() {
  const result = await pool.query(
    `SELECT *
     FROM risk_rules
     WHERE id = 1`
  );

  return result.rows[0] || null;
}

async function getRiskRules() {
  return mapRules(await getStoredRules());
}

async function createRiskRules(input) {
  if (await getStoredRules()) {
    throw new RiskDashboardError(
      "Risk rules already exist; use PUT to update them",
      409
    );
  }

  const rules = normalizeRules(input);
  const result = await pool.query(
    `INSERT INTO risk_rules (
       id,
       daily_loss_lock,
       max_position_size,
       max_capital_allocation_per_trade,
       max_open_positions
     )
     VALUES (1, $1, $2, $3, $4)
     RETURNING *`,
    [
      rules.dailyLossLock,
      rules.maxPositionSize,
      rules.maxCapitalAllocationPerTrade,
      rules.maxOpenPositions,
    ]
  );

  return mapRules(result.rows[0]);
}

async function updateRiskRules(input) {
  const existing = await getStoredRules();
  const current = mapRules(existing);
  const rules = normalizeRules(input, current);
  const result = await pool.query(
    `INSERT INTO risk_rules (
       id,
       daily_loss_lock,
       max_position_size,
       max_capital_allocation_per_trade,
       max_open_positions
     )
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id)
     DO UPDATE SET
       daily_loss_lock = EXCLUDED.daily_loss_lock,
       max_position_size = EXCLUDED.max_position_size,
       max_capital_allocation_per_trade =
         EXCLUDED.max_capital_allocation_per_trade,
       max_open_positions = EXCLUDED.max_open_positions,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      rules.dailyLossLock,
      rules.maxPositionSize,
      rules.maxCapitalAllocationPerTrade,
      rules.maxOpenPositions,
    ]
  );

  return mapRules(result.rows[0]);
}

async function getRiskMetrics() {
  const result = await pool.query(
    `SELECT
       COALESCE(
         (
           SELECT capital
           FROM risk_settings
           WHERE user_id IS NULL
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ),
         100000
       ) AS total_capital,
       COALESCE(
         (
           SELECT SUM(quantity * average_price)
           FROM positions
           WHERE status = 'OPEN'
         ),
         0
       ) AS used_capital,
       COALESCE(
         (
           SELECT SUM(pnl)
           FROM paper_trades
           WHERE status = 'CLOSED'
             AND COALESCE(closed_at, created_at)::date = CURRENT_DATE
         ),
         0
       ) AS today_pnl,
       (
         SELECT COUNT(*)
         FROM positions
         WHERE status = 'OPEN'
       ) AS open_positions,
       (
         SELECT COUNT(*)
         FROM alerts
         WHERE status = 'ACTIVE'
       ) AS active_alerts,
       COALESCE(
         (
           SELECT max_daily_loss
           FROM risk_settings
           WHERE user_id IS NULL
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ),
         2000
       ) AS max_daily_loss`
  );
  const row = result.rows[0];
  const totalCapital = Number(row.total_capital);
  const usedCapital = Number(row.used_capital);
  const todayPnL = Number(row.today_pnl);
  const currentDailyLoss = Math.max(-todayPnL, 0);
  const maxDailyLoss = Number(row.max_daily_loss);

  return {
    totalCapital,
    usedCapital: round(usedCapital),
    availableCapital: round(totalCapital - usedCapital),
    maxDailyLoss,
    currentDailyLoss: round(currentDailyLoss),
    riskUtilizationPercent:
      maxDailyLoss === 0
        ? currentDailyLoss > 0
          ? 100
          : 0
        : round(Math.min((currentDailyLoss / maxDailyLoss) * 100, 100)),
    openPositions: Number(row.open_positions),
    activeAlerts: Number(row.active_alerts),
    todayPnL: round(todayPnL),
  };
}

async function getRiskDashboard() {
  const [metrics, rules] = await Promise.all([
    getRiskMetrics(),
    getRiskRules(),
  ]);

  return {
    ...metrics,
    dailyLossLocked:
      rules.dailyLossLock &&
      metrics.currentDailyLoss >= metrics.maxDailyLoss,
    killSwitchActive: rules.killSwitchActive,
    ordersDisabled: rules.ordersDisabled,
  };
}

async function getRiskStatus() {
  const dashboard = await getRiskDashboard();
  const rules = await getRiskRules();
  const maxPositionsReached =
    dashboard.openPositions >= rules.maxOpenPositions;
  const tradingAllowed =
    !dashboard.killSwitchActive &&
    !dashboard.ordersDisabled &&
    !dashboard.dailyLossLocked &&
    !maxPositionsReached;

  return {
    status: tradingAllowed ? "ACTIVE" : "LOCKED",
    tradingAllowed,
    killSwitchActive: dashboard.killSwitchActive,
    ordersDisabled: dashboard.ordersDisabled,
    dailyLossLocked: dashboard.dailyLossLocked,
    maxPositionsReached,
    reasons: [
      dashboard.killSwitchActive && "Emergency kill switch is active",
      dashboard.ordersDisabled && "New orders are disabled",
      dashboard.dailyLossLocked && "Daily loss limit reached",
      maxPositionsReached && "Maximum open positions reached",
    ].filter(Boolean),
  };
}

async function validateNewPaperTrade({ quantity, entryPrice }) {
  const { validateNewTrade } = require("./riskEngine.service");
  await validateNewTrade({ quantity, entryPrice });
  const [rules, dashboard] = await Promise.all([
    getRiskRules(),
    getRiskDashboard(),
  ]);

  if (rules.killSwitchActive || rules.ordersDisabled) {
    throw new RiskDashboardError(
      "New trades are disabled by the emergency kill switch",
      423
    );
  }

  if (
    rules.dailyLossLock &&
    dashboard.currentDailyLoss >= dashboard.maxDailyLoss
  ) {
    throw new RiskDashboardError("Daily loss lock is active", 423);
  }

  if (dashboard.openPositions >= rules.maxOpenPositions) {
    throw new RiskDashboardError(
      "Maximum open positions limit reached",
      409
    );
  }

  if (quantity > rules.maxPositionSize) {
    throw new RiskDashboardError(
      `Quantity exceeds max position size of ${rules.maxPositionSize}`,
      400
    );
  }

  const allocation = quantity * entryPrice;
  const maxAllocation =
    dashboard.totalCapital *
    (rules.maxCapitalAllocationPerTrade / 100);

  if (allocation > maxAllocation) {
    throw new RiskDashboardError(
      "Trade exceeds max capital allocation per trade",
      400
    );
  }
}

async function areNewOrdersDisabled() {
  const rules = await getRiskRules();
  return rules.ordersDisabled || rules.killSwitchActive;
}

async function activateKillSwitch() {
  await pool.query(
    `INSERT INTO risk_rules (id, kill_switch_active, orders_disabled)
     VALUES (1, TRUE, TRUE)
     ON CONFLICT (id)
     DO UPDATE SET
       kill_switch_active = TRUE,
       orders_disabled = TRUE,
       updated_at = CURRENT_TIMESTAMP`
  );

  const { stopAllStrategies } = require("./strategy.service");
  const { emergencyCloseAllPaperTrades } = require("./paperTrade.service");
  const stoppedStrategies = stopAllStrategies();
  const closedTrades = await emergencyCloseAllPaperTrades();

  return {
    message: "Emergency kill switch activated",
    killSwitchActive: true,
    ordersDisabled: true,
    stoppedStrategies,
    closedPaperPositions: closedTrades,
  };
}

module.exports = {
  RiskDashboardError,
  getRiskDashboard,
  getRiskRules,
  createRiskRules,
  updateRiskRules,
  getRiskStatus,
  validateNewPaperTrade,
  areNewOrdersDisabled,
  activateKillSwitch,
};
