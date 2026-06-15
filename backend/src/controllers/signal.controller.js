const { getSignal } = require("../services/signal.service");

exports.getBySymbol = async (req, res) => {
  try {
    const signal = await getSignal(req.params.symbol);
    res.json(signal);
  } catch (error) {
    console.error("Signal calculation failed", {
      symbol: req.params.symbol,
      message: error.message,
    });

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to calculate trading signal",
    });
  }
};
