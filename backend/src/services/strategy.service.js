const { getSignal } = require("./signal.service");
const { createPaperTrade } = require("./paperTrade.service");
const { hasOpenPositionForSymbol } = require("./position.service");

const EXECUTION_INTERVAL_MS = 60 * 1000;
const SUPPORTED_STRATEGIES = new Set(["EMA_RSI"]);
const activeStrategies = new Map();

class StrategyError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "StrategyError";
    this.statusCode = statusCode;
  }
}

function normalizeSymbol(symbol) {
  const normalized =
    typeof symbol === "string" ? symbol.trim().toUpperCase() : "";

  if (
    !normalized ||
    normalized.length > 50 ||
    !/^[A-Z0-9&.-]+$/.test(normalized)
  ) {
    throw new StrategyError("Symbol is invalid", 400);
  }

  return normalized;
}

function normalizeStrategy(strategy) {
  const normalized =
    typeof strategy === "string" ? strategy.trim().toUpperCase() : "";

  if (!SUPPORTED_STRATEGIES.has(normalized)) {
    throw new StrategyError(
      `Strategy must be one of: ${Array.from(SUPPORTED_STRATEGIES).join(", ")}`,
      400
    );
  }

  return normalized;
}

function serializeRunner(runner) {
  return {
    symbol: runner.symbol,
    strategy: runner.strategy,
    status: "ACTIVE",
    intervalSeconds: EXECUTION_INTERVAL_MS / 1000,
    lastSignal: runner.lastSignal,
    lastAction: runner.lastAction,
    lastError: runner.lastError,
    lastRunAt: runner.lastRunAt,
    startedAt: runner.startedAt,
  };
}

async function executeCycle(runner) {
  if (runner.isRunning || !activeStrategies.has(runner.symbol)) {
    return;
  }

  runner.isRunning = true;
  runner.lastRunAt = new Date().toISOString();

  try {
    const signalResult = await getSignal(runner.symbol);
    runner.lastSignal = signalResult.signal;
    runner.lastError = null;

    if (signalResult.signal === "HOLD") {
      runner.lastAction = "NO_ACTION";
      return;
    }

    const hasOpenPosition = await hasOpenPositionForSymbol(runner.symbol);
    if (hasOpenPosition) {
      runner.lastAction = "SKIPPED_OPEN_POSITION";
      return;
    }

    const trade = await createPaperTrade(signalResult.signal, {
      symbol: runner.symbol,
      exchange: "NSE",
      quantity: 1,
    });

    runner.lastAction = `PAPER_${trade.tradeType}_CREATED`;
  } catch (error) {
    runner.lastAction = "CYCLE_FAILED";
    runner.lastError = error.message || "Strategy cycle failed";
    console.error("Paper strategy cycle failed", {
      symbol: runner.symbol,
      strategy: runner.strategy,
      message: runner.lastError,
    });
  } finally {
    runner.isRunning = false;
  }
}

async function startStrategy(input) {
  const {
    assertTradingAllowed,
  } = require("./killSwitch.service");
  await assertTradingAllowed();
  const symbol = normalizeSymbol(input.symbol);
  const strategy = normalizeStrategy(input.strategy);

  if (activeStrategies.has(symbol)) {
    throw new StrategyError(
      `A strategy is already active for ${symbol}`,
      409
    );
  }

  const runner = {
    symbol,
    strategy,
    startedAt: new Date().toISOString(),
    lastRunAt: null,
    lastSignal: null,
    lastAction: "STARTED",
    lastError: null,
    isRunning: false,
    timer: null,
  };

  activeStrategies.set(symbol, runner);
  await executeCycle(runner);

  runner.timer = setInterval(() => {
    executeCycle(runner);
  }, EXECUTION_INTERVAL_MS);
  runner.timer.unref();

  return serializeRunner(runner);
}

function stopStrategy(input) {
  const symbol = normalizeSymbol(input.symbol);
  const runner = activeStrategies.get(symbol);

  if (!runner) {
    throw new StrategyError(`No active strategy found for ${symbol}`, 404);
  }

  clearInterval(runner.timer);
  activeStrategies.delete(symbol);

  return {
    symbol,
    strategy: runner.strategy,
    status: "STOPPED",
  };
}

function getActiveStrategies() {
  return Array.from(activeStrategies.values()).map(serializeRunner);
}

function stopAllStrategies() {
  const stopped = [];

  for (const runner of activeStrategies.values()) {
    clearInterval(runner.timer);
    stopped.push({
      symbol: runner.symbol,
      strategy: runner.strategy,
      status: "STOPPED",
    });
  }

  activeStrategies.clear();
  return stopped;
}

module.exports = {
  StrategyError,
  startStrategy,
  stopStrategy,
  stopAllStrategies,
  getActiveStrategies,
};
