const express = require("express");
const controller = require("../controllers/strategyGenerator.controller");

const router = express.Router();

router.get("/templates", controller.templates);
router.post("/generate", controller.generate);
router.post("/save", controller.save);
router.get("/history", controller.history);

module.exports = router;
