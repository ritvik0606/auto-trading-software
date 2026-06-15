const pool = require("../config/db");

class JournalError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "JournalError";
    this.statusCode = statusCode;
  }
}

function getTradeResult(pnl) {
  if (pnl > 0) {
    return "WIN";
  }

  if (pnl < 0) {
    return "LOSS";
  }

  return "BREAKEVEN";
}

function mapJournal(row) {
  return {
    id: row.id,
    tradeId: row.trade_id,
    symbol: row.symbol,
    side: row.side,
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    quantity: row.quantity,
    pnl: Number(row.pnl),
    result: row.result,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

async function createJournalForTrade(client, trade) {
  const pnl = Number(trade.pnl);
  const result = await client.query(
    `INSERT INTO trade_journal (
       trade_id,
       symbol,
       side,
       entry_price,
       exit_price,
       quantity,
       pnl,
       result
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (trade_id)
     DO UPDATE SET
       symbol = EXCLUDED.symbol,
       side = EXCLUDED.side,
       entry_price = EXCLUDED.entry_price,
       exit_price = EXCLUDED.exit_price,
       quantity = EXCLUDED.quantity,
       pnl = EXCLUDED.pnl,
       result = EXCLUDED.result
     RETURNING *`,
    [
      trade.id,
      trade.symbol,
      trade.trade_type,
      trade.entry_price,
      trade.exit_price,
      trade.quantity,
      pnl,
      getTradeResult(pnl),
    ]
  );

  return mapJournal(result.rows[0]);
}

async function getJournalEntries() {
  const result = await pool.query(
    `SELECT *
     FROM trade_journal
     ORDER BY created_at DESC, id DESC`
  );

  return result.rows.map(mapJournal);
}

async function getJournalById(id) {
  const journalId = Number(id);

  if (!Number.isInteger(journalId) || journalId <= 0) {
    throw new JournalError("Journal ID must be a positive integer", 400);
  }

  const result = await pool.query(
    `SELECT *
     FROM trade_journal
     WHERE id = $1`,
    [journalId]
  );

  if (result.rows.length === 0) {
    throw new JournalError("Journal entry not found", 404);
  }

  return mapJournal(result.rows[0]);
}

async function updateJournalNote(id, notes) {
  const journalId = Number(id);

  if (!Number.isInteger(journalId) || journalId <= 0) {
    throw new JournalError("Journal ID must be a positive integer", 400);
  }

  if (typeof notes !== "string" || !notes.trim()) {
    throw new JournalError("Notes are required", 400);
  }

  const normalizedNotes = notes.trim();
  if (normalizedNotes.length > 5000) {
    throw new JournalError(
      "Notes must be 5000 characters or fewer",
      400
    );
  }

  const result = await pool.query(
    `UPDATE trade_journal
     SET notes = $1
     WHERE id = $2
     RETURNING *`,
    [normalizedNotes, journalId]
  );

  if (result.rows.length === 0) {
    throw new JournalError("Journal entry not found", 404);
  }

  return mapJournal(result.rows[0]);
}

async function getJournalStats() {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS total_trades,
       COUNT(*) FILTER (WHERE pnl > 0) AS winning_trades,
       COUNT(*) FILTER (WHERE pnl < 0) AS losing_trades,
       COALESCE(SUM(pnl), 0) AS total_pnl
     FROM trade_journal`
  );
  const row = result.rows[0];
  const totalTrades = Number(row.total_trades);
  const winningTrades = Number(row.winning_trades);

  return {
    totalTrades,
    winningTrades,
    losingTrades: Number(row.losing_trades),
    winRate:
      totalTrades === 0
        ? 0
        : Number(((winningTrades / totalTrades) * 100).toFixed(2)),
    totalPnL: Number(row.total_pnl),
  };
}

module.exports = {
  JournalError,
  getTradeResult,
  createJournalForTrade,
  getJournalEntries,
  getJournalById,
  updateJournalNote,
  getJournalStats,
};
