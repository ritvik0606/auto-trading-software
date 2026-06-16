const axios = require("axios");
const pool = require("../config/db");

const ANGEL_BASE_URL = "https://apiconnect.angelone.in";
const ANGEL_PLACE_ORDER_URL =
  `${ANGEL_BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder`;
const ANGEL_SEARCH_URL =
  `${ANGEL_BASE_URL}/rest/secure/angelbroking/order/v1/searchScrip`;
const ANGEL_ORDER_TIMEOUT_MS = 10000;

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
const SUPPORTED_REAL_ORDER_TYPES = new Set(["MARKET", "LIMIT"]);
const REAL_ORDERS_DISABLED_MESSAGE =
  "Real orders disabled. Order blocked safely.";
const UNSUPPORTED_REAL_ORDER_MESSAGE =
  "SL and SL-M real orders are not supported yet. Order blocked safely.";

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

function areRealOrdersDryRun() {
  return process.env.DRY_RUN_REAL_ORDERS?.trim().toLowerCase() !== "false";
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
  const symbolToken =
    typeof input.symbolToken === "string" && input.symbolToken.trim()
      ? input.symbolToken.trim()
      : null;
  const tradingSymbol =
    typeof input.tradingSymbol === "string" && input.tradingSymbol.trim()
      ? input.tradingSymbol.trim().toUpperCase()
      : null;

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

  return {
    symbol,
    exchange,
    side,
    orderType,
    quantity,
    price,
    symbolToken,
    tradingSymbol,
  };
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

  const saved = mapOrder(result.rows[0]);
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "ORDER",
    action: "ORDER_BLOCKED",
    severity: "WARNING",
    entityType: "ORDER",
    entityId: saved.id,
    message: reason,
    metadata: {
      symbol: saved.symbol,
      side: saved.side,
      quantity: saved.quantity,
      orderType: saved.orderType,
      mode: saved.mode,
    },
  });
  return saved;
}

async function saveSubmittedOrder(order, brokerResult) {
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
       broker_order_id,
       mode,
       reason,
       expected_price,
       filled_quantity,
       broker_name,
       submitted_at,
       last_status_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, 'REAL', $9,
       $6, 0, 'ANGEL_ONE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )
     RETURNING *`,
    [
      order.symbol,
      order.exchange,
      order.side,
      order.orderType,
      order.quantity,
      order.price,
      brokerResult.status || "SUBMITTED",
      brokerResult.brokerOrderId || null,
      brokerResult.reason,
    ]
  );

  const saved = mapOrder(result.rows[0]);
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "ORDER",
    action: brokerResult.dryRun ? "ORDER_DRY_RUN" : "ORDER_SUBMITTED",
    severity: brokerResult.dryRun ? "INFO" : "WARNING",
    entityType: "ORDER",
    entityId: saved.id,
    message: brokerResult.reason,
    metadata: {
      symbol: saved.symbol,
      side: saved.side,
      quantity: saved.quantity,
      orderType: saved.orderType,
      mode: saved.mode,
      brokerOrderId: saved.brokerOrderId,
      dryRun: brokerResult.dryRun === true,
      brokerResponse: brokerResult.response || null,
    },
  });
  return saved;
}

function getAngelOrderHeaders(session) {
  const jwtToken = session?.jwtToken;

  if (!jwtToken) {
    throw new OrderError(
      "Angel One session is missing a JWT token. Connect the broker again.",
      503
    );
  }

  if (!process.env.ANGEL_API_KEY?.trim()) {
    throw new OrderError("Angel One API key is not configured.", 503);
  }

  return {
    Authorization: `Bearer ${jwtToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": process.env.ANGEL_API_KEY.trim(),
  };
}

function getAngelErrorMessage(error) {
  return (
    error.response?.data?.message ||
    error.message ||
    "Angel One order placement failed"
  );
}

function clearAngelSession(error) {
  if ([401, 403].includes(error.response?.status)) {
    const {
      invalidateBrokerSession,
    } = require("./brokerSession.service");
    invalidateBrokerSession(
      "ANGEL_ONE",
      "Angel One rejected the stored session"
    );
  }
}

