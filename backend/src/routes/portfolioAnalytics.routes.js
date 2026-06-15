const express = require("express");
const controller = require("../controllers/portfolioAnalytics.controller");

const router = express.Router();

router.get("/summary", controller.summary);
router.get("/performance", controller.performance);
router.get("/drawdown", controller.drawdown);
router.get("/equity-curve", controller.equityCurve);

module.exports = router;
