const express = require("express");
const controller = require("../controllers/paperSimulator.controller");

const router = express.Router();

router.get("/account", controller.account);
router.post("/order", controller.order);
router.get("/positions", controller.positions);
router.get("/history", controller.history);
router.post("/reset", controller.reset);

module.exports = router;
