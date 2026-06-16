const pool = require("../config/db");
const { getSymbolQuote } = require("./market.service");
const {
  createPositionForTrade,
  closePositionForTrade,
} = require("./position.service");
const { createJournalForTrade } = require("./journal.service");

const ALLOWED_EXCHANGES = new Set([
  "NSE",
  "BSE",
  "NFO",
  "BFO",
  "MCX",
  "CDS",
]);

class PaperTradeError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "PaperTradeError";
    this.statusCode = statusCode;
  }
}

function parseOptionalPrice(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new PaperTradeError(`${fieldName} must be a positive number`, 400);
  }

  return price;
}

function normalizeTradeInput(input) {
  const symbol =
    typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  const exchange =
    typeof input.exchange === "string"
      ? input.exchange.trim().toUpperCase()
      : "NSE";
  const quantity = Number(input.quantity);

  if (!symbol || symbol.length > 50 || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new PaperTradeError("Symbol is invalid", 400);
  }

  if (!ALLOWED_EXCHANGES.has(exchange)) {
    throw new PaperTradeError(
      `Exchange must be one of: ${Array.from(ALLOWED_EXCHANGES).join(", ")}`,
      400
    );
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new PaperTradeError("Quantity must be a positive integer", 400);
  }

  return {
    symbol,
    exchange,
    quantity,
    price: parseOptionalPrice(input.price, "price"),
    stopLoss: parseOptionalPrice(input.stopLoss, "stopLoss"),
    targetPrice: parseOptionalPrice(input.targetPrice, "targetPrice"),
  };
}

