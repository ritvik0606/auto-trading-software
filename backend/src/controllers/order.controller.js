const {
  placeOrder,
  getOrders,
  getOrderById,
} = require("../services/order.service");

function sendOrderError(res, error) {
  console.error("Order request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Order request failed",
  });
}

exports.place = async (req, res) => {
  try {
    const result = await placeOrder(req.body);

    res.status(201).json({
      success: true,
      message: result.message,
      data: result.order,
    });
  } catch (error) {
    sendOrderError(res, error);
  }
};

exports.all = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getOrders(),
    });
  } catch (error) {
    sendOrderError(res, error);
  }
};

exports.getById = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getOrderById(req.params.id),
    });
  } catch (error) {
    sendOrderError(res, error);
  }
};
