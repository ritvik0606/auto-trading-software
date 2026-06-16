const express = require("express");
const controller = require("../controllers/auditTrail.controller");

const router = express.Router();

router.get("/logs", controller.logs);
router.get("/search", controller.search);
router.get("/export", controller.export);

module.exports = router;
