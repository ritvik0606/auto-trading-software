const express = require("express");
const strategyController = require("../controllers/strategy.controller");

const router = express.Router();

router.post("/start", strategyController.start);
router.post("/stop", strategyController.stop);
router.get("/active", strategyController.active);

module.exports = router;
