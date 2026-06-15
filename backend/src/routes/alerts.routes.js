const express = require("express");
const alertsController = require("../controllers/alerts.controller");

const router = express.Router();

router.post("/create", alertsController.create);
router.get("/all", alertsController.all);
router.get("/summary", alertsController.summary);
router.delete("/:id", alertsController.remove);

module.exports = router;
