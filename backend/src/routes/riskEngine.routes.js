const express = require("express");
const controller = require("../controllers/riskEngine.controller");

const router = express.Router();

router.get("/status", controller.status);
router.post("/config", controller.config);
router.post("/kill-switch", controller.killSwitch);
router.post("/unlock", controller.unlock);
router.get("/events", controller.events);

module.exports = router;
