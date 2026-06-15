const {
  getPositions,
  getPositionById,
} = require("../services/position.service");

function sendPositionError(res, error) {
  console.error("Position request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Position request failed",
  });
}

exports.open = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getPositions("OPEN"),
    });
  } catch (error) {
    sendPositionError(res, error);
  }
};

exports.all = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getPositions(),
    });
  } catch (error) {
    sendPositionError(res, error);
  }
};

exports.getById = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getPositionById(req.params.id),
    });
  } catch (error) {
    sendPositionError(res, error);
  }
};
