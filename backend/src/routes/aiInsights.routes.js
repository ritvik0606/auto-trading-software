const express = require("express");
const controller = require("../controllers/aiInsights.controller");

const router = express.Router();

router.get("/summary", controller.summary);
router.get("/trade-quality", controller.tradeQuality);
router.get("/mistakes", controller.mistakes);
router.get("/recommendations", controller.recommendations);
router.get("/risk-warning", controller.riskWarning);

module.exports = router;