async function getConnectedAngelSession() {
  try {
    const { getBrokerSession } = require("./brokerSession.service");
    return getBrokerSession("ANGEL_ONE");
  } catch (error) {
    throw new OrderError(
      "Angel One session is missing or expired. Connect Angel One before placing real orders.",
      503
    );
  }
}

function normalizeAngelInstrument(match, fallback) {
  return {
    exchange: match.exchange || fallback.exchange,
    tradingSymbol: match.tradingsymbol || fallback.tradingSymbol,
    symbolToken: match.symboltoken || fallback.symbolToken,
  };
}

async function resolveAngelInstrument(order, headers) {
  if (order.symbolToken) {
    return {
      exchange: order.exchange,
      tradingSymbol: order.tradingSymbol || order.symbol,
      symbolToken: order.symbolToken,
    };
  }

  const requestedSymbol = order.tradingSymbol || order.symbol;
  const requestedBase = requestedSymbol.replace(/-EQ$/, "");
  const response = await axios.post(
    ANGEL_SEARCH_URL,
    {
      exchange: order.exchange,
      searchscrip: requestedBase,
    },
    { headers, timeout: ANGEL_ORDER_TIMEOUT_MS }
  );

  if (response.data?.status !== true) {
    throw new OrderError(
      response.data?.message || `Angel One could not resolve ${order.symbol}`,
      502
    );
  }

  const matches = Array.isArray(response.data?.data) ? response.data.data : [];
  const match = matches.find((item) => {
    const exchange = item.exchange?.toUpperCase();
    const tradingSymbol = item.tradingsymbol?.toUpperCase();
    return (
      exchange === order.exchange &&
      (tradingSymbol === requestedSymbol ||
        tradingSymbol === `${requestedBase}-EQ`)
    );
  });

  if (!match) {
    throw new OrderError(
      `Angel One instrument not found for ${order.exchange}:${order.symbol}`,
      404
    );
  }

  return normalizeAngelInstrument(match, {
    exchange: order.exchange,
    tradingSymbol: requestedSymbol,
  });
}

function buildAngelOrderPayload(order, instrument) {
  const orderType = order.orderType;
  const isLimit = orderType === "LIMIT";

  return {
    variety: "NORMAL",
    tradingsymbol: instrument.tradingSymbol,
    symboltoken: instrument.symbolToken,
    transactiontype: order.side,
    exchange: instrument.exchange,
    ordertype: orderType,
    producttype:
      process.env.ANGEL_ORDER_PRODUCT_TYPE?.trim().toUpperCase() ||
      "INTRADAY",
    duration: "DAY",
    price: String(isLimit ? order.price : 0),
    squareoff: "0",
    stoploss: "0",
    quantity: String(order.quantity),
  };
}

function getBrokerOrderId(responseData) {
  return (
    responseData?.data?.orderid ||
    responseData?.data?.orderId ||
    responseData?.orderid ||
    responseData?.orderId ||
    null
  );
}

function simulatedBrokerResponse(order, payload) {
  return {
    status: true,
    message: "DRY_RUN_REAL_ORDERS=true; Angel One order was not placed.",
    errorcode: "",
    data: {
      script: payload.tradingsymbol,
      orderid: null,
      uniqueorderid: `dry-run-${Date.now()}`,
      dryRun: true,
      request: {
        symbol: order.symbol,
        exchange: order.exchange,
        side: order.side,
        orderType: order.orderType,
        quantity: order.quantity,
        price: order.price,
      },
    },
  };
}

function dryRunInstrument(order) {
  const tradingSymbol =
    order.tradingSymbol ||
    (["NSE", "BSE"].includes(order.exchange) && !order.symbol.endsWith("-EQ")
      ? `${order.symbol}-EQ`
      : order.symbol);

  return {
    exchange: order.exchange,
    tradingSymbol,
    symbolToken: order.symbolToken || "DRYRUN",
  };
}

