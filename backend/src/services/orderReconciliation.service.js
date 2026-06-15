const pool = require("../config/db");
const {
  ensureSchema: ensureExecutionSchema,
} = require("./executionAnalytics.service");

let schemaReady = null;

class OrderReconciliationError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "OrderReconciliationError";
    this.statusCode = statusCode;
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureExecutionSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS order_reconciliation_runs (
          id SERIAL PRIMARY KEY,
          status VARCHAR(20) NOT NULL,
          summary JSONB NOT NULL,
          issues JSONB NOT NULL,
          coverage JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function issue(type, severity, source, recordId, message, details = {}) {
  return { type, severity, source, recordId, message, details };
}

async function collectIssues() {
  await ensureSchema();
  const [paper, simulator, broker, orphanPositions] = await Promise.all([
    pool.query(
      `SELECT
         trades.id AS trade_id,
         trades.symbol AS trade_symbol,
         trades.trade_type,
         trades.quantity AS trade_quantity,
         trades.status AS trade_status,
         positions.id AS position_id,
         positions.symbol AS position_symbol,
         positions.side AS position_side,
         positions.quantity AS position_quantity,
         positions.status AS position_status
       FROM paper_trades trades
       LEFT JOIN positions ON positions.trade_id = trades.id`
    ),
    pool.query(
      `SELECT
         orders.id AS order_id,
         orders.position_id,
         orders.symbol AS order_symbol,
         orders.side AS order_side,
         orders.quantity AS order_quantity,
         orders.order_action,
         orders.status AS order_status,
         positions.symbol AS position_symbol,
         positions.side AS position_side,
         positions.quantity AS position_quantity,
         positions.status AS position_status
       FROM paper_simulator_orders orders
       LEFT JOIN paper_simulator_positions positions
         ON positions.id = orders.position_id`
    ),
    pool.query(
      `SELECT
         orders.id,
         orders.symbol,
         orders.status,
         orders.mode,
         orders.broker_order_id,
         orders.strategy_trade_id,
         paper_trades.id AS linked_trade_id
       FROM orders
       LEFT JOIN paper_trades
         ON paper_trades.id = orders.strategy_trade_id`
    ),
    pool.query(
      `SELECT positions.id, positions.trade_id, positions.symbol
       FROM positions
       LEFT JOIN paper_trades ON paper_trades.id = positions.trade_id
       WHERE paper_trades.id IS NULL`
    ),
  ]);

  const issues = [];
  paper.rows.forEach((row) => {
    if (!row.position_id) {
      issues.push(
        issue(
          "MISSING_POSITION",
          "CRITICAL",
          "PAPER_ENGINE",
          row.trade_id,
          "Paper trade has no portfolio position",
          { symbol: row.trade_symbol }
        )
      );
      return;
    }
    const mismatches = {};
    if (row.trade_symbol !== row.position_symbol) mismatches.symbol = true;
    if (row.trade_type !== row.position_side) mismatches.side = true;
    if (Number(row.trade_quantity) !== Number(row.position_quantity)) {
      mismatches.quantity = true;
    }
    if (row.trade_status !== row.position_status) mismatches.status = true;
    if (Object.keys(mismatches).length > 0) {
      issues.push(
        issue(
          "POSITION_MISMATCH",
          "CRITICAL",
          "PAPER_ENGINE",
          row.trade_id,
          "Paper trade and portfolio position do not match",
          mismatches
        )
      );
    }
  });
  orphanPositions.rows.forEach((row) => {
    issues.push(
      issue(
        "ORPHAN_POSITION",
        "CRITICAL",
        "PORTFOLIO",
        row.id,
        "Portfolio position references a missing paper trade",
        { tradeId: row.trade_id, symbol: row.symbol }
      )
    );
  });
  simulator.rows.forEach((row) => {
    if (!row.position_id || !row.position_symbol) {
      issues.push(
        issue(
          "MISSING_SIMULATOR_POSITION",
          "CRITICAL",
          "PAPER_SIMULATOR",
          row.order_id,
          "Simulator order has no matching position"
        )
      );
      return;
    }
    if (
      row.order_symbol !== row.position_symbol ||
      Number(row.order_quantity) !== Number(row.position_quantity)
    ) {
      issues.push(
        issue(
          "SIMULATOR_POSITION_MISMATCH",
          "CRITICAL",
          "PAPER_SIMULATOR",
          row.order_id,
          "Simulator order and position do not match"
        )
      );
    }
  });
  broker.rows.forEach((row) => {
    const filled = ["FILLED", "COMPLETE", "COMPLETED", "EXECUTED"].includes(
      String(row.status || "").toUpperCase()
    );
    if (row.mode === "REAL" && filled && !row.broker_order_id) {
      issues.push(
        issue(
          "MISSING_BROKER_ORDER_ID",
          "CRITICAL",
          "BROKER",
          row.id,
          "Filled real order has no broker order identifier",
          { symbol: row.symbol }
        )
      );
    }
    if (row.strategy_trade_id && !row.linked_trade_id) {
      issues.push(
        issue(
          "MISSING_STRATEGY_ORDER",
          "WARNING",
          "BROKER",
          row.id,
          "Broker order references a missing strategy trade",
          { strategyTradeId: row.strategy_trade_id }
        )
      );
    }
  });

  return {
    issues,
    coverage: {
      strategyOrders: paper.rows.length,
      brokerAuditOrders: broker.rows.length,
      linkedBrokerOrders: broker.rows.filter((row) => row.strategy_trade_id)
        .length,
      portfolioPositions: paper.rows.filter((row) => row.position_id).length,
      simulatorOrders: simulator.rows.length,
      paperOnlyStrategyOrdersExpectedWithoutBroker:
        paper.rows.length -
        broker.rows.filter((row) => row.strategy_trade_id).length,
    },
  };
}

function summarize(issues) {
  const critical = issues.filter((item) => item.severity === "CRITICAL").length;
  const warnings = issues.filter((item) => item.severity === "WARNING").length;
  return {
    totalIssues: issues.length,
    criticalIssues: critical,
    warnings,
    missingOrders: issues.filter((item) =>
      item.type.includes("MISSING")
    ).length,
    positionMismatches: issues.filter((item) =>
      item.type.includes("POSITION")
    ).length,
  };
}

async function runReconciliation() {
  const { issues, coverage } = await collectIssues();
  const summary = summarize(issues);
  const status =
    summary.criticalIssues > 0
      ? "FAILED"
      : summary.warnings > 0
        ? "WARNING"
        : "RECONCILED";
  const result = await pool.query(
    `INSERT INTO order_reconciliation_runs (
       status, summary, issues, coverage
     )
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
     RETURNING *`,
    [
      status,
      JSON.stringify(summary),
      JSON.stringify(issues),
      JSON.stringify(coverage),
    ]
  );
  return mapReport(result.rows[0]);
}

function mapReport(row) {
  return {
    id: row.id,
    status: row.status,
    summary: row.summary || {},
    issues: row.issues || [],
    coverage: row.coverage || {},
    createdAt: row.created_at,
  };
}

async function getReport() {
  await ensureSchema();
  const result = await pool.query(
    `SELECT *
     FROM order_reconciliation_runs
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  );
  if (result.rows.length === 0) {
    return runReconciliation();
  }

  const report = mapReport(result.rows[0]);
  const ageMs = Date.now() - new Date(report.createdAt).getTime();
  return ageMs > 5 * 60 * 1000 ? runReconciliation() : report;
}

module.exports = {
  OrderReconciliationError,
  ensureSchema,
  collectIssues,
  runReconciliation,
  getReport,
};
