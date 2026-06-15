const express = require("express");
const signalController = require("../controllers/signal.controller");

const router = express.Router();

router.get("/:symbol", signalController.getBySymbol);

module.exports = router;
