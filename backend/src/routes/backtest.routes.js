const express = require("express");
const backtestController = require("../controllers/backtest.controller");

const router = express.Router();

router.post("/run", backtestController.run);

module.exports = router;
