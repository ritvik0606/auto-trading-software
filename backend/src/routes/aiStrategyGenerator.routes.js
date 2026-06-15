const express = require("express");
const controller = require("../controllers/aiStrategyGenerator.controller");

const router = express.Router();

router.post("/generate", controller.generate);
router.get("/best", controller.best);
router.get("/recommendations", controller.recommendations);
router.post("/save", controller.save);
router.get("/history", controller.history);
router.get("/:id", controller.details);

module.exports = router;
