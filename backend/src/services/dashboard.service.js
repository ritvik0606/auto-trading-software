const pool = require("../config/db");
const { getWatchlist } = require("./watchlist.service");
const { getRiskSettings } = require("./risk.service");
const { getBrokerStatus } = require("./broker.service");

class DashboardError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "DashboardError";
    this.statusCode = statusCode;
  }
}

async function getDashboardSummary() {
  try {
    const [portfolioResult, watchlist] = await Promise.all([
      pool.query(
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
           ) AS capital,
           COALESCE(
             SUM(
               CASE
                 WHEN status = 'OPEN'
                 THEN COALESCE(quantity, 0) * COALESCE(entry_price, 0)
                 ELSE 0
               END
             ),
             0
           ) AS used_capital,
           COALESCE(
             SUM(
               CASE
                 WHEN created_at::date = CURRENT_DATE
                 THEN COALESCE(pnl, 0)
                 ELSE 0
               END
             ),
             0
           ) AS today_pnl,
           COUNT(*) FILTER (WHERE status = 'OPEN') AS open_positions
         FROM trades`
      ),
      getWatchlist(),
    ]);

    const row = portfolioResult.rows[0];
    const capital = Number(row.capital);
    const usedCapital = Number(row.used_capital);

    return {
      capital,
      usedCapital,
      availableCapital: Number((capital - usedCapital).toFixed(2)),
      todayPnL: Number(row.today_pnl),
      openPositions: Number(row.open_positions),
      watchlistCount: watchlist.length,
    };
  } catch (error) {
    throw new DashboardError("Unable to load dashboard summary");
  }
}

async function getWatchlistSummary() {
  try {
    const items = await getWatchlist();

    return {
      count: items.length,
      symbols: items.map((item) => item.symbol),
    };
  } catch (error) {
    throw new DashboardError("Unable to load watchlist summary");
  }
}

async function getRiskSummary() {
  try {
    return await getRiskSettings();
  } catch (error) {
    throw new DashboardError("Unable to load risk summary");
  }
}

async function getDashboardBrokerStatus() {
  return getBrokerStatus();
}

module.exports = {
  DashboardError,
  getDashboardSummary,
  getDashboardBrokerStatus,
  getWatchlistSummary,
  getRiskSummary,
};
