const pool = require("../config/db");

const COPY_INTERVAL_MS = 30 * 1000;
const groupRunners = new Map();

class TradeCopierError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "TradeCopierError";
    this.statusCode = statusCode;
  }
}

function parseId(value, fieldName) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new TradeCopierError(
      `${fieldName} must be a positive integer`,
      400
    );
  }

  return id;
}

function normalizeName(value, fieldName, maxLength = 100) {
  const name = typeof value === "string" ? value.trim() : "";

  if (!name || name.length > maxLength || !/^[A-Za-z0-9 _.-]+$/.test(name)) {
    throw new TradeCopierError(`${fieldName} is invalid`, 400);
  }

  return name;
}

function mapGroup(row) {
  return {
    id: row.id,
    groupName: row.group_name,
    masterStrategy: row.master_strategy,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapFollower(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    followerName: row.follower_name,
    capitalMultiplier: Number(row.capital_multiplier),
    maxPositionSize: row.max_position_size,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapLog(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    followerId: row.follower_id,
    followerName: row.follower_name || null,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    masterTradeId: row.master_trade_id,
    copiedTradeId: row.copied_trade_id,
    executionStatus: row.execution_status,
    copiedAt: row.copied_at,
  };
}

async function getGroup(groupId, client = pool) {
  const result = await client.query(
    `SELECT *
     FROM trade_copier_groups
     WHERE id = $1`,
    [parseId(groupId, "groupId")]
  );

  if (result.rows.length === 0) {
    throw new TradeCopierError("Trade copier group not found", 404);
  }

  return result.rows[0];
}

async function createGroup(input = {}) {
  const groupName = normalizeName(input.groupName, "groupName");
  const masterStrategy = normalizeName(
    input.masterStrategy,
    "masterStrategy"
  ).toUpperCase();

  try {
    const result = await pool.query(
      `INSERT INTO trade_copier_groups (
         group_name,
         master_strategy,
         status
       )
       VALUES ($1, $2, 'STOPPED')
       RETURNING *`,
      [groupName, masterStrategy]
    );

    return mapGroup(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new TradeCopierError("Group name already exists", 409);
    }
    throw error;
  }
}

async function addFollower(input = {}) {
  const groupId = parseId(input.groupId, "groupId");
  const followerName = normalizeName(
    input.followerName,
    "followerName"
  );
  const capitalMultiplier = Number(input.capitalMultiplier);
  const maxPositionSize = Number(input.maxPositionSize);

  await getGroup(groupId);

  if (
    !Number.isFinite(capitalMultiplier) ||
    capitalMultiplier <= 0 ||
    capitalMultiplier > 100
  ) {
    throw new TradeCopierError(
      "capitalMultiplier must be between 0 and 100",
      400
    );
  }

  if (!Number.isInteger(maxPositionSize) || maxPositionSize <= 0) {
    throw new TradeCopierError(
      "maxPositionSize must be a positive integer",
      400
    );
  }

  try {
    const result = await pool.query(
      `INSERT INTO trade_copier_followers (
         group_id,
         follower_name,
         capital_multiplier,
         max_position_size,
         status
       )
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       RETURNING *`,
      [groupId, followerName, capitalMultiplier, maxPositionSize]
    );

    return mapFollower(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new TradeCopierError(
        "Follower name already exists in this group",
        409
      );
    }
    throw error;
  }
}

async function getMasterTrades(group) {
  const result = await pool.query(
    `SELECT paper_trades.*
     FROM paper_trades
     INNER JOIN multi_strategies
       ON multi_strategies.id = paper_trades.multi_strategy_id
     WHERE UPPER(multi_strategies.strategy_name) =
       UPPER($1)
       AND paper_trades.copier_master_trade_id IS NULL
       AND paper_trades.created_at >= $2
     ORDER BY paper_trades.created_at, paper_trades.id`,
    [group.master_strategy, group.created_at]
  );

  return result.rows;
}

async function getActiveFollowers(groupId) {
  const result = await pool.query(
    `SELECT *
     FROM trade_copier_followers
     WHERE group_id = $1
       AND status = 'ACTIVE'
     ORDER BY id`,
    [groupId]
  );

  return result.rows;
}

function calculateFollowerQuantity(masterQuantity, follower) {
  const scaled = Math.floor(
    Number(masterQuantity) * Number(follower.capital_multiplier)
  );

  if (scaled < 1) {
    throw new TradeCopierError(
      "Follower quantity is below one unit",
      400
    );
  }

  return Math.min(scaled, follower.max_position_size);
}

async function copyTradeForFollower(group, follower, masterTrade) {
  const client = await pool.connect();
  let quantity;

  try {
    quantity = calculateFollowerQuantity(
      masterTrade.quantity,
      follower
    );
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT
         trade_copier_logs.id,
         trade_copier_logs.copied_trade_id,
         paper_trades.status AS copied_status,
         paper_trades.entry_price AS copied_entry_price,
         paper_trades.quantity AS copied_quantity
       FROM trade_copier_logs
       LEFT JOIN paper_trades
         ON paper_trades.id =
           trade_copier_logs.copied_trade_id
       WHERE group_id = $1
         AND follower_id = $2
         AND master_trade_id = $3`,
      [group.id, follower.id, masterTrade.id]
    );

    if (existing.rows.length > 0) {
      const copied = existing.rows[0];
      if (
        masterTrade.status === "CLOSED" &&
        copied.copied_trade_id &&
        copied.copied_status === "OPEN"
      ) {
        const direction = masterTrade.trade_type === "BUY" ? 1 : -1;
        const pnl = Number(
          (
            (Number(masterTrade.exit_price) -
              Number(copied.copied_entry_price)) *
            Number(copied.copied_quantity) *
            direction
          ).toFixed(2)
        );
        const tradeResult = await client.query(
          `UPDATE paper_trades
           SET status = 'CLOSED',
               exit_price = $1,
               pnl = $2,
               closed_at = $3
           WHERE id = $4
           RETURNING *`,
          [
            masterTrade.exit_price,
            pnl,
            masterTrade.closed_at,
            copied.copied_trade_id,
          ]
        );
        const copiedTrade = tradeResult.rows[0];
        await client.query(
          `UPDATE positions
           SET current_price = $1,
               unrealized_pnl = 0,
               realized_pnl = $2,
               status = 'CLOSED'
           WHERE trade_id = $3`,
          [copiedTrade.exit_price, pnl, copiedTrade.id]
        );
        const result =
          pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN";
        await client.query(
          `INSERT INTO trade_journal (
             trade_id,
             symbol,
             side,
             entry_price,
             exit_price,
             quantity,
             pnl,
             result,
             notes,
             created_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10
           )
           ON CONFLICT (trade_id) DO NOTHING`,
          [
            copiedTrade.id,
            copiedTrade.symbol,
            copiedTrade.trade_type,
            copiedTrade.entry_price,
            copiedTrade.exit_price,
            copiedTrade.quantity,
            copiedTrade.pnl,
            result,
            `Paper copy for follower ${follower.follower_name}`,
            copiedTrade.closed_at,
          ]
        );
        await client.query("COMMIT");
        return {
          status: "SUCCESS",
          copiedTradeId: copiedTrade.id,
          action: "FOLLOWER_TRADE_CLOSED",
        };
      }

      await client.query("ROLLBACK");
      return { status: "DUPLICATE_SKIPPED" };
    }

    const direction = masterTrade.trade_type === "BUY" ? 1 : -1;
    const pnl =
      masterTrade.status === "CLOSED"
        ? Number(
            (
              (Number(masterTrade.exit_price) -
                Number(masterTrade.entry_price)) *
              quantity *
              direction
            ).toFixed(2)
          )
        : 0;
    const tradeResult = await client.query(
      `INSERT INTO paper_trades (
         symbol,
         exchange,
         trade_type,
         entry_price,
         quantity,
         stop_loss,
         target_price,
         status,
         exit_price,
         pnl,
         created_at,
         closed_at,
         copier_master_trade_id,
         copier_follower_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14
       )
       RETURNING *`,
      [
        masterTrade.symbol,
        masterTrade.exchange,
        masterTrade.trade_type,
        masterTrade.entry_price,
        quantity,
        masterTrade.stop_loss,
        masterTrade.target_price,
        masterTrade.status,
        masterTrade.exit_price,
        pnl,
        masterTrade.created_at,
        masterTrade.closed_at,
        masterTrade.id,
        follower.id,
      ]
    );
    const copiedTrade = tradeResult.rows[0];

    await client.query(
      `INSERT INTO positions (
         trade_id,
         symbol,
         exchange,
         side,
         quantity,
         average_price,
         current_price,
         unrealized_pnl,
         realized_pnl,
         status,
         created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, 0, $8, $9, $10
       )`,
      [
        copiedTrade.id,
        copiedTrade.symbol,
        copiedTrade.exchange,
        copiedTrade.trade_type,
        copiedTrade.quantity,
        copiedTrade.entry_price,
        copiedTrade.exit_price || copiedTrade.entry_price,
        pnl,
        copiedTrade.status,
        copiedTrade.created_at,
      ]
    );

    if (copiedTrade.status === "CLOSED") {
      const result =
        pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN";
      await client.query(
        `INSERT INTO trade_journal (
           trade_id,
           symbol,
           side,
           entry_price,
           exit_price,
           quantity,
           pnl,
           result,
           notes,
           created_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10
         )`,
        [
          copiedTrade.id,
          copiedTrade.symbol,
          copiedTrade.trade_type,
          copiedTrade.entry_price,
          copiedTrade.exit_price,
          copiedTrade.quantity,
          copiedTrade.pnl,
          result,
          `Paper copy for follower ${follower.follower_name}`,
          copiedTrade.closed_at || copiedTrade.created_at,
        ]
      );
    }

    await client.query(
      `INSERT INTO trade_copier_logs (
         group_id,
         follower_id,
         symbol,
         side,
         quantity,
         master_trade_id,
         copied_trade_id,
         execution_status,
         copied_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUCCESS', $8)`,
      [
        group.id,
        follower.id,
        copiedTrade.symbol,
        copiedTrade.trade_type,
        copiedTrade.quantity,
        masterTrade.id,
        copiedTrade.id,
        masterTrade.created_at,
      ]
    );
    await client.query("COMMIT");

    return {
      status: "SUCCESS",
      copiedTradeId: copiedTrade.id,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return { status: "DUPLICATE_SKIPPED" };
    }

    try {
      await pool.query(
        `INSERT INTO trade_copier_logs (
           group_id,
           follower_id,
           symbol,
           side,
           quantity,
           master_trade_id,
           execution_status,
           copied_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'FAILED', $7)
         ON CONFLICT (
           group_id,
           follower_id,
           master_trade_id
         ) DO NOTHING`,
        [
          group.id,
          follower.id,
          masterTrade.symbol,
          masterTrade.trade_type,
          quantity || 0,
          masterTrade.id,
          masterTrade.created_at,
        ]
      );
    } catch (logError) {
      console.error("Unable to log failed paper copy", {
        groupId: group.id,
        followerId: follower.id,
        message: logError.message,
      });
    }

    return {
      status: "FAILED",
      message: error.message,
    };
  } finally {
    client.release();
  }
}

async function syncGroup(groupId) {
  const group = await getGroup(groupId);
  if (group.status !== "RUNNING") {
    return {
      groupId: group.id,
      masterTrades: 0,
      successfulCopies: 0,
      failedCopies: 0,
      duplicateCopies: 0,
    };
  }

  const [followers, masterTrades] = await Promise.all([
    getActiveFollowers(group.id),
    getMasterTrades(group),
  ]);
  let successfulCopies = 0;
  let failedCopies = 0;
  let duplicateCopies = 0;

  for (const masterTrade of masterTrades) {
    for (const follower of followers) {
      const result = await copyTradeForFollower(
        group,
        follower,
        masterTrade
      );
      if (result.status === "SUCCESS") {
        successfulCopies += 1;
      } else if (result.status === "FAILED") {
        failedCopies += 1;
      } else {
        duplicateCopies += 1;
      }
    }
  }

  return {
    groupId: group.id,
    masterTrades: masterTrades.length,
    successfulCopies,
    failedCopies,
    duplicateCopies,
  };
}

function startRunner(groupId) {
  if (groupRunners.has(groupId)) {
    return;
  }

  const timer = setInterval(() => {
    syncGroup(groupId).catch((error) => {
      console.error("Trade copier sync failed", {
        groupId,
        message: error.message,
      });
    });
  }, COPY_INTERVAL_MS);
  timer.unref();
  groupRunners.set(groupId, timer);
}

async function startCopier(groupId) {
  const id = parseId(groupId, "groupId");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const group = await getGroup(id, client);

    if (group.status === "RUNNING") {
      throw new TradeCopierError("Copier group is already running", 409);
    }

    const followers = await client.query(
      `SELECT COUNT(*) AS count
       FROM trade_copier_followers
       WHERE group_id = $1
         AND status = 'ACTIVE'`,
      [id]
    );
    if (Number(followers.rows[0].count) === 0) {
      throw new TradeCopierError(
        "At least one active follower is required",
        400
      );
    }

    await client.query(
      `UPDATE trade_copier_groups
       SET status = 'RUNNING'
       WHERE id = $1`,
      [id]
    );
    await client.query("COMMIT");
    startRunner(id);

    return {
      group: mapGroup({ ...group, status: "RUNNING" }),
      sync: await syncGroup(id),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function stopCopier(groupId) {
  const id = parseId(groupId, "groupId");
  const group = await getGroup(id);

  if (group.status === "STOPPED") {
    throw new TradeCopierError("Copier group is already stopped", 409);
  }

  const timer = groupRunners.get(id);
  if (timer) {
    clearInterval(timer);
    groupRunners.delete(id);
  }

  const result = await pool.query(
    `UPDATE trade_copier_groups
     SET status = 'STOPPED'
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  return mapGroup(result.rows[0]);
}

async function getGroupStatus(groupId) {
  const group = await getGroup(groupId);
  const result = await pool.query(
    `SELECT
       COUNT(*) AS followers,
       COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_followers
     FROM trade_copier_followers
     WHERE group_id = $1`,
    [group.id]
  );

  return {
    group: group.group_name,
    status: group.status,
    followers: Number(result.rows[0].followers),
    activeFollowers: Number(result.rows[0].active_followers),
    masterStrategy: group.master_strategy,
  };
}

async function getTradeHistory(groupId) {
  const group = await getGroup(groupId);
  const result = await pool.query(
    `SELECT
       trade_copier_logs.*,
       trade_copier_followers.follower_name
     FROM trade_copier_logs
     LEFT JOIN trade_copier_followers
       ON trade_copier_followers.id =
         trade_copier_logs.follower_id
     WHERE trade_copier_logs.group_id = $1
     ORDER BY trade_copier_logs.copied_at DESC,
              trade_copier_logs.id DESC`,
    [group.id]
  );

  return result.rows.map(mapLog);
}

async function getExecutionSummary(groupId) {
  const group = await getGroup(groupId);
  const result = await pool.query(
    `SELECT
       COUNT(*) AS total_trades_copied,
       COUNT(*) FILTER (
         WHERE execution_status = 'SUCCESS'
       ) AS successful_copies,
       COUNT(*) FILTER (
         WHERE execution_status = 'FAILED'
       ) AS failed_copies,
       (
         SELECT COUNT(*)
         FROM trade_copier_followers
         WHERE group_id = $1
           AND status = 'ACTIVE'
       ) AS active_followers
     FROM trade_copier_logs
     WHERE group_id = $1`,
    [group.id]
  );
  const row = result.rows[0];

  return {
    groupId: group.id,
    group: group.group_name,
    totalTradesCopied: Number(row.total_trades_copied),
    successfulCopies: Number(row.successful_copies),
    failedCopies: Number(row.failed_copies),
    activeFollowers: Number(row.active_followers),
  };
}

async function restoreRunningGroups() {
  try {
    const result = await pool.query(
      `SELECT id
       FROM trade_copier_groups
       WHERE status = 'RUNNING'`
    );
    for (const row of result.rows) {
      startRunner(row.id);
    }
  } catch (error) {
    console.error("Unable to restore running trade copiers", {
      message: error.message,
    });
  }
}

restoreRunningGroups();

module.exports = {
  TradeCopierError,
  calculateFollowerQuantity,
  createGroup,
  addFollower,
  startCopier,
  stopCopier,
  getGroupStatus,
  getTradeHistory,
  getExecutionSummary,
  syncGroup,
};
