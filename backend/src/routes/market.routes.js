const express = require("express");
const marketController = require("../controllers/market.controller");

const router = express.Router();

router.get("/stream", marketController.stream);
router.get("/stream/status", marketController.streamStatus);
router.get("/nifty", marketController.getNifty);
router.get("/banknifty", marketController.getBankNifty);
router.get("/option-chain", marketController.getOptionChain);
router.get("/quote/:symbol", marketController.getQuote);

module.exports = router;
