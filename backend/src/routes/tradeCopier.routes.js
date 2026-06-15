const express = require("express");
const controller = require("../controllers/tradeCopier.controller");

const router = express.Router();

router.post("/group", controller.createGroup);
router.post("/follower", controller.addFollower);
router.post("/start/:groupId", controller.start);
router.post("/stop/:groupId", controller.stop);
router.get("/status/:groupId", controller.status);
router.get("/history/:groupId", controller.history);
router.get("/summary/:groupId", controller.summary);

module.exports = router;
