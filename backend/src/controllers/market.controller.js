const {
  getNiftyLTP,
  getBankNiftyLTP,
  getSymbolQuote,
} = require("../services/market.service");

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
