const express = require("express");
const controller = require("../controllers/autoTrade.controller");

const router = express.Router();

router.post("/start", controller.start);
router.post("/stop", controller.stop);
router.get("/status", controller.status);
router.get("/runners", controller.runners);
router.get("/signals", controller.signals);

module.exports = router;
