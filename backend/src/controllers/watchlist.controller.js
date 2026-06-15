const {
  addWatchlistItem,
  getWatchlist,
  deleteWatchlistItem,
} = require("../services/watchlist.service");

function sendWatchlistError(res, error) {
  console.error("Watchlist request failed", {
    message: error.message,
    code: error.code,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Watchlist request failed",
  });
}

exports.add = async (req, res) => {
  try {
    const item = await addWatchlistItem(req.body);

    res.status(201).json({
      success: true,
      message: "Symbol added to watchlist",
      data: item,
    });
  } catch (error) {
    sendWatchlistError(res, error);
  }
};

exports.list = async (req, res) => {
  try {
    const items = await getWatchlist();

    res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    sendWatchlistError(res, error);
  }
};

exports.remove = async (req, res) => {
  try {
    const item = await deleteWatchlistItem(req.params.id);

    res.json({
      success: true,
      message: "Symbol removed from watchlist",
      data: item,
    });
  } catch (error) {
    sendWatchlistError(res, error);
  }
};
