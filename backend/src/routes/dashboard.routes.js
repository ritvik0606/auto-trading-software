const express = require("express");
const dashboardController = require("../controllers/dashboard.controller");

const router = express.Router();

router.get("/summary", dashboardController.summary);
router.get("/broker-status", dashboardController.brokerStatus);
router.get("/watchlist-summary", dashboardController.watchlistSummary);
router.get("/risk-summary", dashboardController.riskSummary);

module.exports = router;
