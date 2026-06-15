const pool = require("../config/db");

const ALLOWED_EXCHANGES = new Set([
  "NSE",
  "BSE",
  "NFO",
  "BFO",
  "MCX",
  "CDS",
]);
const ALLOWED_SIDES = new Set(["BUY", "SELL"]);
const ALLOWED_ORDER_TYPES = new Set(["MARKET", "LIMIT", "SL", "SL-M"]);
const REAL_ORDERS_DISABLED_MESSAGE =
  "Real orders disabled. Order blocked safely.";
const PLACEHOLDER_MESSAGE =
  "Real order execution placeholder is not implemented. Order blocked safely.";

class OrderError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "OrderError";
    this.statusCode = statusCode;
  }
}

function areRealOrdersEnabled() {
  return process.env.ENABLE_REAL_ORDERS?.trim().toLowerCase() === "true";
}

function normalizeOrderInput(input) {
  const symbol =
    typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  const exchange =
    typeof input.exchange === "string"
      ? input.exchange.trim().toUpperCase()
      : "NSE";
  const side =
    typeof input.side === "string" ? input.side.trim().toUpperCase() : "";
  const requestedOrderType = input.orderType ?? input.order_type;
  const orderType =
    typeof requestedOrderType === "string"
      ? requestedOrderType.trim().toUpperCase()
      : "";
  const quantity = Number(input.quantity);
  const price =
    input.price === undefined || input.price === null || input.price === ""
      ? null
      : Number(input.price);

  if (!symbol || symbol.length > 50 || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new OrderError("Symbol is invalid", 400);
  }

  if (!ALLOWED_EXCHANGES.has(exchange)) {
    throw new OrderError(
      `Exchange must be one of: ${Array.from(ALLOWED_EXCHANGES).join(", ")}`,
      400
    );
  }

  if (!ALLOWED_SIDES.has(side)) {
    throw new OrderError("Side must be BUY or SELL", 400);
  }

  if (!ALLOWED_ORDER_TYPES.has(orderType)) {
    throw new OrderError(
      `orderType must be one of: ${Array.from(ALLOWED_ORDER_TYPES).join(", ")}`,
      400
    );
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new OrderError("Quantity must be a positive integer", 400);
  }

  if (price !== null && (!Number.isFinite(price) || price <= 0)) {
    throw new OrderError("Price must be a positive number", 400);
  }

  if (["LIMIT", "SL"].includes(orderType) && price === null) {
    throw new OrderError(`Price is required for ${orderType} orders`, 400);
  }

  return { symbol, exchange, side, orderType, quantity, price };
}

function mapOrder(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.side,
    orderType: row.order_type,
    quantity: row.quantity,
    price: row.price === null ? null : Number(row.price),
    status: row.status,
    brokerOrderId: row.broker_order_id,
    mode: row.mode,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

async function saveBlockedOrder(order, mode, reason) {
  const {
    ensureSchema: ensureExecutionAnalyticsSchema,
  } = require("./executionAnalytics.service");
  await ensureExecutionAnalyticsSchema();
  const result = await pool.query(
    `INSERT INTO orders (
       symbol,
       exchange,
       side,
       order_type,
       quantity,
       price,
       status,
       mode,
       reason,
       expected_price,
       filled_quantity,
       broker_name,
       submitted_at,
       rejected_at,
       last_status_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, 'BLOCKED', $7, $8,
       $6, 0, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )
     RETURNING *`,
    [
      order.symbol,
      order.exchange,
      order.side,
      order.orderType,
      order.quantity,
      order.price,
      mode,
      reason,
      mode === "REAL" ? "ANGEL_ONE" : "SAFETY_LAYER",
    ]
  );

  return mapOrder(result.rows[0]);
}

async function placeAngelOrderPlaceholder() {
  return {
    submitted: false,
    reason: PLACEHOLDER_MESSAGE,
  };
}

async function placeOrder(input) {
  const order = normalizeOrderInput(input);
  const {
    assertTradingAllowed,
  } = require("./killSwitch.service");
  try {
    await assertTradingAllowed();
  } catch (error) {
    const message = error.message || "Master kill switch is active";
    return {
      message,
      order: await saveBlockedOrder(order, "PAPER", message),
    };
  }
  const {
    areNewOrdersDisabled,
  } = require("./riskDashboard.service");

  if (await areNewOrdersDisabled()) {
    const message = "Orders disabled by emergency kill switch.";
    return {
      message,
      order: await saveBlockedOrder(order, "PAPER", message),
    };
  }

  if (!areRealOrdersEnabled()) {
    return {
      message: REAL_ORDERS_DISABLED_MESSAGE,
      order: await saveBlockedOrder(
        order,
        "PAPER",
        REAL_ORDERS_DISABLED_MESSAGE
      ),
    };
  }

  const brokerResult = await placeAngelOrderPlaceholder(order);
  return {
    message: brokerResult.reason,
    order: await saveBlockedOrder(order, "REAL", brokerResult.reason),
  };
}

async function getOrders() {
  const result = await pool.query(
    `SELECT *
     FROM orders
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapOrder);
}

async function getOrderById(id) {
  const orderId = Number(id);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new OrderError("Order ID must be a positive integer", 400);
  }

  const result = await pool.query(
    `SELECT *
     FROM orders
     WHERE id = $1`,
    [orderId]
  );

  if (result.rows.length === 0) {
    throw new OrderError("Order not found", 404);
  }

  return mapOrder(result.rows[0]);
}

module.exports = {
  OrderError,
  areRealOrdersEnabled,
  placeAngelOrderPlaceholder,
  placeOrder,
  getOrders,
  getOrderById,
};
