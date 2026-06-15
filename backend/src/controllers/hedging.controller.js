const {
  getHedgeStatus,
  analyzePortfolio,
  suggestHedge,
  applyPaperHedge,
} = require("../services/hedging.service");

function sendHedgingError(res, error) {
  console.error("Portfolio hedging request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Portfolio hedging request failed",
  });
}

function handler(service, statusCode = 200) {
  return async (req, res) => {
    try {
      res.status(statusCode).json({
        success: true,
        data: await service(req.body || {}),
      });
    } catch (error) {
      sendHedgingError(res, error);
    }
  };
}

exports.status = async (req, res) => {
  try {
    res.json({ success: true, data: await getHedgeStatus() });
  } catch (error) {
    sendHedgingError(res, error);
  }
};

exports.analyze = handler(analyzePortfolio);
exports.suggest = handler(suggestHedge);
exports.applyPaperHedge = handler(applyPaperHedge, 201);
