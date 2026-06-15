const express = require("express");
const journalController = require("../controllers/journal.controller");

const router = express.Router();

router.get("/all", journalController.all);
router.get("/stats", journalController.stats);
router.post("/note/:id", journalController.note);
router.get("/:id", journalController.getById);

module.exports = router;
