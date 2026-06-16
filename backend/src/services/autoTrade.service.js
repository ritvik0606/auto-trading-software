const { getSignal } = require("./signal.service");
const { createPaperTrade, getPaperTrades } = require("./paperTrade.service");
const { hasOpenPositionForSymbol } = require("./position.service");
const {
  getLiveQuote,
  getMarketStreamStatus,
  subscribeSymbols,
} = require("./angelWebSocket.service");

const SUPPORTED_STRATEGIES = new Set(["EMA_RSI"]);
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 60;
const MAX_SIGNAL_HISTORY = 100;
const runners = new Map();
const signalHistory = [];

class AutoTradeError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AutoTradeError";
    this.statusCode = statusCode;
  }
}

function normalizeSymbol(value) {
  const symbol =
    typeof value === "string" ? value.trim().toUpperCase() : "";

  if (!symbol || symbol.length > 50 || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new AutoTradeError("Symbol is invalid", 400);
  }

  return symbol.replace(/-EQ$/, "");
}

function normalizeStrategy(value) {
  const strategy =
    typeof value === "string" ? value.trim().toUpperCase() : "";

  if (!SUPPORTED_STRATEGIES.has(strategy)) {
    throw new AutoTradeError(
      `strategyName must be one of: ${Array.from(
        SUPPORTED_STRATEGIES
      ).join(", ")}`,
      400
    );
  }

  return strategy;
}

function normalizeStartInput(input = {}) {
  const strategyName = normalizeStrategy(
    input.strategyName ?? input.strategy
  );
  const symbol = normalizeSymbol(input.symbol);
  const intervalSeconds =
    input.intervalSeconds === undefined
      ? 30
      : Number(input.intervalSeconds);
  const quantity =
    input.quantity === undefined ? 1 : Number(input.quantity);

  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < MIN_INTERVAL_SECONDS ||
    intervalSeconds > MAX_INTERVAL_SECONDS
  ) {
    throw new AutoTradeError(
      `intervalSeconds must be an integer between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`,
      400
    );
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new AutoTradeError("quantity must be a positive integer", 400);
  }

  return { strategyName, symbol, intervalSeconds, quantity };
}

function runnerKey(strategyName, symbol) {
  return `${strategyName}:${symbol}`;
}

function serializeRunner(runner) {
  return {
    id: runner.id,
    strategyName: runner.strategyName,
    symbol: runner.symbol,
    quantity: runner.quantity,
    intervalSeconds: runner.intervalSeconds,
    status: runner.status,
    lastSignal: runner.lastSignal,
    lastPrice: runner.lastPrice,
    lastAction: runner.lastAction,
    lastError: runner.lastError,
    lastRunAt: runner.lastRunAt,
    lastExecutionAt: runner.lastExecutionAt,
    startedAt: runner.startedAt,
    mode: "PAPER_ONLY",
  };
}

function recordSignal(runner, signal, quote) {
  const entry = {
    id: `${runner.id}-${Date.now()}`,
    runnerId: runner.id,
    strategyName: runner.strategyName,
    symbol: runner.symbol,
    signal: signal.signal,
    ema20: signal.ema20,
    ema50: signal.ema50,
    rsi: signal.rsi,
    ltp: quote?.ltp ?? null,
    marketSource: quote?.source ?? null,
    createdAt: new Date().toISOString(),
  };

  signalHistory.unshift(entry);
  signalHistory.splice(MAX_SIGNAL_HISTORY);
  return entry;
}

async function executeCycle(runner) {
  const key = runnerKey(runner.strategyName, runner.symbol);
  if (runner.isExecuting || runners.get(key) !== runner) {
    return;
  }

  runner.isExecuting = true;
  runner.lastRunAt = new Date().toISOString();

  try {
    const { evaluateRisk } = require("./riskEngine.service");
    const riskStatus = await evaluateRisk();
    if (!riskStatus.tradingAllowed) {
      runner.lastAction = "STOPPED_BY_RISK_ENGINE";
      runner.lastError =
        riskStatus.reasons[0] || "Risk engine locked auto trading";
      return;
    }
    const signal = await getSignal(runner.symbol);
    const quote = getLiveQuote(runner.symbol);

    runner.lastSignal = signal.signal;
    runner.lastPrice = quote?.ltp ?? null;
    recordSignal(runner, signal, quote);

    if (!quote || quote.source !== "ANGEL_ONE_WEBSOCKET") {
      runner.lastAction = "WAITING_FOR_LIVE_PRICE";
      runner.lastError = "Live Angel One market tick unavailable";
      return;
    }

    runner.lastError = null;
    if (signal.signal === "HOLD") {
      runner.lastAction = "HOLD_NO_ACTION";
      return;
    }

    if (await hasOpenPositionForSymbol(runner.symbol)) {
      runner.lastAction = "SKIPPED_OPEN_POSITION";
      return;
    }

    const trade = await createPaperTrade(signal.signal, {
      symbol: runner.symbol,
      exchange: "NSE",
      quantity: runner.quantity,
      price: quote.ltp,
    });

    runner.lastAction = `PAPER_${trade.tradeType}_CREATED`;
    runner.lastExecutionAt = new Date().toISOString();
  } catch (error) {
    runner.lastAction = "CYCLE_FAILED";
    runner.lastError = error.message || "Auto-trade cycle failed";
    console.error("Auto-trade paper cycle failed", {
      runnerId: runner.id,
      strategyName: runner.strategyName,
      symbol: runner.symbol,
      message: runner.lastError,
    });
  } finally {
    runner.isExecuting = false;
  }
}

