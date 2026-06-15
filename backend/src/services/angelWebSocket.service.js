const EventEmitter = require("events");
const WebSocket = require("ws");
const {
  connectAngel,
  getBrokerSession,
} = require("./brokerSession.service");

const ANGEL_STREAM_URL = "wss://smartapisocket.angelone.in/smart-stream";
const NSE_CASH_EXCHANGE_TYPE = 1;
const SUBSCRIBE_ACTION = 1;
const LTP_MODE = 1;
const PRICE_DIVISOR = 100;
const PING_INTERVAL_MS = 10000;
const STALE_CONNECTION_MS = 30000;
const MAX_RECONNECT_DELAY_MS = 30000;
const FIXED_INSTRUMENTS = [
  {
    symbol: "NIFTY",
    tradingSymbol: "NIFTY",
    exchange: "NSE",
    exchangeType: NSE_CASH_EXCHANGE_TYPE,
    symbolToken: "99926000",
  },
  {
    symbol: "BANKNIFTY",
    tradingSymbol: "BANKNIFTY",
    exchange: "NSE",
    exchangeType: NSE_CASH_EXCHANGE_TYPE,
    symbolToken: "99926009",
  },
  {
    symbol: "RELIANCE",
    tradingSymbol: "RELIANCE-EQ",
    exchange: "NSE",
    exchangeType: NSE_CASH_EXCHANGE_TYPE,
    symbolToken: "2885",
  },
];

const events = new EventEmitter();
events.setMaxListeners(100);

const instrumentsByToken = new Map();
const instrumentsBySymbol = new Map();
const liveQuotes = new Map();

let socket = null;
let connectionState = "DISCONNECTED";
let lastError = null;
let lastConnectedAt = null;
let lastTickAt = null;
let lastMessageAt = 0;
let reconnectAttempts = 0;
let reconnectTimer = null;
let pingTimer = null;
let staleTimer = null;
let manuallyStopped = false;
let connectPromise = null;

function normalizeSymbol(symbol) {
  return typeof symbol === "string"
    ? symbol.trim().toUpperCase().replace(/-EQ$/, "")
    : "";
}

function registerInstrument(instrument) {
  const normalized = {
    symbol: normalizeSymbol(instrument.symbol || instrument.tradingSymbol),
    tradingSymbol: instrument.tradingSymbol,
    exchange: instrument.exchange || "NSE",
    exchangeType:
      Number(instrument.exchangeType) || NSE_CASH_EXCHANGE_TYPE,
    symbolToken: String(instrument.symbolToken),
  };

  if (!normalized.symbol || !normalized.symbolToken) {
    return null;
  }

  instrumentsByToken.set(normalized.symbolToken, normalized);
  instrumentsBySymbol.set(normalized.symbol, normalized);
  return normalized;
}

FIXED_INSTRUMENTS.forEach(registerInstrument);

function publicStatus() {
  return {
    broker: "ANGEL_ONE",
    state: connectionState,
    connected: connectionState === "CONNECTED",
    subscribedSymbols: Array.from(instrumentsBySymbol.keys()),
    lastConnectedAt,
    lastTickAt,
    reason: lastError,
    mode: "PAPER_ONLY",
  };
}

function emitStatus() {
  events.emit("status", publicStatus());
}

function setState(state, error = null) {
  connectionState = state;
  lastError = error ? error.message || String(error) : null;
  emitStatus();
}

function clearConnectionTimers() {
  clearInterval(pingTimer);
  clearInterval(staleTimer);
  pingTimer = null;
  staleTimer = null;
}

function cleanSocketError(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    "Angel One market stream unavailable"
  );
}

function toSafeTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const milliseconds = numeric < 100000000000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseAngelTick(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 47) {
    return null;
  }

  const subscriptionMode = buffer.readUInt8(0);
  if (subscriptionMode !== LTP_MODE) {
    return null;
  }

  const exchangeType = buffer.readUInt8(1);
  const symbolToken = buffer
    .subarray(2, 27)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
  const instrument = instrumentsByToken.get(symbolToken);
  const rawPrice = buffer.readInt32LE(43);

  if (!instrument || !Number.isFinite(rawPrice)) {
    return null;
  }

  const exchangeTimestamp = buffer.readBigInt64LE(35);
  return {
    symbol: instrument.symbol,
    tradingSymbol: instrument.tradingSymbol,
    exchange: instrument.exchange,
    exchangeType,
    symbolToken,
    ltp: Number((rawPrice / PRICE_DIVISOR).toFixed(2)),
    exchangeTimestamp: toSafeTimestamp(exchangeTimestamp),
    receivedAt: new Date().toISOString(),
    source: "ANGEL_ONE_WEBSOCKET",
  };
}

function publishTick(tick) {
  if (!tick) {
    return;
  }

  liveQuotes.set(tick.symbol, tick);
  liveQuotes.set(tick.tradingSymbol, tick);
  liveQuotes.set(tick.symbolToken, tick);
  lastTickAt = tick.receivedAt;
  events.emit("tick", tick);
}

function buildSubscription(instruments) {
  const tokens = Array.from(
    new Set(instruments.map((instrument) => instrument.symbolToken))
  );

  return {
    correlationID: `market-${Date.now()}`,
    action: SUBSCRIBE_ACTION,
    params: {
      mode: LTP_MODE,
      tokenList: [
        {
          exchangeType: NSE_CASH_EXCHANGE_TYPE,
          tokens,
        },
      ],
    },
  };
}

