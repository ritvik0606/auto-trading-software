const { runBacktest } = require("../services/backtest.service");

exports.run = async (req, res) => {
  try {
    res.json(await runBacktest(req.body));
  } catch (error) {
    console.error("Backtest request failed", {
      symbol: req.body?.symbol,
      message: error.message,
    });

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to run backtest",
    });
  }
};
