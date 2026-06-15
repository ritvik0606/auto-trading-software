const express = require("express");
const watchlistController = require("../controllers/watchlist.controller");

const router = express.Router();

router.post("/add", watchlistController.add);
router.get("/", watchlistController.list);
router.delete("/:id", watchlistController.remove);

module.exports = router;