async function startAutoTrade(input) {
  const config = normalizeStartInput(input);
  const { evaluateRisk } = require("./riskEngine.service");
  const riskStatus = await evaluateRisk();
  if (!riskStatus.tradingAllowed) {
    throw new AutoTradeError(
      riskStatus.reasons[0] || "Risk engine is locked",
      423
    );
  }
  const key = runnerKey(config.strategyName, config.symbol);

  if (runners.has(key)) {
    throw new AutoTradeError(
      `Auto trading is already running for ${config.strategyName} on ${config.symbol}`,
      409
    );
  }

  const runner = {
    id: key,
    ...config,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    lastRunAt: null,
    lastExecutionAt: null,
    lastSignal: null,
    lastPrice: null,
    lastAction: "SCHEDULED",
    lastError: null,
    isExecuting: false,
    timer: null,
  };

  runners.set(key, runner);
  subscribeSymbols([runner.symbol]).catch((error) => {
    runner.lastError = error.message || "Market subscription failed";
  });

  setImmediate(() => executeCycle(runner));
  runner.timer = setInterval(
    () => executeCycle(runner),
    runner.intervalSeconds * 1000
  );
  runner.timer.unref();

  const response = serializeRunner(runner);
  const { safeRecordAudit } = require("./auditTrail.service");
  await safeRecordAudit({
    category: "STRATEGY",
    action: "AUTO_TRADE_STARTED",
    severity: "INFO",
    entityType: "AUTO_TRADE_RUNNER",
    entityId: runner.id,
    message: `Auto-trade runner started for ${runner.symbol}`,
    metadata: response,
  });
  return response;
}

function stopAutoTrade(input = {}) {
  const hasTarget = input.symbol || input.strategyName || input.strategy;

  if (!hasTarget) {
    const stopped = Array.from(runners.values()).map((runner) => {
      clearInterval(runner.timer);
      return { ...serializeRunner(runner), status: "STOPPED" };
    });
    runners.clear();
    const { safeRecordAudit } = require("./auditTrail.service");
    safeRecordAudit({
      category: "STRATEGY",
      action: "ALL_AUTO_TRADES_STOPPED",
      severity: "WARNING",
      message: "All auto-trade runners stopped",
      metadata: { stoppedCount: stopped.length },
    });
    return stopped;
  }

  const symbol = normalizeSymbol(input.symbol);
  const strategyName = normalizeStrategy(
    input.strategyName ?? input.strategy
  );
  const key = runnerKey(strategyName, symbol);
  const runner = runners.get(key);

  if (!runner) {
    throw new AutoTradeError(
      `No auto-trade runner found for ${strategyName} on ${symbol}`,
      404
    );
  }

  clearInterval(runner.timer);
  runners.delete(key);
  const stopped = [{ ...serializeRunner(runner), status: "STOPPED" }];
  const { safeRecordAudit } = require("./auditTrail.service");
  safeRecordAudit({
    category: "STRATEGY",
    action: "AUTO_TRADE_STOPPED",
    severity: "INFO",
    entityType: "AUTO_TRADE_RUNNER",
    entityId: runner.id,
    message: `Auto-trade runner stopped for ${runner.symbol}`,
    metadata: stopped[0],
  });
  return stopped;
}

function getRunners() {
  return Array.from(runners.values()).map(serializeRunner);
}

function getSignals() {
  return signalHistory.slice();
}

async function getAutoTradeStatus() {
  const activeRunners = getRunners();
  const openPaperTrades = await getPaperTrades("OPEN");

  return {
    engineStatus: activeRunners.length > 0 ? "RUNNING" : "STOPPED",
    mode: "PAPER_ONLY",
    schedulerInterval: "30-60 seconds",
    realOrderExecution: "DISABLED",
    enableRealOrders:
      process.env.ENABLE_REAL_ORDERS?.trim().toLowerCase() === "true",
    marketStream: getMarketStreamStatus(),
    activeRunnerCount: activeRunners.length,
    activeRunners,
    openPaperTrades,
    lastSignal: signalHistory[0] || null,
  };
}

module.exports = {
  AutoTradeError,
  executeCycle,
  startAutoTrade,
  stopAutoTrade,
  getAutoTradeStatus,
  getRunners,
  getSignals,
};
