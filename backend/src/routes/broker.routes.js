const express = require("express");
const router = express.Router();

const brokerController = require("../controllers/broker.controller");

router.get("/angel/status", brokerController.angelStatus);
router.post("/angel/connect", brokerController.connectAngel);
router.get("/paytm/status", brokerController.paytmStatus);
router.post("/paytm/connect", brokerController.connectPaytm);
router.post("/disconnect", brokerController.disconnect);

// Backward-compatible alias for the original integration test route.
router.get("/angel/connect", brokerController.connectAngel);

module.exports = router;
