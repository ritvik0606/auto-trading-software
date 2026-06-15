const { loginAngel } = require("../services/angel.service");

exports.connectAngel = async (req, res) => {
  try {
    const result = await loginAngel();
    res.json({
      success: result.success,
      message: result.message,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};
