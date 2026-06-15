const pool = require("../config/db");
const { getSymbolQuote } = require("./market.service");

const QUOTE_TTL_MS = 5000;
const quoteCache = new Map();

class PositionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "PositionError";
    this.statusCode = statusCode;
  }
}

async function getCachedQuote(symbol) {
  const cached = quoteCache.get(symbol);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.promise;
  }

  const promise = getSymbolQuote(symbol).catch((error) => {
    quoteCache.delete(symbol);
    throw error;
  });

  quoteCache.set(symbol, {
    promise,
    expiresAt: Date.now() + QUOTE_TTL_MS,
  });

  return promise;
}

function calculatePositionMetrics(position, currentPrice) {
  const averagePrice = Number(position.average_price);
  const quantity = Number(position.quantity);
  const direction = position.side === "BUY" ? 1 : -1;
  const unrealizedPnl =
    (currentPrice - averagePrice) * quantity * direction;

  return {
    currentPrice,
    unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    totalPositionValue: Number((currentPrice * quantity).toFixed(2)),
  };
}

function mapPosition(row, totalPositionValue) {
  const currentPrice = Number(row.current_price);

  return {
    id: row.id,
    tradeId: row.trade_id,
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.side,
    quantity: row.quantity,
    averagePrice: Number(row.average_price),
    currentPrice,
    unrealizedPnl: Number(row.unrealized_pnl),
    realizedPnl: Number(row.realized_pnl),
    totalPositionValue:
      totalPositionValue ?? Number((currentPrice * row.quantity).toFixed(2)),
    status: row.status,
    createdAt: row.created_at,
  };
}

async function createPositionForTrade(client, trade) {
  const result = await client.query(
    `INSERT INTO positions (
       trade_id,
       symbol,
       exchange,
       side,
       quantity,
       average_price,
       current_price,
       status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'OPEN')
     ON CONFLICT (trade_id)
     DO UPDATE SET
       symbol = EXCLUDED.symbol,
       exchange = EXCLUDED.exchange,
       side = EXCLUDED.side,
       quantity = EXCLUDED.quantity,
       average_price = EXCLUDED.average_price,
       current_price = EXCLUDED.current_price,
       unrealized_pnl = 0,
       realized_pnl = 0,
       status = 'OPEN'
     RETURNING *`,
    [
      trade.id,
      trade.symbol,
      trade.exchange,
      trade.trade_type,
      trade.quantity,
      trade.entry_price,
    ]
  );

  return result.rows[0];
}

async function closePositionForTrade(client, tradeId, exitPrice, realizedPnl) {
  const result = await client.query(
    `UPDATE positions
     SET current_price = $1,
         unrealized_pnl = 0,
         realized_pnl = $2,
         status = 'CLOSED'
     WHERE trade_id = $3
     RETURNING *`,
    [exitPrice, realizedPnl, tradeId]
  );

  if (result.rows.length === 0) {
    throw new PositionError("Position for paper trade was not found", 500);
  }

  return result.rows[0];
}

async function refreshOpenPosition(row) {
  let currentPrice = Number(row.current_price);

  if (row.exchange === "NSE") {
    const quote = await getCachedQuote(row.symbol);
    currentPrice = quote.ltp;
  }

  const metrics = calculatePositionMetrics(row, currentPrice);
  const result = await pool.query(
    `UPDATE positions
     SET current_price = $1,
         unrealized_pnl = $2
     WHERE id = $3
     RETURNING *`,
    [metrics.currentPrice, metrics.unrealizedPnl, row.id]
  );

  return mapPosition(result.rows[0], metrics.totalPositionValue);
}

async function getPositions(status) {
  const values = [];
  let whereClause = "";

  if (status) {
    whereClause = "WHERE status = $1";
    values.push(status);
  }

  const result = await pool.query(
    `SELECT *
     FROM positions
     ${whereClause}
     ORDER BY created_at DESC, id DESC`,
    values
  );

  return Promise.all(
    result.rows.map((row) =>
      row.status === "OPEN" ? refreshOpenPosition(row) : mapPosition(row)
    )
  );
}

async function getPositionById(id) {
  const positionId = Number(id);

  if (!Number.isInteger(positionId) || positionId <= 0) {
    throw new PositionError("Position ID must be a positive integer", 400);
  }

  const result = await pool.query(
    `SELECT *
     FROM positions
     WHERE id = $1`,
    [positionId]
  );

  if (result.rows.length === 0) {
    throw new PositionError("Position not found", 404);
  }

  const position = result.rows[0];
  return position.status === "OPEN"
    ? refreshOpenPosition(position)
    : mapPosition(position);
}

async function hasOpenPositionForSymbol(symbol) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM positions
       WHERE status = 'OPEN'
         AND UPPER(symbol) = UPPER($1)
     ) AS has_open_position`,
    [symbol]
  );

  return result.rows[0].has_open_position;
}

module.exports = {
  PositionError,
  calculatePositionMetrics,
  createPositionForTrade,
  closePositionForTrade,
  getPositions,
  getPositionById,
  hasOpenPositionForSymbol,
};
