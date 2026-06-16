const { getSymbolQuote, getHistoricalCloses } = require("./market.service");
const {
  calculateEMA,
  calculateRSI,
  determineSignal,
} = require("./signal.service");
const { getWatchlist } = require("./watchlist.service");
const { subscribeSymbols } = require("./angelWebSocket.service");

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

function hashSymbol(symbol) {
  return symbol.split("").reduce(
    (hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) >>> 0,
    0
  );
}

function seededWave(seed, index) {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildDemoMarketData(symbol) {
  const seed = hashSymbol(symbol);
  const basePrice = 120 + (seed % 5800);
  const direction = seed % 2 === 0 ? 1 : -1;
  const closes = [];
  let price = basePrice * (0.9 + seededWave(seed, 1) * 0.2);

  for (let index = 0; index < 100; index += 1) {
    const trendStep = direction * (0.08 + (seed % 11) / 100);
    const noise = (seededWave(seed, index + 2) - 0.5) * basePrice * 0.012;
    price = Math.max(10, price + trendStep + noise);
    closes.push(round(price));
  }

  const previousClose = closes[closes.length - 1];
  const changePercent = (seededWave(seed, 200) - 0.5) * 5;
  const ltp = round(previousClose * (1 + changePercent / 100));

  return {
    quote: {
      symbol,
      exchange: "NSE",
      ltp,
      volume: 100000 + (seed % 9000000),
      source: "PAPER_DEMO_SCANNER",
    },
    history: {
      symbol,
      exchange: "NSE",
      closes,
    },
    isDemo: true,
  };
}

function scaleDemoHistory(history, targetLtp, demoLtp) {
  if (!Number.isFinite(targetLtp) || !Number.isFinite(demoLtp) || demoLtp <= 0) {
    return history;
  }

  const ratio = targetLtp / demoLtp;
  return {
    ...history,
    closes: history.closes.map((close) => round(close * ratio)),
  };
}

async function getScannerMarketData(symbol) {
  const normalizedSymbol = symbol.toUpperCase();
  const demo = buildDemoMarketData(normalizedSymbol);
  const result = {
    quote: null,
    history: null,
    isDemo: false,
  };

  try {
    result.quote = await getSymbolQuote(normalizedSymbol);
  } catch (error) {
    console.error("Scanner quote fallback activated", {
      symbol: normalizedSymbol,
      message: error.message,
    });
    result.quote = demo.quote;
    result.isDemo = true;
  }

  try {
    result.history = await getHistoricalCloses(normalizedSymbol, 100);
  } catch (error) {
    console.error("Scanner history fallback activated", {
      symbol: normalizedSymbol,
      message: error.message,
    });
    result.history = scaleDemoHistory(
      demo.history,
      Number(result.quote?.ltp),
      Number(demo.quote.ltp)
    );
    result.isDemo = true;
  }

  if (!Number(result.quote.volume)) {
    result.quote = {
      ...result.quote,
      volume: demo.quote.volume,
    };
  }

  return result;
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

  const { quote, history, isDemo } = await getScannerMarketData(symbol);
  const previousClose = history.closes[history.closes.length - 1];
  const closesWithLtp = [...history.closes, quote.ltp];
  const ema20 = calculateEMA(closesWithLtp, 20);
  const ema50 = calculateEMA(closesWithLtp, 50);
  const rsi = calculateRSI(closesWithLtp, 14);
  const signal = determineSignal(ema20, ema50, rsi);
  const change = quote.ltp - previousClose;
  const changePercent =
    previousClose === 0 ? 0 : (change / previousClose) * 100;
  const data = {
    symbol: quote.symbol.replace(/-EQ$/, ""),
    ltp: round(quote.ltp),
    change: round(change),
    changePercent: round(changePercent),
    volume: Number(quote.volume || 0),
    trend: getTrend(ema20, ema50),
    signal,
    rsi: round(rsi),
    ema20: round(ema20),
    ema50: round(ema50),
    updatedAt: quote.receivedAt || new Date().toISOString(),
    buySignal: signal === "BUY",
    sellSignal: signal === "SELL",
    source: isDemo ? "PAPER_DEMO_SCANNER" : quote.source || "ANGEL_ONE",
    isDemo,
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
    subscribeSymbols(symbols).catch((error) => {
      console.error("Scanner live subscription skipped", {
        group,
        message: error.message,
      });
    });
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
