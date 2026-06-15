const {
  getNiftyLTP,
  getBankNiftyLTP,
  getSymbolQuote,
} = require("../services/market.service");
const {
  events,
  getLiveSnapshot,
  getMarketStreamStatus,
  startAngelMarketStream,
  subscribeSymbols,
} = require("../services/angelWebSocket.service");

function sendMarketError(res, error) {
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Unable to fetch market data",
  });
}

exports.getNifty = async (req, res) => {
  try {
    const quote = await getNiftyLTP();
    res.json({ success: true, data: quote });
  } catch (error) {
    sendMarketError(res, error);
  }
};

exports.getBankNifty = async (req, res) => {
  try {
    const quote = await getBankNiftyLTP();
    res.json({ success: true, data: quote });
  } catch (error) {
    sendMarketError(res, error);
  }
};

exports.getQuote = async (req, res) => {
  try {
    const quote = await getSymbolQuote(req.params.symbol);
    res.json({ success: true, data: quote });
  } catch (error) {
    sendMarketError(res, error);
  }
};

exports.getOptionChain = async (req, res) => {
  res.json({
    success: true,
    mode: "PAPER_ONLY",
    message: "Option chain data unavailable",
    data: {
      symbol: "NIFTY",
      expiry: null,
      spot: null,
      strikes: [],
    },
  });
};

function sendStreamEvent(res, event, data) {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

exports.stream = async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const symbols =
    typeof req.query.symbols === "string"
      ? req.query.symbols.split(",").slice(0, 50)
      : [];
  const onTick = (tick) => sendStreamEvent(res, "tick", tick);
  const onStatus = (status) => sendStreamEvent(res, "status", status);

  events.on("tick", onTick);
  events.on("status", onStatus);
  sendStreamEvent(res, "status", getMarketStreamStatus());
  sendStreamEvent(res, "snapshot", getLiveSnapshot());

  subscribeSymbols(symbols).catch(() => {});
  startAngelMarketStream().catch((error) => {
    sendStreamEvent(res, "status", {
      ...getMarketStreamStatus(),
      reason: error.message,
    });
  });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    events.off("tick", onTick);
    events.off("status", onStatus);
  });
};

exports.streamStatus = (req, res) => {
  res.json({
    success: true,
    data: {
      ...getMarketStreamStatus(),
      quotes: getLiveSnapshot(),
    },
  });
};
