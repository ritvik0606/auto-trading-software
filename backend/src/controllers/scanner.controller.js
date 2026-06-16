const {
  scanGroup,
  getScannerSummary,
} = require("../services/scanner.service");

function sendScannerError(res, error) {
  console.error("Scanner request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Scanner request failed",
  });
}

function groupHandler(group) {
  return async (req, res) => {
    try {
      res.json({
        success: true,
        data: await scanGroup(group),
      });
    } catch (error) {
      sendScannerError(res, error);
    }
  };
}

exports.nifty50 = groupHandler("nifty50");
exports.banknifty = groupHandler("banknifty");
exports.fno = groupHandler("fno");
exports.custom = groupHandler("custom");

exports.status = async (req, res) => {
  try {
    const summary = await getScannerSummary();

    res.json({
      success: true,
      data: {
        status: "READY",
        ...summary,
      },
    });
  } catch (error) {
    sendScannerError(res, error);
  }
};

exports.run = async (req, res) => {
  const group = req.body?.group || "nifty50";

  try {
    res.json({
      success: true,
      data: await scanGroup(group),
    });
  } catch (error) {
    sendScannerError(res, error);
  }
};

exports.summary = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getScannerSummary(),
    });
  } catch (error) {
    sendScannerError(res, error);
  }
};