function sendSubscription(instruments) {
  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN ||
    instruments.length === 0
  ) {
    return;
  }

  socket.send(JSON.stringify(buildSubscription(instruments)));
}

function scheduleReconnect(error) {
  if (manuallyStopped || reconnectTimer) {
    return;
  }

  const delay = Math.min(
    1000 * 2 ** Math.min(reconnectAttempts, 5),
    MAX_RECONNECT_DELAY_MS
  );
  reconnectAttempts += 1;
  setState("RECONNECTING", error);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startAngelMarketStream().catch(() => {});
  }, delay);
}

async function getAngelStreamSession() {
  try {
    return getBrokerSession("ANGEL_ONE");
  } catch (error) {
    if (error.statusCode === 423) {
      throw error;
    }
    await connectAngel();
    return getBrokerSession("ANGEL_ONE");
  }
}

async function startAngelMarketStream() {
  if (
    socket &&
    [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)
  ) {
    return publicStatus();
  }

  if (connectPromise) {
    return connectPromise;
  }

  manuallyStopped = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  setState("CONNECTING");

  connectPromise = getAngelStreamSession()
    .then(
      (session) =>
        new Promise((resolve, reject) => {
          if (manuallyStopped) {
            reject(new Error("Angel One market stream is stopped"));
            return;
          }

          if (!session?.jwtToken || !session?.feedToken) {
            reject(
              new Error(
                "Angel One session is missing JWT or market feed token"
              )
            );
            return;
          }

          const nextSocket = new WebSocket(ANGEL_STREAM_URL, {
            headers: {
              "x-client-code": process.env.ANGEL_CLIENT_CODE,
              Authorization: session.jwtToken,
              "x-api-key": process.env.ANGEL_API_KEY,
              "x-feed-token": session.feedToken,
            },
          });
          socket = nextSocket;

          nextSocket.once("open", () => {
            reconnectAttempts = 0;
            lastConnectedAt = new Date().toISOString();
            lastMessageAt = Date.now();
            setState("CONNECTED");
            sendSubscription(Array.from(instrumentsByToken.values()));

            clearConnectionTimers();
            pingTimer = setInterval(() => {
              if (nextSocket.readyState === WebSocket.OPEN) {
                nextSocket.send("ping");
              }
            }, PING_INTERVAL_MS);
            staleTimer = setInterval(() => {
              if (
                lastMessageAt &&
                Date.now() - lastMessageAt > STALE_CONNECTION_MS &&
                nextSocket.readyState === WebSocket.OPEN
              ) {
                nextSocket.terminate();
              }
            }, PING_INTERVAL_MS);
            resolve(publicStatus());
          });

          nextSocket.on("message", (data, isBinary) => {
            lastMessageAt = Date.now();
            if (!isBinary) {
              return;
            }
            publishTick(parseAngelTick(Buffer.from(data)));
          });

          nextSocket.once("error", (error) => {
            const cleanError = new Error(cleanSocketError(error));
            if (nextSocket.readyState !== WebSocket.OPEN) {
              reject(cleanError);
            }
            console.error("Angel One market stream error", {
              message: cleanError.message,
            });
          });

          nextSocket.once("close", () => {
            clearConnectionTimers();
            if (socket === nextSocket) {
              socket = null;
            }
            scheduleReconnect(
              new Error("Angel One market stream disconnected")
            );
          });
        })
    )
    .catch((error) => {
      if (error.statusCode === 423 || manuallyStopped) {
        setState("DISCONNECTED", error);
      } else {
        scheduleReconnect(error);
      }
      throw error;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

function stopAngelMarketStream() {
  manuallyStopped = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearConnectionTimers();

  if (socket) {
    const currentSocket = socket;
    socket = null;
    currentSocket.removeAllListeners("close");
    currentSocket.close();
  }

  setState("DISCONNECTED", new Error("Disconnected by user"));
  return publicStatus();
}

async function subscribeSymbols(symbols) {
  const normalizedSymbols = Array.from(
    new Set((symbols || []).map(normalizeSymbol).filter(Boolean))
  ).slice(0, 50);
  const newInstruments = [];

  for (const symbol of normalizedSymbols) {
    if (instrumentsBySymbol.has(symbol)) {
      continue;
    }

    try {
      const { resolveNseInstrument } = require("./market.service");
      const instrument = registerInstrument(
        await resolveNseInstrument(symbol)
      );
      if (instrument) {
        newInstruments.push(instrument);
      }
    } catch (error) {
      console.error("Angel One stream subscription skipped", {
        symbol,
        message: cleanSocketError(error),
      });
    }
  }

  sendSubscription(newInstruments);
  return newInstruments;
}

function getLiveQuote(symbolOrToken) {
  const key =
    typeof symbolOrToken === "string"
      ? symbolOrToken.trim().toUpperCase()
      : "";
  return liveQuotes.get(key) || liveQuotes.get(normalizeSymbol(key)) || null;
}

function getLiveSnapshot() {
  return Array.from(
    new Map(
      Array.from(liveQuotes.values()).map((quote) => [
        quote.symbolToken,
        quote,
      ])
    ).values()
  );
}

module.exports = {
  FIXED_INSTRUMENTS,
  events,
  getLiveQuote,
  getLiveSnapshot,
  getMarketStreamStatus: publicStatus,
  parseAngelTick,
  startAngelMarketStream,
  stopAngelMarketStream,
  subscribeSymbols,
};
