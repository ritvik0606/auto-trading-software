const express = require("express");
const marketController = require("../controllers/market.controller");

const router = express.Router();

router.get("/nifty", marketController.getNifty);
router.get("/banknifty", marketController.getBankNifty);
router.get("/quote/:symbol", marketController.getQuote);

module.exports = router;
