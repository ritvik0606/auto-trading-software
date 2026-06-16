const express = require("express");
const scannerController = require("../controllers/scanner.controller");

const router = express.Router();

router.get("/status", scannerController.status);
router.get("/nifty50", scannerController.nifty50);
router.post("/run", scannerController.run);
router.get("/banknifty", scannerController.banknifty);
router.get("/fno", scannerController.fno);
router.get("/custom", scannerController.custom);
router.get("/summary", scannerController.summary);

module.exports = router;
