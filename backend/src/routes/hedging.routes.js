const express = require("express");
const controller = require("../controllers/hedging.controller");

const router = express.Router();

router.get("/status", controller.status);
router.post("/analyze", controller.analyze);
router.post("/suggest", controller.suggest);
router.post("/apply-paper-hedge", controller.applyPaperHedge);

module.exports = router;
