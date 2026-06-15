const express = require("express");
const controller = require("../controllers/riskDashboard.controller");

const router = express.Router();

router.get("/dashboard", controller.dashboard);
router.post("/rules", controller.createRules);
router.get("/rules", controller.getRules);
router.put("/rules", controller.updateRules);
router.post("/kill-switch", controller.killSwitch);
router.get("/status", controller.status);

module.exports = router;
