const express = require("express");
const positionController = require("../controllers/position.controller");

const router = express.Router();

router.get("/open", positionController.open);
router.get("/all", positionController.all);
router.get("/:id", positionController.getById);

module.exports = router;
