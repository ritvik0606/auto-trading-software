const express = require("express");
const router = express.Router();

const brokerController = require("../controllers/broker.controller");

router.get("/angel/connect", brokerController.connectAngel);

module.exports = router;