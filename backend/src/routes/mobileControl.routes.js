const express = require("express");
const controller = require("../controllers/mobileControl.controller");

const router = express.Router();

router.post("/register", controller.register);
router.get("/devices", controller.devices);
router.post("/notify", controller.notify);
router.get("/notifications", controller.notifications);
router.post("/command", controller.command);
router.get("/commands", controller.commands);
router.get("/dashboard", controller.dashboard);
router.get("/health", controller.health);

module.exports = router;
