const axios = require("axios");
const { loginAngel } = require("./angel.service");

const ANGEL_BASE_URL = "https://apiconnect.angelone.in";
const ANGEL_LTP_URL =
  `${ANGEL_BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData`;
const ANGEL_SEARCH_URL =
  `${ANGEL_BASE_URL}/rest/secure/angelbroking/order/v1/searchScrip`;
const ANGEL_CANDLE_URL =
  `${ANGEL_BASE_URL}/rest/secure/angelbroking/historical/v1/getCandleData`;
const SESSION_TTL_MS = 10 * 60 * 1000;

let cachedSession;
let sessionExpiresAt = 0;
let sessionPromise;

const INDEX_SYMBOLS = {
  NIFTY: {
    exchange: "NSE",
    tradingSymbol: "NIFTY",
    symbolToken: "99926000",
  },
  BANKNIFTY: {
    exchange: "NSE",
    tradingSymbol: "BANKNIFTY",
    symbolToken: "99926009",
  },
};

class MarketDataError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "MarketDataError";
    this.statusCode = statusCode;
  }
}

async function getAngelSession() {
  if (cachedSession && Date.now() < sessionExpiresAt) {
    return cachedSession;
  }

  if (!sessionPromise) {
    sessionPromise = loginAngel()
      .then((login) => {
        cachedSession = login.data;
        sessionExpiresAt = Date.now() + SESSION_TTL_MS;
        return cachedSession;
      })
      .finally(() => {
        sessionPromise = undefined;
      });
  }

  return sessionPromise;
}

function clearAngelSession(error) {
  if ([401, 403].includes(error.response?.status)) {
    cachedSession = undefined;
    sessionExpiresAt = 0;
  }
}

