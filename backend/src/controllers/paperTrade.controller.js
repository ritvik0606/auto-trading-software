const {
  createPaperTrade,
  getPaperTrades,
  exitPaperTrade,
} = require("../services/paperTrade.service");

function sendPaperTradeError(res, error) {
  console.error("Paper trade request failed", {
    message: error.message,
    code: error.code,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Paper trade request failed",
  });
}

async function create(req, res, tradeType) {
  try {
    const trade = await createPaperTrade(tradeType, req.body);

    res.status(201).json({
      success: true,
      message: `${tradeType} paper trade opened`,
      data: trade,
    });
  } catch (error) {
    sendPaperTradeError(res, error);
  }
}

exports.buy = async (req, res) => create(req, res, "BUY");

exports.sell = async (req, res) => create(req, res, "SELL");

exports.open = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getPaperTrades("OPEN"),
    });
  } catch (error) {
    sendPaperTradeError(res, error);
  }
};

exports.all = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getPaperTrades(),
    });
  } catch (error) {
    sendPaperTradeError(res, error);
  }
};

exports.exit = async (req, res) => {
  try {
    const trade = await exitPaperTrade(req.params.id, req.body);

    res.json({
      success: true,
      message: "Paper trade closed",
      data: trade,
    });
  } catch (error) {
    sendPaperTradeError(res, error);
  }
};
