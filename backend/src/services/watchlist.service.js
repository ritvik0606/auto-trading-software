const pool = require("../config/db");

const ALLOWED_EXCHANGES = new Set([
  "NSE",
  "BSE",
  "NFO",
  "BFO",
  "MCX",
  "CDS",
]);

class WatchlistError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "WatchlistError";
    this.statusCode = statusCode;
  }
}

function normalizeWatchlistInput({ symbol, exchange = "NSE", symbolToken }) {
  const normalizedSymbol =
    typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  const normalizedExchange =
    typeof exchange === "string" ? exchange.trim().toUpperCase() : "";
  const normalizedToken =
    typeof symbolToken === "string" && symbolToken.trim()
      ? symbolToken.trim()
      : null;

  if (!normalizedSymbol) {
    throw new WatchlistError("Symbol is required", 400);
  }

  if (
    normalizedSymbol.length > 50 ||
    !/^[A-Z0-9&.-]+$/.test(normalizedSymbol)
  ) {
    throw new WatchlistError("Symbol is invalid", 400);
  }

  if (!ALLOWED_EXCHANGES.has(normalizedExchange)) {
    throw new WatchlistError(
      `Exchange must be one of: ${Array.from(ALLOWED_EXCHANGES).join(", ")}`,
      400
    );
  }

  if (normalizedToken && normalizedToken.length > 50) {
    throw new WatchlistError(
      "Symbol token must be 50 characters or fewer",
      400
    );
  }

  return {
    symbol: normalizedSymbol,
    exchange: normalizedExchange,
    symbolToken: normalizedToken,
  };
}

async function addWatchlistItem(input) {
  const { symbol, exchange, symbolToken } = normalizeWatchlistInput(input);

  try {
    const result = await pool.query(
      `INSERT INTO watchlists (symbol, exchange, symbol_token)
       VALUES ($1, $2, $3)
       RETURNING id, symbol, exchange, symbol_token, created_at`,
      [symbol, exchange, symbolToken]
    );

    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw new WatchlistError(
        `${symbol} already exists in the ${exchange} watchlist`,
        409
      );
    }

    throw error;
  }
}

async function getWatchlist() {
  const result = await pool.query(
    `SELECT id, symbol, exchange, symbol_token, created_at
     FROM watchlists
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows;
}

async function deleteWatchlistItem(id) {
  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new WatchlistError("Watchlist ID must be a positive integer", 400);
  }

  const result = await pool.query(
    `DELETE FROM watchlists
     WHERE id = $1
     RETURNING id, symbol, exchange, symbol_token, created_at`,
    [numericId]
  );

  if (result.rows.length === 0) {
    throw new WatchlistError("Watchlist item not found", 404);
  }

  return result.rows[0];
}

module.exports = {
  WatchlistError,
  addWatchlistItem,
  getWatchlist,
  deleteWatchlistItem,
};
