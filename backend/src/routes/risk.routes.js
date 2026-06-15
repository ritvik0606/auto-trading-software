const express = require("express");
const riskController = require("../controllers/risk.controller");

const router = express.Router();

router.get("/settings", riskController.getSettings);
router.post("/settings", riskController.saveSettings);
router.post("/calculate", riskController.calculate);

module.exports = router;
