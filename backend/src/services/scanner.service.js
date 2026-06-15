const { getSymbolQuote, getHistoricalCloses } = require("./market.service");
const {
  calculateEMA,
  calculateRSI,
  determineSignal,
} = require("./signal.service");
const { getWatchlist } = require("./watchlist.service");

const CACHE_TTL_MS = 60 * 1000;
const SCAN_CONCURRENCY = 5;

const GROUPS = {
  nifty50: [
    "ADANIENT",
    "ADANIPORTS",
    "APOLLOHOSP",
    "ASIANPAINT",
    "AXISBANK",
    "BAJAJ-AUTO",
    "BAJFINANCE",
    "BAJAJFINSV",
    "BEL",
    "BHARTIARTL",
    "CIPLA",
    "COALINDIA",
    "DRREDDY",
    "EICHERMOT",
    "ETERNAL",
    "GRASIM",
    "HCLTECH",
    "HDFCBANK",
    "HDFCLIFE",
    "HEROMOTOCO",
    "HINDALCO",
    "HINDUNILVR",
    "ICICIBANK",
    "INDUSINDBK",
    "INFY",
    "ITC",
    "JIOFIN",
    "JSWSTEEL",
    "KOTAKBANK",
    "LT",
    "M&M",
    "MARUTI",
    "NESTLEIND",
    "NTPC",
    "ONGC",
    "POWERGRID",
    "RELIANCE",
    "SBILIFE",
    "SBIN",
    "SHRIRAMFIN",
    "SUNPHARMA",
    "TATACONSUM",
    "TATAMOTORS",
    "TATASTEEL",
    "TCS",
    "TECHM",
    "TITAN",
    "TRENT",
    "ULTRACEMCO",
    "WIPRO",
  ],
  banknifty: [
    "AUBANK",
    "AXISBANK",
    "BANKBARODA",
    "CANBK",
    "FEDERALBNK",
    "HDFCBANK",
    "ICICIBANK",
    "IDFCFIRSTB",
    "INDUSINDBK",
    "KOTAKBANK",
    "PNB",
    "SBIN",
  ],
  fno: [
    "ABB",
    "ACC",
    "AMBUJACEM",
    "ASHOKLEY",
    "AUROPHARMA",
    "BANDHANBNK",
    "BHEL",
    "BIOCON",
    "BPCL",
    "BRITANNIA",
    "DLF",
    "GAIL",
    "HAL",
    "HINDPETRO",
    "IDEA",
    "INDIGO",
    "IOC",
    "IRCTC",
    "LICHSGFIN",
    "LUPIN",
    "NATIONALUM",
    "NMDC",
    "PFC",
    "RECLTD",
    "SAIL",
    "TATAPOWER",
    "TORNTPHARM",
    "TVSMOTOR",
    "VEDL",
    "ZYDUSLIFE",
  ],
};

const GROUP_LABELS = {
  nifty50: "Nifty 50",
  banknifty: "Bank Nifty",
  fno: "F&O Stocks",
  custom: "Custom Watchlist",
};

const scanCache = new Map();

class ScannerError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ScannerError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function getTrend(ema20, ema50) {
  const differencePercent = Math.abs((ema20 - ema50) / ema50) * 100;

  if (differencePercent < 0.1) {
    return "SIDEWAYS";
  }

  return ema20 > ema50 ? "UPTREND" : "DOWNTREND";
}

async function scanSymbol(symbol) {
  const cacheKey = symbol.toUpperCase();
  const cached = scanCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const [quote, history] = await Promise.all([
    getSymbolQuote(symbol),
    getHistoricalCloses(symbol, 100),
  ]);
  const previousClose = history.closes[history.closes.length - 1];
  const ema20 = calculateEMA(history.closes, 20);
  const ema50 = calculateEMA(history.closes, 50);
  const rsi = calculateRSI(history.closes, 14);
  const signal = determineSignal(ema20, ema50, rsi);
  const changePercent =
    previousClose === 0 ? 0 : ((quote.ltp - previousClose) / previousClose) * 100;
  const data = {
    symbol: quote.symbol.replace(/-EQ$/, ""),
    ltp: round(quote.ltp),
    changePercent: round(changePercent),
    volume: null,
    trend: getTrend(ema20, ema50),
    buySignal: signal === "BUY",
    sellSignal: signal === "SELL",
  };

  scanCache.set(cacheKey, {
    createdAt: Date.now(),
    data,
  });

  return data;
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker()
    )
  );

  return results;
}

async function scanSymbols(symbols) {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];

  return mapWithConcurrency(
    uniqueSymbols,
    async (symbol) => {
      try {
        return await scanSymbol(symbol);
      } catch (error) {
        console.error("Scanner symbol failed", {
          symbol,
          message: error.message,
        });

        return {
          symbol,
          ltp: null,
          changePercent: null,
          volume: null,
          trend: "UNAVAILABLE",
          buySignal: false,
          sellSignal: false,
          error: error.message || "Market data unavailable",
        };
      }
    },
    SCAN_CONCURRENCY
  );
}

async function getGroupSymbols(group) {
  if (group === "custom") {
    const watchlist = await getWatchlist();
    return watchlist
      .filter((item) => item.exchange === "NSE")
      .map((item) => item.symbol);
  }

  if (!GROUPS[group]) {
    throw new ScannerError("Scanner group not found", 404);
  }

  return GROUPS[group];
}

async function scanGroup(group) {
  try {
    const symbols = await getGroupSymbols(group);
    const items = await scanSymbols(symbols);

    return {
      group: GROUP_LABELS[group],
      count: items.length,
      items,
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw new ScannerError("Unable to scan watchlist");
  }
}

async function getScannerSummary() {
  const groups = ["nifty50", "banknifty", "fno", "custom"];
  const results = await Promise.all(groups.map((group) => scanGroup(group)));
  const items = results.flatMap((result) => result.items);

  return {
    totalSymbols: items.length,
    availableSymbols: items.filter((item) => !item.error).length,
    unavailableSymbols: items.filter((item) => item.error).length,
    buySignals: items.filter((item) => item.buySignal).length,
    sellSignals: items.filter((item) => item.sellSignal).length,
    groups: results.map((result) => ({
      group: result.group,
      count: result.count,
      buySignals: result.items.filter((item) => item.buySignal).length,
      sellSignals: result.items.filter((item) => item.sellSignal).length,
      unavailableSymbols: result.items.filter((item) => item.error).length,
    })),
  };
}

module.exports = {
  ScannerError,
  scanGroup,
  getScannerSummary,
};
