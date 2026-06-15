const express = require("express");
const portfolioController = require("../controllers/portfolio.controller");

const router = express.Router();

router.get("/summary", portfolioController.summary);
router.get("/holdings", portfolioController.holdings);
router.get("/pnl", portfolioController.pnl);
router.get("/allocation", portfolioController.allocation);
router.get("/analytics", portfolioController.analytics);

module.exports = router;
