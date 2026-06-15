const express = require("express");
const optimizerController = require("../controllers/optimizer.controller");

const router = express.Router();

router.get("/summary", optimizerController.summary);
router.get("/best", optimizerController.best);
router.get("/history", optimizerController.history);
router.post("/run", optimizerController.run);

module.exports = router;
