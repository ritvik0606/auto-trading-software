const express = require("express");
const executionController = require("../controllers/execution.controller");

const router = express.Router();

router.get("/summary", executionController.summary);
router.get("/orders", executionController.orders);
router.get("/slippage", executionController.slippage);
router.get(
  "/broker-performance",
  executionController.brokerPerformance
);

module.exports = router;
