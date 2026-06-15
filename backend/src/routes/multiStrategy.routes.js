const express = require("express");
const controller = require("../controllers/multiStrategy.controller");

const router = express.Router();

router.post("/add", controller.add);
router.post("/start/:id", controller.start);
router.post("/pause/:id", controller.pause);
router.post("/stop/:id", controller.stop);
router.get("/all", controller.all);
router.get("/active", controller.active);
router.get("/performance/:id", controller.performance);

module.exports = router;
