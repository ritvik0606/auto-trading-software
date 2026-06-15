const express = require("express");
const orderController = require("../controllers/order.controller");

const router = express.Router();

router.post("/place", orderController.place);
router.get("/all", orderController.all);
router.get("/:id", orderController.getById);

module.exports = router;