function mapPaperTrade(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    tradeType: row.trade_type,
    entryPrice: Number(row.entry_price),
    quantity: row.quantity,
    stopLoss: row.stop_loss === null ? null : Number(row.stop_loss),
    targetPrice:
      row.target_price === null ? null : Number(row.target_price),
    status: row.status,
    exitPrice: row.exit_price === null ? null : Number(row.exit_price),
    pnl: Number(row.pnl),
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

async function resolvePrice(symbol, exchange, providedPrice) {
  if (providedPrice !== null) {
    return providedPrice;
  }

  if (exchange !== "NSE") {
    throw new PaperTradeError(
      "A price is required for non-NSE paper trades",
      400
    );
  }

  const quote = await getSymbolQuote(symbol);
  return quote.ltp;
}

async function createPaperTrade(tradeType, input) {
  const normalizedType = tradeType?.toUpperCase();
  if (!["BUY", "SELL"].includes(normalizedType)) {
    throw new PaperTradeError("Trade type must be BUY or SELL", 400);
  }

  const trade = normalizeTradeInput(input);
  const entryPrice = await resolvePrice(
    trade.symbol,
    trade.exchange,
    trade.price
  );
  const {
    validateNewPaperTrade,
  } = require("./riskDashboard.service");
  await validateNewPaperTrade({
    quantity: trade.quantity,
    entryPrice,
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO paper_trades (
         symbol,
         exchange,
         trade_type,
         entry_price,
         quantity,
         stop_loss,
         target_price,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN')
       RETURNING *`,
      [
        trade.symbol,
        trade.exchange,
        normalizedType,
        entryPrice,
        trade.quantity,
        trade.stopLoss,
        trade.targetPrice,
      ]
    );

    await createPositionForTrade(client, result.rows[0]);
    await client.query("COMMIT");
    const mapped = mapPaperTrade(result.rows[0]);
    const { safeRecordAudit } = require("./auditTrail.service");
    await safeRecordAudit({
      category: "ORDER",
      action: "PAPER_TRADE_OPENED",
      severity: "INFO",
      entityType: "PAPER_TRADE",
      entityId: mapped.id,
      message: `${mapped.tradeType} paper trade opened`,
      metadata: {
        symbol: mapped.symbol,
        exchange: mapped.exchange,
        quantity: mapped.quantity,
        entryPrice: mapped.entryPrice,
      },
    });
    return mapped;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getPaperTrades(status) {
  const values = [];
  let whereClause = "";

  if (status) {
    whereClause = "WHERE status = $1";
    values.push(status);
  }

  const result = await pool.query(
    `SELECT *
     FROM paper_trades
     ${whereClause}
     ORDER BY created_at DESC, id DESC`,
    values
  );

  return result.rows.map(mapPaperTrade);
}

async function exitPaperTrade(id, input = {}) {
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId) || tradeId <= 0) {
    throw new PaperTradeError("Trade ID must be a positive integer", 400);
  }

  const providedExitPrice = parseOptionalPrice(
    input.exitPrice,
    "exitPrice"
  );
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const tradeResult = await client.query(
      `SELECT *
       FROM paper_trades
       WHERE id = $1
       FOR UPDATE`,
      [tradeId]
    );

    if (tradeResult.rows.length === 0) {
      throw new PaperTradeError("Paper trade not found", 404);
    }

    const trade = tradeResult.rows[0];
    if (trade.status !== "OPEN") {
      throw new PaperTradeError("Paper trade is already closed", 409);
    }

    const exitPrice = await resolvePrice(
      trade.symbol,
      trade.exchange,
      providedExitPrice
    );
    const entryPrice = Number(trade.entry_price);
    const direction = trade.trade_type === "BUY" ? 1 : -1;
    const pnl = (exitPrice - entryPrice) * trade.quantity * direction;
    const result = await client.query(
      `UPDATE paper_trades
       SET status = 'CLOSED',
           exit_price = $1,
           pnl = $2,
           closed_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [exitPrice, Number(pnl.toFixed(2)), tradeId]
    );

    await closePositionForTrade(
      client,
      tradeId,
      exitPrice,
      Number(pnl.toFixed(2))
    );
    await createJournalForTrade(client, result.rows[0]);
    await client.query("COMMIT");
    const mapped = mapPaperTrade(result.rows[0]);
    const { safeRecordAudit } = require("./auditTrail.service");
    await safeRecordAudit({
      category: "ORDER",
      action: "PAPER_TRADE_CLOSED",
      severity: mapped.pnl < 0 ? "WARNING" : "INFO",
      entityType: "PAPER_TRADE",
      entityId: mapped.id,
      message: "Paper trade closed",
      metadata: {
        symbol: mapped.symbol,
        exitPrice: mapped.exitPrice,
        pnl: mapped.pnl,
      },
    });
    return mapped;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function emergencyCloseAllPaperTrades() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT
         paper_trades.*,
         COALESCE(positions.current_price, paper_trades.entry_price)
           AS emergency_exit_price
       FROM paper_trades
       LEFT JOIN positions ON positions.trade_id = paper_trades.id
       WHERE paper_trades.status = 'OPEN'
       FOR UPDATE OF paper_trades`
    );
    const closedTrades = [];

    for (const trade of result.rows) {
      const exitPrice = Number(trade.emergency_exit_price);
      const entryPrice = Number(trade.entry_price);
      const direction = trade.trade_type === "BUY" ? 1 : -1;
      const pnl = Number(
        (
          (exitPrice - entryPrice) *
          trade.quantity *
          direction
        ).toFixed(2)
      );
      const update = await client.query(
        `UPDATE paper_trades
         SET status = 'CLOSED',
             exit_price = $1,
             pnl = $2,
             closed_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [exitPrice, pnl, trade.id]
      );

      await closePositionForTrade(client, trade.id, exitPrice, pnl);
      await createJournalForTrade(client, update.rows[0]);
      closedTrades.push(mapPaperTrade(update.rows[0]));
    }

    await client.query("COMMIT");
    return closedTrades;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  PaperTradeError,
  createPaperTrade,
  getPaperTrades,
  exitPaperTrade,
  emergencyCloseAllPaperTrades,
};
