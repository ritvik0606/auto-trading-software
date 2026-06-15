const express = require("express");
const controller = require("../controllers/executionAnalytics.controller");

const analyticsRouter = express.Router();
const reconciliationRouter = express.Router();

analyticsRouter.get("/summary", controller.summary);
analyticsRouter.get("/slippage", controller.slippage);
analyticsRouter.get("/latency", controller.latency);

reconciliationRouter.get("/report", controller.report);
reconciliationRouter.post("/run", controller.run);

module.exports = { analyticsRouter, reconciliationRouter };