async function getAngelHeaders() {
  const session = await getAngelSession();
  const jwtToken = session?.jwtToken;

  if (!jwtToken) {
    throw new MarketDataError(
      "Angel One login did not return a session token",
      502
    );
  }

  return {
    Authorization: `Bearer ${jwtToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": process.env.ANGEL_API_KEY,
  };
}

function getAngelErrorMessage(error) {
  return (
    error.response?.data?.message ||
    error.message ||
    "Unable to fetch market data from Angel One"
  );
}

function logMarketDataError(operation, error) {
  console.error(`Angel One market data ${operation} failed`, {
    status: error.response?.status,
    errorCode: error.response?.data?.errorcode,
    message: getAngelErrorMessage(error),
  });
}

function normalizeQuote(data, fallback) {
  if (typeof data?.ltp !== "number") {
    throw new MarketDataError("Angel One did not return a valid LTP");
  }

  return {
    symbol: data.tradingsymbol || fallback.tradingSymbol,
    exchange: data.exchange || fallback.exchange,
    symbolToken: data.symboltoken || fallback.symbolToken,
    ltp: data.ltp,
  };
}

async function getLTP(exchange, tradingSymbol, symbolToken, headers) {
  try {
    const angelHeaders = headers || (await getAngelHeaders());
    const response = await axios.post(
      ANGEL_LTP_URL,
      {
        exchange,
        tradingsymbol: tradingSymbol,
        symboltoken: symbolToken,
      },
      { headers: angelHeaders }
    );

    if (response.data?.status !== true) {
      throw new MarketDataError(
        response.data?.message || "Angel One rejected the LTP request"
      );
    }

    return normalizeQuote(response.data?.data, {
      exchange,
      tradingSymbol,
      symbolToken,
    });
  } catch (error) {
    clearAngelSession(error);
    logMarketDataError("quote", error);

    if (error instanceof MarketDataError) {
      throw error;
    }

    throw new MarketDataError(getAngelErrorMessage(error));
  }
}

async function searchNseSymbol(symbol, headers) {
  try {
    const response = await axios.post(
      ANGEL_SEARCH_URL,
      {
        exchange: "NSE",
        searchscrip: symbol,
      },
      { headers }
    );

    if (response.data?.status !== true) {
      throw new MarketDataError(
        response.data?.message || `Symbol "${symbol}" was not found`,
        404
      );
    }

    const matches = Array.isArray(response.data?.data)
      ? response.data.data
      : [];
    const requestedSymbol = symbol.toUpperCase();
    const requestedBase = requestedSymbol.replace(/-EQ$/, "");
    const exactMatch = matches.find((item) => {
      const tradingSymbol = item.tradingsymbol?.toUpperCase();
      return (
        item.exchange === "NSE" &&
        (tradingSymbol === requestedSymbol ||
          tradingSymbol === `${requestedBase}-EQ`)
      );
    });

    if (!exactMatch) {
      throw new MarketDataError(`NSE symbol "${symbol}" was not found`, 404);
    }

    return {
      exchange: exactMatch.exchange,
      tradingSymbol: exactMatch.tradingsymbol,
      symbolToken: exactMatch.symboltoken,
    };
  } catch (error) {
    clearAngelSession(error);
    logMarketDataError("symbol search", error);

    if (error instanceof MarketDataError) {
      throw error;
    }

    throw new MarketDataError(getAngelErrorMessage(error));
  }
}

async function getNiftyLTP() {
  const index = INDEX_SYMBOLS.NIFTY;
  return getLTP(index.exchange, index.tradingSymbol, index.symbolToken);
}

async function getBankNiftyLTP() {
  const index = INDEX_SYMBOLS.BANKNIFTY;
  return getLTP(index.exchange, index.tradingSymbol, index.symbolToken);
}

async function getSymbolQuote(symbol) {
  const normalizedSymbol = symbol?.trim().toUpperCase();

  if (!normalizedSymbol) {
    throw new MarketDataError("Symbol is required", 400);
  }

  if (!/^[A-Z0-9&.-]+$/.test(normalizedSymbol)) {
    throw new MarketDataError("Symbol contains unsupported characters", 400);
  }

  const index = INDEX_SYMBOLS[normalizedSymbol];
  if (index) {
    return getLTP(index.exchange, index.tradingSymbol, index.symbolToken);
  }

  const headers = await getAngelHeaders();
  const instrument = await searchNseSymbol(normalizedSymbol, headers);

  return getLTP(
    instrument.exchange,
    instrument.tradingSymbol,
    instrument.symbolToken,
    headers
  );
}

function formatAngelDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [
      part.type,
      part.value,
    ])
  );

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

async function getHistoricalCloses(symbol, requestedDays = 100) {
  const normalizedSymbol = symbol?.trim().toUpperCase();
  const days = Number(requestedDays);

  if (!normalizedSymbol || !/^[A-Z0-9&.-]+$/.test(normalizedSymbol)) {
    throw new MarketDataError("Symbol is invalid", 400);
  }

  if (!Number.isInteger(days) || days < 51 || days > 1000) {
    throw new MarketDataError(
      "Historical days must be an integer between 51 and 1000",
      400
    );
  }

  const headers = await getAngelHeaders();
  const instrument =
    INDEX_SYMBOLS[normalizedSymbol] ||
    (await searchNseSymbol(normalizedSymbol, headers));
  const toDate = new Date();
  const fromDate = new Date(toDate);
  const calendarDays = Math.ceil(days * 1.7) + 30;
  fromDate.setDate(fromDate.getDate() - calendarDays);

  try {
    const response = await axios.post(
      ANGEL_CANDLE_URL,
      {
        exchange: instrument.exchange,
        symboltoken: instrument.symbolToken,
        interval: "ONE_DAY",
        fromdate: formatAngelDate(fromDate),
        todate: formatAngelDate(toDate),
      },
      { headers }
    );

    if (response.data?.status !== true) {
      throw new MarketDataError(
        response.data?.message || "Angel One rejected the candle data request"
      );
    }

    const closes = (response.data?.data || [])
      .map((candle) => Number(candle[4]))
      .filter(Number.isFinite)
      .slice(-days);

    if (closes.length < 51) {
      throw new MarketDataError(
        `Not enough historical data for ${normalizedSymbol}`
      );
    }

    return {
      symbol: instrument.tradingSymbol,
      exchange: instrument.exchange,
      symbolToken: instrument.symbolToken,
      closes,
    };
  } catch (error) {
    clearAngelSession(error);
    logMarketDataError("historical candles", error);

    if (error instanceof MarketDataError) {
      throw error;
    }

    throw new MarketDataError(getAngelErrorMessage(error));
  }
}

module.exports = {
  getLTP,
  getNiftyLTP,
  getBankNiftyLTP,
  getSymbolQuote,
  getHistoricalCloses,
};
