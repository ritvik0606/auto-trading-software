const express = require("express");
const paperTradeController = require("../controllers/paperTrade.controller");

const router = express.Router();

router.post("/buy", paperTradeController.buy);
router.post("/sell", paperTradeController.sell);
router.get("/open", paperTradeController.open);
router.get("/all", paperTradeController.all);
router.post("/exit/:id", paperTradeController.exit);

module.exports = router;
