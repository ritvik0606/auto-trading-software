const express = require("express");
const controller = require("../controllers/killSwitch.controller");

const router = express.Router();

router.get("/status", controller.status);
router.post("/activate", controller.activate);
router.post("/deactivate", controller.deactivate);
router.get("/history", controller.history);

module.exports = router;
