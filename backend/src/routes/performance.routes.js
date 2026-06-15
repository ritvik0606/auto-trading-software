const express = require("express");
const performanceController = require("../controllers/performance.controller");

const router = express.Router();

router.get("/summary", performanceController.summary);
router.get("/daily", performanceController.daily);
router.get("/weekly", performanceController.weekly);
router.get("/monthly", performanceController.monthly);
router.get("/equity-curve", performanceController.equityCurve);
router.get("/drawdown", performanceController.drawdown);

module.exports = router;