async function placeAngelOrderPlaceholder(order) {
  if (!areRealOrdersEnabled()) {
    return {
      submitted: false,
      reason: REAL_ORDERS_DISABLED_MESSAGE,
    };
  }

  if (!SUPPORTED_REAL_ORDER_TYPES.has(order.orderType)) {
    return {
      submitted: false,
      reason: UNSUPPORTED_REAL_ORDER_MESSAGE,
    };
  }

  if (areRealOrdersDryRun()) {
    const payload = buildAngelOrderPayload(order, dryRunInstrument(order));
    const response = simulatedBrokerResponse(order, payload);
    console.info("Angel One order dry run", {
      payload,
      response,
    });
    return {
      submitted: true,
      dryRun: true,
      status: "DRY_RUN",
      brokerOrderId: null,
      reason: response.message,
      request: payload,
      response,
    };
  }

  const session = await getConnectedAngelSession();
  const headers = getAngelOrderHeaders(session);
  const instrument = await resolveAngelInstrument(order, headers);
  const payload = buildAngelOrderPayload(order, instrument);

  try {
    const response = await axios.post(ANGEL_PLACE_ORDER_URL, payload, {
      headers,
      timeout: ANGEL_ORDER_TIMEOUT_MS,
    });

    console.info("Angel One order response", {
      status: response.status,
      brokerResponse: response.data,
    });

    if (response.data?.status !== true) {
      return {
        submitted: false,
        reason:
          response.data?.message ||
          "Angel One rejected the order placement request",
        request: payload,
        response: response.data,
      };
    }

    return {
      submitted: true,
      dryRun: false,
      status: "SUBMITTED",
      brokerOrderId: getBrokerOrderId(response.data),
      reason: response.data?.message || "Angel One order submitted",
      request: payload,
      response: response.data,
    };
  } catch (error) {
    clearAngelSession(error);
    console.error("Angel One order placement failed", {
      status: error.response?.status,
      errorCode: error.response?.data?.errorcode,
      message: getAngelErrorMessage(error),
    });
    throw new OrderError(getAngelErrorMessage(error), 502);
  }
}

async function assertRealOrderSafety(order) {
  if (!areRealOrdersEnabled()) {
    return REAL_ORDERS_DISABLED_MESSAGE;
  }

  if (!Number.isInteger(order.quantity) || order.quantity <= 0) {
    return "Quantity must be greater than zero. Order blocked safely.";
  }

  const {
    assertTradingAllowed,
  } = require("./killSwitch.service");
  await assertTradingAllowed();

  const {
    areNewOrdersDisabled,
    getRiskStatus,
  } = require("./riskDashboard.service");

  if (await areNewOrdersDisabled()) {
    return "Orders disabled by emergency kill switch.";
  }

  const riskStatus = await getRiskStatus();
  if (riskStatus.dailyLossLocked) {
    return "Daily loss limit reached. Order blocked safely.";
  }

  if (riskStatus.killSwitchActive) {
    return "Emergency kill switch is active. Order blocked safely.";
  }

  if (riskStatus.ordersDisabled) {
    return "New orders are disabled. Order blocked safely.";
  }

  return null;
}

async function placeAngelOrderSafely(order) {
  const blockReason = await assertRealOrderSafety(order);
  if (blockReason) {
    return {
      message: blockReason,
      order: await saveBlockedOrder(order, "PAPER", blockReason),
    };
  }

  const brokerResult = await placeAngelOrderPlaceholder(order);
  if (!brokerResult.submitted) {
    return {
      message: brokerResult.reason,
      order: await saveBlockedOrder(order, "REAL", brokerResult.reason),
    };
  }

  return {
    message: brokerResult.reason,
    order: await saveSubmittedOrder(order, brokerResult),
  };
}

async function placeOrder(input) {
  const order = normalizeOrderInput(input);
  try {
    return await placeAngelOrderSafely(order);
  } catch (error) {
    if (error instanceof OrderError && error.statusCode >= 500) {
      return {
        message: error.message,
        order: await saveBlockedOrder(order, "REAL", error.message),
      };
    }
    const message = error.message || "Master kill switch is active";
    return {
      message,
      order: await saveBlockedOrder(order, "PAPER", message),
    };
  }
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
  areRealOrdersDryRun,
  placeAngelOrderPlaceholder,
  placeOrder,
  getOrders,
  getOrderById,
};
