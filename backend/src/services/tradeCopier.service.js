const pool = require("../config/db");
const { createPaperTrade } = require("./paperTrade.service");

const COPY_INTERVAL_MS = 30 * 1000;
const groupRunners = new Map();
let accountSchemaReady = null;

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

    const {
      assertTradingAllowed,
    } = require("./killSwitch.service");
    await assertTradingAllowed();
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

async function ensureAccountSchema() {
  if (!accountSchemaReady) {
    accountSchemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS trade_copier_master_accounts (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          account_name VARCHAR(100) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS trade_copier_follower_accounts (
          id SERIAL PRIMARY KEY,
          follower_name VARCHAR(100) NOT NULL UNIQUE,
          quantity_mode VARCHAR(20) NOT NULL,
          fixed_quantity INTEGER,
          quantity_percentage DECIMAL,
          capital_scale DECIMAL NOT NULL DEFAULT 1,
          max_retries INTEGER NOT NULL DEFAULT 2,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS trade_copier_execution_logs (
          id SERIAL PRIMARY KEY,
          master_account_id INTEGER,
          follower_id INTEGER NOT NULL,
          master_trade_reference VARCHAR(120) NOT NULL,
          symbol VARCHAR(50) NOT NULL,
          side VARCHAR(10) NOT NULL,
          master_quantity INTEGER NOT NULL,
          copied_quantity INTEGER NOT NULL,
          price DECIMAL NOT NULL,
          execution_status VARCHAR(30) NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 1,
          error_message TEXT,
          copied_trade_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (follower_id, master_trade_reference)
        )
      `);
    })().catch((error) => {
      accountSchemaReady = null;
      throw error;
    });
  }
  return accountSchemaReady;
}

function mapMasterAccount(row) {
  return row
    ? {
        id: row.id,
        accountName: row.account_name,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
}

function mapFollowerAccount(row) {
  return {
    id: row.id,
    followerName: row.follower_name,
    quantityMode: row.quantity_mode,
    fixedQuantity:
      row.fixed_quantity === null ? null : row.fixed_quantity,
    quantityPercentage:
      row.quantity_percentage === null
        ? null
        : Number(row.quantity_percentage),
    capitalScale: Number(row.capital_scale),
    maxRetries: row.max_retries,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExecutionLog(row) {
  return {
    id: row.id,
    masterAccountId: row.master_account_id,
    followerId: row.follower_id,
    followerName: row.follower_name || null,
    masterTradeReference: row.master_trade_reference,
    symbol: row.symbol,
    side: row.side,
    masterQuantity: row.master_quantity,
    copiedQuantity: row.copied_quantity,
    price: Number(row.price),
    executionStatus: row.execution_status,
    attempts: row.attempts,
    errorMessage: row.error_message,
    copiedTradeId: row.copied_trade_id,
    createdAt: row.created_at,
  };
}

async function configureMasterAccount(input = {}) {
  await ensureAccountSchema();
  const accountName = normalizeName(
    input.accountName || input.masterName,
    "accountName"
  );
  const status =
    typeof input.status === "string"
      ? input.status.trim().toUpperCase()
      : "ACTIVE";

  if (!["ACTIVE", "PAUSED"].includes(status)) {
    throw new TradeCopierError(
      "status must be ACTIVE or PAUSED",
      400
    );
  }

  const result = await pool.query(
    `INSERT INTO trade_copier_master_accounts (
       id, account_name, status
     )
     VALUES (1, $1, $2)
     ON CONFLICT (id)
     DO UPDATE SET
       account_name = EXCLUDED.account_name,
       status = EXCLUDED.status,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [accountName, status]
  );
  return mapMasterAccount(result.rows[0]);
}

function normalizeFollowerAccount(input = {}) {
  const followerName = normalizeName(
    input.followerName,
    "followerName"
  );
  const quantityMode =
    typeof input.quantityMode === "string"
      ? input.quantityMode.trim().toUpperCase()
      : "";
  const capitalScale =
    input.capitalScale === undefined
      ? 1
      : Number(input.capitalScale);
  const maxRetries =
    input.maxRetries === undefined ? 2 : Number(input.maxRetries);

  if (!["FIXED", "PERCENTAGE"].includes(quantityMode)) {
    throw new TradeCopierError(
      "quantityMode must be FIXED or PERCENTAGE",
      400
    );
  }
  if (
    !Number.isFinite(capitalScale) ||
    capitalScale <= 0 ||
    capitalScale > 100
  ) {
    throw new TradeCopierError(
      "capitalScale must be between 0 and 100",
      400
    );
  }
  if (
    !Number.isInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > 5
  ) {
    throw new TradeCopierError(
      "maxRetries must be an integer between 0 and 5",
      400
    );
  }

  const fixedQuantity =
    quantityMode === "FIXED" ? Number(input.fixedQuantity) : null;
  const quantityPercentage =
    quantityMode === "PERCENTAGE"
      ? Number(input.quantityPercentage)
      : null;

  if (
    quantityMode === "FIXED" &&
    (!Number.isInteger(fixedQuantity) || fixedQuantity <= 0)
  ) {
    throw new TradeCopierError(
      "fixedQuantity must be a positive integer",
      400
    );
  }
  if (
    quantityMode === "PERCENTAGE" &&
    (!Number.isFinite(quantityPercentage) ||
      quantityPercentage <= 0 ||
      quantityPercentage > 1000)
  ) {
    throw new TradeCopierError(
      "quantityPercentage must be between 0 and 1000",
      400
    );
  }

  return {
    followerName,
    quantityMode,
    fixedQuantity,
    quantityPercentage,
    capitalScale,
    maxRetries,
  };
}

async function addAccountFollower(input = {}) {
  await ensureAccountSchema();
  const follower = normalizeFollowerAccount(input);

  try {
    const result = await pool.query(
      `INSERT INTO trade_copier_follower_accounts (
         follower_name,
         quantity_mode,
         fixed_quantity,
         quantity_percentage,
         capital_scale,
         max_retries,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
       RETURNING *`,
      [
        follower.followerName,
        follower.quantityMode,
        follower.fixedQuantity,
        follower.quantityPercentage,
        follower.capitalScale,
        follower.maxRetries,
      ]
    );
    return mapFollowerAccount(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new TradeCopierError(
        "Follower account name already exists",
        409
      );
    }
    throw error;
  }
}

function normalizeCopyTrade(input = {}) {
  const symbol =
    typeof input.symbol === "string"
      ? input.symbol.trim().toUpperCase()
      : "";
  const side =
    typeof input.side === "string"
      ? input.side.trim().toUpperCase()
      : "";
  const exchange =
    typeof input.exchange === "string"
      ? input.exchange.trim().toUpperCase()
      : "NSE";
  const quantity = Number(input.quantity);
  const price = Number(input.price);
  const masterTradeReference =
    typeof input.masterTradeReference === "string"
      ? input.masterTradeReference.trim()
      : "";

  if (!symbol || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new TradeCopierError("symbol is invalid", 400);
  }
  if (!["BUY", "SELL"].includes(side)) {
    throw new TradeCopierError("side must be BUY or SELL", 400);
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new TradeCopierError(
      "quantity must be a positive integer",
      400
    );
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new TradeCopierError(
      "price must be a positive number",
      400
    );
  }
  if (
    !masterTradeReference ||
    masterTradeReference.length > 120 ||
    !/^[A-Za-z0-9_.:-]+$/.test(masterTradeReference)
  ) {
    throw new TradeCopierError(
      "masterTradeReference is required and contains unsupported characters",
      400
    );
  }

  return {
    symbol,
    side,
    exchange,
    quantity,
    price,
    masterTradeReference,
  };
}

function calculateAccountQuantity(masterQuantity, follower) {
  const baseQuantity =
    follower.quantity_mode === "FIXED"
      ? Number(follower.fixed_quantity)
      : Math.floor(
          Number(masterQuantity) *
            (Number(follower.quantity_percentage) / 100)
        );
  const scaledQuantity = Math.floor(
    baseQuantity * Number(follower.capital_scale)
  );

  if (scaledQuantity < 1) {
    throw new TradeCopierError(
      "Calculated follower quantity is below one unit",
      400
    );
  }
  return scaledQuantity;
}

async function insertExecutionLog({
  master,
  follower,
  trade,
  quantity,
  status,
  attempts,
  error,
  copiedTradeId,
}) {
  const result = await pool.query(
    `INSERT INTO trade_copier_execution_logs (
       master_account_id,
       follower_id,
       master_trade_reference,
       symbol,
       side,
       master_quantity,
       copied_quantity,
       price,
       execution_status,
       attempts,
       error_message,
       copied_trade_id
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12
     )
     ON CONFLICT (follower_id, master_trade_reference)
     DO NOTHING
     RETURNING *`,
    [
      master.id,
      follower.id,
      trade.masterTradeReference,
      trade.symbol,
      trade.side,
      trade.quantity,
      quantity,
      trade.price,
      status,
      attempts,
      error || null,
      copiedTradeId || null,
    ]
  );
  return result.rows[0] || null;
}

async function executeFollowerCopy(master, follower, trade) {
  const existing = await pool.query(
    `SELECT *
     FROM trade_copier_execution_logs
     WHERE follower_id = $1
       AND master_trade_reference = $2`,
    [follower.id, trade.masterTradeReference]
  );
  if (existing.rows.length > 0) {
    return {
      ...mapExecutionLog(existing.rows[0]),
      executionStatus: "DUPLICATE_SKIPPED",
    };
  }

  let quantity = 0;
  try {
    quantity = calculateAccountQuantity(
      trade.quantity,
      follower
    );
  } catch (error) {
    const log = await insertExecutionLog({
      master,
      follower,
      trade,
      quantity,
      status: "FAILED",
      attempts: 1,
      error: error.message,
    });
    return mapExecutionLog(log);
  }

  let attempts = 0;
  let lastError = null;
  const maximumAttempts = follower.max_retries + 1;

  while (attempts < maximumAttempts) {
    attempts += 1;
    try {
      const copiedTrade = await createPaperTrade(trade.side, {
        symbol: trade.symbol,
        exchange: trade.exchange,
        quantity,
        price: trade.price,
      });
      const log = await insertExecutionLog({
        master,
        follower,
        trade,
        quantity,
        status: "SUCCESS",
        attempts,
        copiedTradeId: copiedTrade.id,
      });
      return mapExecutionLog(log);
    } catch (error) {
      lastError = error;
      if ([400, 409, 423].includes(error.statusCode)) {
        break;
      }
    }
  }

  const log = await insertExecutionLog({
    master,
    follower,
    trade,
    quantity,
    status: "FAILED",
    attempts,
    error: lastError?.message || "Follower paper copy failed",
  });
  return mapExecutionLog(log);
}

async function copyAccountTrade(input = {}) {
  await ensureAccountSchema();
  const trade = normalizeCopyTrade(input);
  const [masterResult, followersResult] = await Promise.all([
    pool.query(
      `SELECT *
       FROM trade_copier_master_accounts
       WHERE id = 1`
    ),
    pool.query(
      `SELECT *
       FROM trade_copier_follower_accounts
       WHERE status = 'ACTIVE'
       ORDER BY id`
    ),
  ]);

  if (masterResult.rows.length === 0) {
    throw new TradeCopierError(
      "Configure a master account before copying trades",
      400
    );
  }
  const master = masterResult.rows[0];
  if (master.status !== "ACTIVE") {
    throw new TradeCopierError(
      "Master account is not active",
      409
    );
  }
  if (followersResult.rows.length === 0) {
    throw new TradeCopierError(
      "At least one active follower account is required",
      400
    );
  }

  const executions = [];
  for (const follower of followersResult.rows) {
    try {
      executions.push(
        await executeFollowerCopy(master, follower, trade)
      );
    } catch (error) {
      executions.push({
        followerId: follower.id,
        followerName: follower.follower_name,
        executionStatus: "FAILED",
        errorMessage: error.message,
      });
    }
  }

  return {
    mode: "PAPER_ONLY",
    masterAccount: mapMasterAccount(master),
    masterTrade: trade,
    totalFollowers: executions.length,
    successfulCopies: executions.filter(
      (item) => item.executionStatus === "SUCCESS"
    ).length,
    failedCopies: executions.filter(
      (item) => item.executionStatus === "FAILED"
    ).length,
    duplicateCopies: executions.filter(
      (item) => item.executionStatus === "DUPLICATE_SKIPPED"
    ).length,
    executions,
  };
}

async function getAccountCopierStatus() {
  await ensureAccountSchema();
  const [master, followers, summary] = await Promise.all([
    pool.query(
      `SELECT * FROM trade_copier_master_accounts WHERE id = 1`
    ),
    pool.query(
      `SELECT *
       FROM trade_copier_follower_accounts
       ORDER BY created_at, id`
    ),
    pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (
           WHERE execution_status = 'SUCCESS'
         ) AS successful,
         COUNT(*) FILTER (
           WHERE execution_status = 'FAILED'
         ) AS failed
       FROM trade_copier_execution_logs`
    ),
  ]);
  const row = summary.rows[0];

  return {
    mode: "PAPER_ONLY",
    status:
      master.rows[0]?.status === "ACTIVE" &&
      followers.rows.some((item) => item.status === "ACTIVE")
        ? "READY"
        : "SETUP_REQUIRED",
    masterAccount: mapMasterAccount(master.rows[0]),
    followers: followers.rows.map(mapFollowerAccount),
    activeFollowers: followers.rows.filter(
      (item) => item.status === "ACTIVE"
    ).length,
    executionSummary: {
      total: Number(row.total),
      successful: Number(row.successful),
      failed: Number(row.failed),
    },
  };
}

async function getAccountCopyLogs() {
  await ensureAccountSchema();
  const result = await pool.query(
    `SELECT
       trade_copier_execution_logs.*,
       trade_copier_follower_accounts.follower_name
     FROM trade_copier_execution_logs
     LEFT JOIN trade_copier_follower_accounts
       ON trade_copier_follower_accounts.id =
          trade_copier_execution_logs.follower_id
     ORDER BY trade_copier_execution_logs.created_at DESC,
              trade_copier_execution_logs.id DESC
     LIMIT 500`
  );
  return result.rows.map(mapExecutionLog);
}

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
  configureMasterAccount,
  addAccountFollower,
  copyAccountTrade,
  getAccountCopierStatus,
  getAccountCopyLogs,
  calculateAccountQuantity,
};
