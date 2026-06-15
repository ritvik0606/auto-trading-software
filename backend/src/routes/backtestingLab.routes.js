const express = require("express");
const controller = require("../controllers/backtestingLab.controller");

const router = express.Router();

router.post("/run", controller.run);
router.get("/summary/:id", controller.summary);
router.get("/trades/:id", controller.trades);
router.get("/equity/:id", controller.equity);
router.get("/drawdown/:id", controller.drawdown);
router.get("/compare", controller.compare);
router.get("/history", controller.history);

module.exports = router;
