const pool = require("../config/db");
const { getSymbolQuote } = require("./market.service");

const ALERT_TYPES = new Set([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PROFIT_TARGET",
  "LOSS_LIMIT",
]);

class AlertError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AlertError";
    this.statusCode = statusCode;
  }
}

function mapAlert(row) {
  return {
    id: row.id,
    type: row.alert_type,
    symbol: row.symbol,
    exchange: row.exchange,
    targetValue: Number(row.target_value),
    status: row.status,
    triggeredValue:
      row.triggered_value === null ? null : Number(row.triggered_value),
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
  };
}

function normalizeAlertInput(input = {}) {
  const type =
    typeof input.type === "string" ? input.type.trim().toUpperCase() : "";
  const symbol =
    typeof input.symbol === "string"
      ? input.symbol.trim().toUpperCase()
      : null;
  const exchange =
    typeof input.exchange === "string"
      ? input.exchange.trim().toUpperCase()
      : "NSE";
  const rawTarget =
    input.targetValue ?? input.price ?? input.threshold ?? input.amount;
  const targetValue = Number(rawTarget);

  if (!ALERT_TYPES.has(type)) {
    throw new AlertError(
      `type must be one of: ${Array.from(ALERT_TYPES).join(", ")}`,
      400
    );
  }

  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    throw new AlertError("targetValue must be a positive number", 400);
  }

  if (type.startsWith("PRICE_")) {
    if (!symbol || !/^[A-Z0-9&.-]+$/.test(symbol) || symbol.length > 50) {
      throw new AlertError(
        "A valid symbol is required for price alerts",
        400
      );
    }

    if (exchange !== "NSE") {
      throw new AlertError(
        "Only NSE price alerts are currently supported",
        400
      );
    }
  } else if (symbol) {
    throw new AlertError(
      "symbol is only supported for price alerts",
      400
    );
  }

  return {
    type,
    symbol,
    exchange: type.startsWith("PRICE_") ? exchange : null,
    targetValue,
  };
}

async function createAlert(input) {
  const alert = normalizeAlertInput(input);
  const result = await pool.query(
    `INSERT INTO alerts (
       alert_type,
       symbol,
       exchange,
       target_value
     )
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [alert.type, alert.symbol, alert.exchange, alert.targetValue]
  );

  return mapAlert(result.rows[0]);
}

async function getTodayPnL() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(pnl), 0) AS today_pnl
     FROM paper_trades
     WHERE status = 'CLOSED'
       AND COALESCE(closed_at, created_at)::date = CURRENT_DATE`
  );

  return Number(result.rows[0].today_pnl);
}

function isTriggered(alert, currentValue) {
  switch (alert.type) {
    case "PRICE_ABOVE":
      return currentValue >= alert.targetValue;
    case "PRICE_BELOW":
      return currentValue <= alert.targetValue;
    case "PROFIT_TARGET":
      return currentValue >= alert.targetValue;
    case "LOSS_LIMIT":
      return currentValue <= -alert.targetValue;
    default:
      return false;
  }
}

async function markTriggered(alert, currentValue) {
  const result = await pool.query(
    `UPDATE alerts
     SET status = 'TRIGGERED',
         triggered_value = $1,
         triggered_at = CURRENT_TIMESTAMP
     WHERE id = $2
       AND status = 'ACTIVE'
     RETURNING *`,
    [currentValue, alert.id]
  );

  return result.rows.length > 0
    ? mapAlert(result.rows[0])
    : alert;
}

async function evaluateAlerts(rows) {
  const alerts = rows.map(mapAlert);
  const activeAlerts = alerts.filter((alert) => alert.status === "ACTIVE");
  const requiresPnL = activeAlerts.some(
    (alert) =>
      alert.type === "PROFIT_TARGET" || alert.type === "LOSS_LIMIT"
  );
  const todayPnL = requiresPnL ? await getTodayPnL() : null;
  const quotePromises = new Map();

  for (const alert of activeAlerts) {
    if (
      alert.type.startsWith("PRICE_") &&
      !quotePromises.has(alert.symbol)
    ) {
      quotePromises.set(alert.symbol, getSymbolQuote(alert.symbol));
    }
  }

  return Promise.all(
    alerts.map(async (alert) => {
      if (alert.status !== "ACTIVE") {
        return alert;
      }

      try {
        const currentValue = alert.type.startsWith("PRICE_")
          ? (await quotePromises.get(alert.symbol)).ltp
          : todayPnL;

        if (isTriggered(alert, currentValue)) {
          return await markTriggered(alert, currentValue);
        }

        return {
          ...alert,
          currentValue: Number(currentValue),
        };
      } catch (error) {
        console.error("Alert evaluation failed", {
          alertId: alert.id,
          type: alert.type,
          symbol: alert.symbol,
          message: error.message,
        });

        return {
          ...alert,
          evaluationError: "Unable to evaluate alert",
        };
      }
    })
  );
}

async function getAlerts() {
  const result = await pool.query(
    `SELECT *
     FROM alerts
     ORDER BY created_at DESC, id DESC`
  );

  return evaluateAlerts(result.rows);
}

async function deleteAlert(id) {
  const alertId = Number(id);

  if (!Number.isInteger(alertId) || alertId <= 0) {
    throw new AlertError("Alert ID must be a positive integer", 400);
  }

  const result = await pool.query(
    `DELETE FROM alerts
     WHERE id = $1
     RETURNING *`,
    [alertId]
  );

  if (result.rows.length === 0) {
    throw new AlertError("Alert not found", 404);
  }

  return mapAlert(result.rows[0]);
}

async function getAlertSummary() {
  const alerts = await getAlerts();

  return {
    totalAlerts: alerts.length,
    activeAlerts: alerts.filter((alert) => alert.status === "ACTIVE").length,
    triggeredAlerts: alerts.filter(
      (alert) => alert.status === "TRIGGERED"
    ).length,
    priceAlerts: alerts.filter((alert) => alert.type.startsWith("PRICE_"))
      .length,
    pnlAlerts: alerts.filter(
      (alert) =>
        alert.type === "PROFIT_TARGET" || alert.type === "LOSS_LIMIT"
    ).length,
    byType: Object.fromEntries(
      Array.from(ALERT_TYPES).map((type) => [
        type,
        alerts.filter((alert) => alert.type === type).length,
      ])
    ),
  };
}

module.exports = {
  AlertError,
  createAlert,
  getAlerts,
  deleteAlert,
  getAlertSummary,
};
