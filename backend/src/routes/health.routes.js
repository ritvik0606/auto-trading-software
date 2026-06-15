const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Auto Trading API Running"
  });
});

module.exports = router;