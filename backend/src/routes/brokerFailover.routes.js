const express = require("express");
const controller = require("../controllers/brokerFailover.controller");

const router = express.Router();

router.get("/status", controller.status);
router.get("/history", controller.history);
router.get("/logs", controller.history);
router.post("/switch", controller.switchBroker);
router.get("/metrics", controller.metrics);

module.exports = router;
